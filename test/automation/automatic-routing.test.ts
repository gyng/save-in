import {
  automaticRoutingRuleIssues,
  isAdmittedAutomaticSource,
  matchAutomaticRoutingRule,
  type AutomaticScanGates,
} from "../../src/automation/automatic-routing.ts";
import { parseRulesCollecting } from "../../src/routing/rule-parser.ts";
import { isAutomaticRuleClauses } from "../../src/routing/automatic-rule.ts";
import type { PageSourceChannel, PageSourceKind } from "../../src/shared/page-source.ts";

const candidate = {
  pageUrl: "https://gallery.example.test/post/42",
  sourceUrl: "https://cdn.example.test/original/cat.JPG?token=1",
  sourceKind: "image" as const,
};

describe("automatic page-source routing", () => {
  test("selects the first guarded context:auto rule and ignores ordinary routes", () => {
    const parsed = parseRulesCollecting(`
filename: .*
into: ordinary/:filename:

context: ^auto$
pageurl: ^https://gallery\\.example\\.test/
sourcekind: ^image$
sourceurl/i: \\.(?:jpe?g|png)(?:[?#].*)?$
into: automatic/:pagedomain:/
`);

    expect(parsed.errors.filter((error) => !error.warning)).toEqual([]);
    expect(matchAutomaticRoutingRule(parsed.rules, candidate)?.destination).toBe(
      "automatic/:pagedomain:/",
    );
  });

  test("carries the matched rule's capture-substituted fetch template", () => {
    const parsed = parseRulesCollecting(`
context: ^auto$
pageurl: ^https://gallery\\.example\\.test/
sourceurl: ^https://cdn\\.example\\.test/original/([\\w.]+)
capturegroups: sourceurl
fetch: https://cdn.example.test/full/:$1:
into: automatic/:$1:
`);

    expect(parsed.errors.filter((error) => !error.warning)).toEqual([]);
    const match = matchAutomaticRoutingRule(parsed.rules, candidate);
    expect(match?.destination).toBe("automatic/cat.JPG");
    expect(match?.fetch).toBe("https://cdn.example.test/full/cat.JPG");
  });

  test("reports a null fetch template for plain automatic rules", () => {
    const parsed = parseRulesCollecting(
      "context: ^auto$\npageurl: example\nsourcekind: image\ninto: files/",
    );

    expect(matchAutomaticRoutingRule(parsed.rules, candidate)?.fetch).toBeNull();
  });

  test("does not opt broad or non-automatic context rules into unattended downloads", () => {
    for (const context of [".*", "^media$", "^(?:page|media)$"]) {
      const parsed = parseRulesCollecting(`
context: ${context}
pageurl: example
sourcekind: image
into: unsafe/
`);
      expect(matchAutomaticRoutingRule(parsed.rules, candidate)).toBeNull();
    }
  });

  test("rejects malformed automatic-context expressions without throwing", () => {
    expect(isAutomaticRuleClauses([{ name: "context", value: "auto[" }])).toBe(false);
    expect(isAutomaticRuleClauses([{ name: "context", value: "^auto$", flags: "i" }])).toBe(true);
  });

  test.each([
    ["page guard", "context: ^auto$\nsourcekind: image\ninto: files/", "page"],
    ["source guard", "context: ^auto$\npageurl: example\ninto: files/", "source"],
  ])("requires an explicit %s", (_label, source, issue) => {
    expect(automaticRoutingRuleIssues(source)).toContain(issue);
    expect(parseRulesCollecting(source).errors).toHaveLength(1);
  });

  test("accepts css as the automatic source guard and requires one common origin", () => {
    const parsed = parseRulesCollecting(`
context: ^auto$
pageurl: example
css: article img
css: img:not(.avatar)
into: articles/
`);
    expect(parsed.errors.filter((error) => !error.warning)).toEqual([]);
    expect(
      matchAutomaticRoutingRule(parsed.rules, {
        ...candidate,
        matchedCssSelectorsByOrigin: [["article img", "img:not(.avatar)"]],
      })?.destination,
    ).toBe("articles/");
    expect(
      matchAutomaticRoutingRule(parsed.rules, {
        ...candidate,
        matchedCssSelectorsByOrigin: [["article img"], ["img:not(.avatar)"]],
      }),
    ).toBeNull();
    expect(matchAutomaticRoutingRule(parsed.rules, candidate)).toBeNull();
  });

  test("rejects regex flags and capture targets on css matchers", () => {
    expect(parseRulesCollecting("css/i: img\ninto: files/").rules).toEqual([]);
    expect(parseRulesCollecting("css: img\ncapture: css\ninto: files/").rules).toEqual([]);
  });

  describe("data: candidates", () => {
    const dataCandidate = (sourceUrl: string) => ({
      pageUrl: "https://gallery.example.test/post/42",
      sourceUrl,
      sourceKind: "image" as const,
    });

    test("matches a mime: rule and names via :mimeext: from the parsed mediatype", () => {
      // A data: URL has no path, so the mediatype must come from its header for
      // mime-based matching and :mimeext: naming to resolve — the same info the
      // background re-match sees, keyed off the URL itself.
      const parsed = parseRulesCollecting(`
context: ^auto$
pageurl: ^https://gallery\\.example\\.test/
sourcekind: ^image$
mime: ^image/png$
into: inline/:mimeext:/
`);
      expect(parsed.errors.filter((error) => !error.warning)).toEqual([]);
      expect(
        matchAutomaticRoutingRule(parsed.rules, dataCandidate("data:image/png;base64,iVBORw0KGgo="))
          ?.destination,
      ).toBe("inline/:mimeext:/");
    });

    test("a mime: rule does not match a data: URL of a different mediatype", () => {
      const parsed = parseRulesCollecting(`
context: ^auto$
pageurl: ^https://gallery\\.example\\.test/
sourcekind: ^image$
mime: ^image/png$
into: inline/
`);
      expect(
        matchAutomaticRoutingRule(parsed.rules, dataCandidate("data:image/gif;base64,R0lGOD")),
      ).toBeNull();
    });

    test("treats a data: URL with no parseable mediatype as application/octet-stream", () => {
      const parsed = parseRulesCollecting(`
context: ^auto$
pageurl: ^https://gallery\\.example\\.test/
sourcekind: ^image$
mime: ^application/octet-stream$
into: inline/
`);
      expect(
        matchAutomaticRoutingRule(parsed.rules, dataCandidate("data:;base64,SGVsbG8="))
          ?.destination,
      ).toBe("inline/");
    });
  });
});

describe("isAdmittedAutomaticSource", () => {
  const ALL_OFF: AutomaticScanGates = {
    includeLinks: false,
    includeDocuments: false,
    includeBackgrounds: false,
    resourceHints: false,
  };
  const ALL_ON: AutomaticScanGates = {
    includeLinks: true,
    includeDocuments: true,
    includeBackgrounds: true,
    resourceHints: true,
  };

  test.each<[PageSourceKind]>([["image"], ["video"], ["audio"]])(
    "always admits embedded %s regardless of every gate",
    (kind) => {
      expect(isAdmittedAutomaticSource(kind, undefined, ALL_OFF)).toBe(true);
      expect(isAdmittedAutomaticSource(kind, undefined, ALL_ON)).toBe(true);
    },
  );

  test.each<[PageSourceKind]>([["stream"], ["document"], ["link"]])(
    "never admits embedded %s (the collector never emits these without a channel)",
    (kind) => {
      expect(isAdmittedAutomaticSource(kind, undefined, ALL_ON)).toBe(false);
    },
  );

  test.each<[PageSourceKind]>([["image"], ["video"], ["audio"]])(
    "gates an anchor %s on includeLinks alone",
    (kind) => {
      expect(isAdmittedAutomaticSource(kind, "anchor", ALL_OFF)).toBe(false);
      expect(isAdmittedAutomaticSource(kind, "anchor", { ...ALL_OFF, includeLinks: true })).toBe(
        true,
      );
      // Turning on the unrelated documents gate must not admit media anchors.
      expect(
        isAdmittedAutomaticSource(kind, "anchor", { ...ALL_OFF, includeDocuments: true }),
      ).toBe(false);
    },
  );

  test.each<[PageSourceKind]>([["stream"], ["document"]])(
    "gates an anchor %s on includeDocuments alone",
    (kind) => {
      expect(isAdmittedAutomaticSource(kind, "anchor", ALL_OFF)).toBe(false);
      expect(
        isAdmittedAutomaticSource(kind, "anchor", { ...ALL_OFF, includeDocuments: true }),
      ).toBe(true);
      // Turning on the unrelated links/resourceHints gates must not admit
      // linked documents/streams — cross-channel bleed is exactly the
      // correctness bug this predicate exists to prevent.
      expect(isAdmittedAutomaticSource(kind, "anchor", { ...ALL_OFF, includeLinks: true })).toBe(
        false,
      );
      expect(isAdmittedAutomaticSource(kind, "anchor", { ...ALL_OFF, resourceHints: true })).toBe(
        false,
      );
    },
  );

  test("never admits a plain link anchor, even with every gate on", () => {
    expect(isAdmittedAutomaticSource("link", "anchor", ALL_ON)).toBe(false);
  });

  test("gates a background image on includeBackgrounds alone", () => {
    expect(isAdmittedAutomaticSource("image", "background", ALL_OFF)).toBe(false);
    expect(
      isAdmittedAutomaticSource("image", "background", { ...ALL_OFF, includeBackgrounds: true }),
    ).toBe(true);
    // Every other gate on, but not includeBackgrounds, must still refuse.
    expect(
      isAdmittedAutomaticSource("image", "background", { ...ALL_ON, includeBackgrounds: false }),
    ).toBe(false);
  });

  test.each<[PageSourceKind]>([["video"], ["audio"], ["stream"], ["document"], ["link"]])(
    "never admits a background candidate of kind %s",
    (kind) => {
      expect(isAdmittedAutomaticSource(kind, "background", ALL_ON)).toBe(false);
    },
  );

  test("gates a resource-hint stream on resourceHints alone", () => {
    expect(isAdmittedAutomaticSource("stream", "resource-hint", ALL_OFF)).toBe(false);
    expect(
      isAdmittedAutomaticSource("stream", "resource-hint", { ...ALL_OFF, resourceHints: true }),
    ).toBe(true);
    // A resource-hint stream must not be adopted merely because the
    // (unrelated) linked-documents gate is on — the correctness requirement
    // this predicate exists to enforce.
    expect(
      isAdmittedAutomaticSource("stream", "resource-hint", { ...ALL_OFF, includeDocuments: true }),
    ).toBe(false);
  });

  test.each<[PageSourceKind]>([["image"], ["video"], ["audio"], ["document"], ["link"]])(
    "never admits a resource-hint candidate of kind %s",
    (kind) => {
      expect(isAdmittedAutomaticSource(kind, "resource-hint", ALL_ON)).toBe(false);
    },
  );

  test("a .m3u8 anchor is not adopted merely because the manifests gate is on", () => {
    expect(isAdmittedAutomaticSource("stream", "anchor", { ...ALL_OFF, resourceHints: true })).toBe(
      false,
    );
  });

  test.each<[PageSourceChannel]>([["anchor"], ["background"], ["resource-hint"]])(
    "%s never admits a kind that channel cannot produce, even with every gate on",
    (channel) => {
      const impossible: Record<PageSourceChannel, PageSourceKind[]> = {
        anchor: [],
        background: ["video", "audio", "stream", "document", "link"],
        "resource-hint": ["image", "video", "audio", "document", "link"],
      };
      for (const kind of impossible[channel]) {
        expect(isAdmittedAutomaticSource(kind, channel, ALL_ON)).toBe(false);
      }
    },
  );
});

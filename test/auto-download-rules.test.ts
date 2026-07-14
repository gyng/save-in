import {
  matchAutoDownloadRule,
  migrateLegacyAutoDownloadRules,
  parseAutoDownloadRules,
  serializeAutoDownloadRules,
} from "../src/automation/auto-download-rules.ts";

const candidate = {
  pageUrl: "https://www.example.co.uk/gallery/42",
  sourceUrl: "https://cdn.example.co.uk/original/cat.JPG?token=1",
  sourceKind: "image" as const,
};

describe("automatic page-source rules", () => {
  test("parses and matches a site-scoped source rule", () => {
    const parsed = parseAutoDownloadRules(`
name: Gallery images
pageurl/i: ^https://www\\.example\\.co\\.uk/gallery/
sourcekind: image
sourceurl/i: \\.(?:jpe?g|png)(?:[?#].*)?$
into: galleries/:pagerootdomain:/
`);

    expect(parsed.errors).toEqual([]);
    expect(parsed.rules).toHaveLength(1);
    expect(matchAutoDownloadRule(parsed.rules, candidate)?.destination).toBe(
      "galleries/:pagerootdomain:/",
    );
  });

  test("supports domain, root-domain, extension and case-insensitive matching", () => {
    const parsed = parseAutoDownloadRules(`
pagedomain: ^www\\.example\\.co\\.uk$
pagerootdomain: ^example\\.co\\.uk$
sourcedomain: ^cdn\\.example\\.co\\.uk$
sourcerootdomain: ^example\\.co\\.uk$
fileext/i: ^jpg$
into: matched/
`);

    expect(parsed.errors).toEqual([]);
    expect(matchAutoDownloadRule(parsed.rules, candidate)?.destination).toBe("matched/");
  });

  test("uses the first matching enabled rule", () => {
    const parsed = parseAutoDownloadRules(`
name: Disabled
disabled: true
pageurl: example
sourcekind: image
into: disabled/

name: First
pageurl: example
sourcekind: image
into: first/

name: Later
pageurl: example
sourcekind: image
into: later/
`);

    expect(parsed.errors).toEqual([]);
    expect(matchAutoDownloadRule(parsed.rules, candidate)?.name).toBe("First");
  });

  test.each([
    ["page scope", "sourcekind: image\ninto: files/", "missing-page-matcher"],
    ["source scope", "pageurl: example\ninto: files/", "missing-source-matcher"],
    ["destination", "pageurl: example\nsourcekind: image", "missing-into"],
  ])("requires a %s", (_label, source, code) => {
    const parsed = parseAutoDownloadRules(source);
    expect(parsed.rules).toEqual([]);
    expect(parsed.errors).toEqual([expect.objectContaining({ code })]);
  });

  test("reports unknown clauses, invalid regexes and duplicate controls with locations", () => {
    const parsed = parseAutoDownloadRules(`
name: Bad
name: Duplicate
pageurl: [
sourcekind: image
surprise: yes
into: files/
into: duplicate/
`);

    expect(parsed.rules).toEqual([]);
    expect(parsed.errors.map(({ code }) => code)).toEqual([
      "duplicate-name",
      "invalid-regex",
      "unknown-clause",
      "duplicate-into",
    ]);
    expect(parsed.errors.every(({ location }) => location.line > 0)).toBe(true);
  });

  test("rejects match-all page or source guards unless the user writes an explicit constraint", () => {
    const parsed = parseAutoDownloadRules(`
pageurl: .*
sourceurl: ^.*$
into: dangerous/
`);

    expect(parsed.rules).toEqual([]);
    expect(parsed.errors.map(({ code }) => code)).toEqual([
      "unsafe-page-matcher",
      "unsafe-source-matcher",
    ]);
  });

  test("serializes visual-editor data to the canonical grammar", () => {
    expect(
      serializeAutoDownloadRules([
        {
          name: "Gallery images",
          enabled: false,
          matchers: [
            { name: "pageurl", pattern: "^https://example\\.com/", flags: "i" },
            { name: "sourcekind", pattern: "image", flags: "" },
          ],
          destination: "gallery/",
        },
      ]),
    ).toBe(
      "name: Gallery images\ndisabled: true\npageurl/i: ^https://example\\.com/\nsourcekind: image\ninto: gallery/",
    );
  });

  test("migrates legacy automatic rules into guarded routing rules", () => {
    expect(
      migrateLegacyAutoDownloadRules(
        "name: Gallery images\ndisabled: true\npageurl: example\\.com\nsourcekind: image\ninto: gallery/",
      ),
    ).toEqual({
      errors: [],
      routingSource: [
        "// Gallery images",
        "context: ^auto$",
        "pageurl: example\\.com",
        "sourcekind: image",
        "into: gallery/",
        "disabled: true",
      ].join("\n"),
    });
  });
});

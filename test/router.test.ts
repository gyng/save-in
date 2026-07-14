import * as router from "../src/routing/router.ts";
import {
  type MatcherResult,
  type RoutingRule,
  type RuleError,
  type RoutingInfo,
} from "../src/routing/router.ts";
import * as constants from "../src/shared/constants.ts";
import { currentTab, setCurrentTab } from "../src/platform/current-tab.ts";
import type { MockInstance } from "vitest";
import { configureRoutingPorts } from "../src/routing/ports.ts";
import { nextCounter, peekCounter } from "../src/background/counter.ts";
import { counterWriteState } from "../src/background/state.ts";
import { resolveContent } from "../src/downloads/content-fetch.ts";
import { options } from "../src/config/options-data.ts";
import fixtures from "./fixtures/click-info.ts";

let diagnostics: { filenamePatterns: RuleError[]; paths: RuleError[] } = {
  filenamePatterns: [],
  paths: [],
};
let debug = false;
const logRoutingDebug = (...values: unknown[]) => console.log(...values); // eslint-disable-line no-console

const expectMatch = (result: MatcherResult): RegExpMatchArray => {
  expect(result).toBeTruthy();
  if (!result) throw new Error("expected matcher to return a match");
  return result;
};

describe("filename rewrite and routing", () => {
  const info = {
    srcUrl: "http://source.com/cat.jpg",
    linkUrl: "http://link.com",
    pageUrl: "http://page.com",
    frameUrl: "http://frameurl.com",
    linkText: "link text",
  };

  beforeAll(() => {
    diagnostics.filenamePatterns = [];
    diagnostics.paths = [];
    setCurrentTab({
      title: "some title",
    });
    configureRoutingPorts({
      getCurrentTab: () => currentTab,
      isDebug: () => debug,
      recordRuleErrors: (errors) => diagnostics.filenamePatterns.push(...errors),
      logDebug: logRoutingDebug,
      nextCounter: () => nextCounter(counterWriteState, browser.storage.local),
      peekCounter: () => peekCounter(browser.storage.local),
      resolveContent,
    });
    // Mock-boundary cast: router.ts only calls i18n.getMessage, so the test
    // stubs a minimal shape rather than the full @types Browser interface
    global.browser = { i18n: { getMessage: () => {} } } as any;
  });

  afterAll(() => {
    setCurrentTab(null);
  });

  describe("matcher functions", () => {
    test("fileext", () => {
      const matcher = router.matcherFunctions.fileext(new RegExp("jpg"));
      expect(expectMatch(matcher(info)).length).toBe(1);
      expect(expectMatch(matcher(info))[0]!).toBe("jpg");
    });

    test("fileext negative", () => {
      const matcher = router.matcherFunctions.fileext(new RegExp("foobar"));
      expect(matcher(info)).toBe(null);
    });

    test("filename", () => {
      const matcher = router.matcherFunctions.filename(new RegExp("dog.jpg"));
      expect(expectMatch(matcher(info, { filename: "dog.jpg" })).length).toBe(1);
      expect(expectMatch(matcher(info, { filename: "dog.jpg" }))[0]!).toBe("dog.jpg");
    });

    test("filename negative", () => {
      const matcher = router.matcherFunctions.filename(new RegExp("dog.jpg"));
      expect(matcher(info, { filename: "cat.jpg" })).toBe(null);
    });

    test("naivefilename", () => {
      const matcher = router.matcherFunctions.naivefilename(new RegExp("cat.jpg"));
      expect(expectMatch(matcher(info)).length).toBe(1);
      expect(expectMatch(matcher(info))[0]!).toBe("cat.jpg");
    });

    test("naivefilename negative", () => {
      const matcher = router.matcherFunctions.naivefilename(new RegExp("dog.jpg"));
      expect(matcher(info)).toBe(null);
    });
    test("infoMatcherFactory matchers", () => {
      const matcher = router.matcherFunctions.frameurl(new RegExp(".*"));
      expect(expectMatch(matcher(info)).length).toBe(1);
      expect(expectMatch(matcher(info))[0]!).toBe(info.frameUrl);
    });

    test("infoMatcherFactory negative", () => {
      const matcher = router.matcherFunctions.frameurl(new RegExp("notvalid"));
      expect(matcher(info)).toBe(null);
    });

    test("tabMatcherFactory matchers", () => {
      const matcher = router.matcherFunctions.pagetitle(new RegExp(".*"));
      expect(expectMatch(matcher(info)).length).toBe(1);
      expect(expectMatch(matcher(info))[0]!).toBe(currentTab?.title);
    });

    test("tabMatcherFactory negative", () => {
      const matcher = router.matcherFunctions.pagetitle(new RegExp("notvalid"));
      expect(matcher(info)).toBe(null);
    });

    test("pagetitle prefers the tab attached to the download", () => {
      setCurrentTab({ title: "unrelated active tab" });
      const matcher = router.matcherFunctions.pagetitle(new RegExp("download tab"));

      expect(expectMatch(matcher({ ...info, currentTab: { title: "download tab" } }))[0]).toBe(
        "download tab",
      );
      expect(matcher({ ...info, currentTab: { title: "other tab" } })).toBe(null);

      setCurrentTab({ title: "some title" });
    });

    test("pagetitle does not fall back when an explicit tab is absent", () => {
      const matcher = router.matcherFunctions.pagetitle(/.*/);

      expect(matcher({ currentTab: null })).toBeNull();
      expect(matcher({ currentTab: {} })).toBeNull();
    });

    test("debug matching does not emit private routing metadata", () => {
      const logDebug = vi.fn();
      configureRoutingPorts({ isDebug: () => true, logDebug });
      const matcher = router.matcherFunctions.pageurl(new RegExp("page\\.com"));

      expect(
        matcher({
          ...info,
          currentTab: { incognito: true },
          selectionText: "private selection",
        }),
      ).toBeTruthy();
      expect(logDebug).not.toHaveBeenCalled();

      configureRoutingPorts({
        isDebug: () => debug,
        logDebug: logRoutingDebug,
      });
    });
  });

  describe("rule parsing", () => {
    test("parsing valid rules", () => {
      const rules = router.parseRules(
        "sourceurl: dog\ninto: cat\n\npageurl:cat\ncapture: pageurl\ninto:dog",
      );
      expect(rules.length).toBe(2);
      expect(rules[0]!.length).toBe(2);
      expect(rules[0]![0]!.name).toBe("sourceurl");
      expect(rules[0]![0]!.type).toBe(constants.RULE_TYPES.MATCHER);
      expect(rules[0]![1]!.name).toBe("into");
      expect(rules[0]![1]!.type).toBe(constants.RULE_TYPES.DESTINATION);

      expect(rules[1]!.length).toBe(3);
      expect(rules[1]![0]!.type).toBe(constants.RULE_TYPES.MATCHER);
      expect(rules[1]![1]!.type).toBe(constants.RULE_TYPES.CAPTURE);
      expect(rules[1]![1]!.value).toBe("pageurl");
      expect(rules[1]![2]!.type).toBe(constants.RULE_TYPES.DESTINATION);
    });

    test("parsing missing into", () => {
      const rules = router.parseRules("sourceurl: dog\n\npageurl:cat\ncapture: pageurl\ninto:dog");

      expect(rules.length).toBe(1);
      expect(rules[0]!.length).toBe(3);
      expect(rules[0]![0]!.name).toBe("pageurl");
    });

    test("parsing missing matcher", () => {
      const rules = router.parseRules("into: dog\n\npageurl:cat\ncapture: pageurl\ninto:dog");

      expect(rules.length).toBe(1);
      expect(rules[0]!.length).toBe(3);
      expect(rules[0]![0]!.name).toBe("pageurl");
    });

    test("parsing multiple matchers", () => {
      const rules = router.parseRules(
        "into: dog\n\npageurl:cat\nsourceurl:pig\ncapture: pageurl,sourceurl\ninto:dog",
      );

      expect(rules.length).toBe(1);
      expect(rules[0]!.length).toBe(4);
      expect(rules[0]!.filter((r) => r.type === constants.RULE_TYPES.MATCHER).length).toBe(2);
      expect(rules[0]![0]!.name).toBe("pageurl");
      expect(rules[0]![0]!.value.toString()).toBe("/cat/");
      expect(rules[0]![1]!.name).toBe("sourceurl");
      expect(rules[0]![1]!.value.toString()).toBe("/pig/");
    });

    test("parsing unknown clause", () => {
      const rules = router.parseRules("what: dog\n\npageurl:cat\ncapture: pageurl\ninto:dog");

      expect(rules.length).toBe(1);
      expect(rules[0]!.length).toBe(3);
      expect(rules[0]![0]!.name).toBe("pageurl");
    });
  });

  describe("rule matching", () => {
    let rules: RoutingRule[];

    beforeAll(() => {
      rules = router.parseRules(
        "sourceurl: dog\ninto: cat\n\nsourceurl: (cat)\ncapture: sourceurl\ninto: dog:$1:",
      );
    });

    test("matching valid", () => {
      const match = router.matchRules(rules, info);
      expect(match).toBe("dogcat");
    });

    test("missing capture target", () => {
      rules = router.parseRules("sourceurl: dog\ncapture: pageurl\ninto: cat:$1:");
      const match = router.matchRules(rules, info);
      expect(match).toBe(null);
    });

    test("missing capture target, multiple captures", () => {
      rules = router.parseRules("sourceurl: dog\ncapture: sourceurl, pageurl\ninto: cat:$1:");
      const match = router.matchRules(rules, info);
      expect(match).toBe(null);
    });

    test("does not throw when an untyped caller supplies a malformed rule", () => {
      expect(router.matchRule([] as unknown as RoutingRule, info)).toBe(false);
      expect(
        router.matchRule(
          [
            { name: "filename", value: /.+/, type: constants.RULE_TYPES.MATCHER },
            { name: "into", value: "images", type: constants.RULE_TYPES.DESTINATION },
          ] as unknown as RoutingRule,
          info,
        ),
      ).toBe(false);
    });
  });

  describe("browser context menu click integration", () => {
    test("parses Firefox clicks", () => {
      const twitterRulesFirefox = router.parseRules(
        [
          "filename: (.*)(:|-|=)(large|small|medium|thumb|orig)",
          "sourceurl: pbs.twimg.com",
          "capture: filename",
          "into: :$1:",
        ].join("\n"),
      );

      const matched = router.matchRules(twitterRulesFirefox, fixtures.firefoxInfo);

      expect(matched).toBe("EMNH-QAUwAEUmd_.jpg");
    });

    test("parses Chrome clicks", () => {
      const twitterRulesChrome = router.parseRules(
        [
          "filename: (.*)_(large|small|medium|thumb|orig)",
          "sourceurl: pbs.twimg.com",
          "capture: filename",
          "into: :$1:",
        ].join("\n"),
      );

      const matched = router.matchRules(twitterRulesChrome, fixtures.chromeInfo);

      expect(matched).toBe("Di6uEBuVsAEYVBw.jpg");
    });
  });

  describe("additional matcher functions", () => {
    test("pagedomain", () => {
      const matcher = router.matcherFunctions.pagedomain(new RegExp("page.com"));
      expect(expectMatch(matcher(info))[0]!).toBe("page.com");
    });

    test("pagedomain negative", () => {
      const matcher = router.matcherFunctions.pagedomain(new RegExp("notvalid"));
      expect(matcher(info)).toBe(null);
    });

    test("pagedomain with an unparseable page URL", () => {
      const matcher = router.matcherFunctions.pagedomain(new RegExp(".*"));
      expect(matcher({ pageUrl: "not a url" })).toBe(null);
    });

    test("pagedomain without info", () => {
      const matcher = router.matcherFunctions.pagedomain(new RegExp(".*"));
      expect(matcher(undefined as unknown as RoutingInfo)).toBe(null);
    });

    test("sourcedomain", () => {
      const matcher = router.matcherFunctions.sourcedomain(new RegExp("source.com"));
      expect(expectMatch(matcher(info))[0]!).toBe("source.com");
    });

    test("source-derived matchers accept normalized sourceUrl", () => {
      const normalized = { sourceUrl: "https://cdn.example.test/media/cat.jpg" };

      expect(
        expectMatch(router.matcherFunctions.sourcedomain(/cdn\.example\.test/)(normalized))[0],
      ).toBe("cdn.example.test");
      expect(expectMatch(router.matcherFunctions.naivefilename(/cat\.jpg/)(normalized))[0]).toBe(
        "cat.jpg",
      );
    });

    test("domain and MIME matchers reject absent normalized values", () => {
      expect(router.matcherFunctions.pagerootdomain(/.*/)({ pageUrl: "file:///tmp/a" })).toBeNull();
      expect(router.matcherFunctions.mime(/.*/)({})).toBe(false);
    });

    test("URL and actual extension matchers cover every source fallback", () => {
      const urlExtension = router.matcherFunctions.urlfileext(/^jpg$/);
      expect(urlExtension({ sourceUrl: "https://x/source.jpg" })).toBeTruthy();
      expect(urlExtension({ srcUrl: "https://x/src.jpg" })).toBeTruthy();
      expect(urlExtension({ linkUrl: "https://x/link.jpg" })).toBeTruthy();
      expect(urlExtension({ pageUrl: "https://x/page.jpg" })).toBeTruthy();
      expect(urlExtension({})).toBe(false);
      expect(
        router.matcherFunctions.urlfileext(/^$/)({ url: "https://x/no-extension" }),
      ).toBeTruthy();
      expect(router.matcherFunctions.actualfileext(/.*/)({})).toBe(false);
    });

    test("context matches case-insensitively", () => {
      const matcher = router.matcherFunctions.context(new RegExp("image"));
      expect(expectMatch(matcher(info, { context: "IMAGE" }))[0]!).toBe("image");
      expect(router.matcherFunctions.context(new RegExp("link"))(info, { context: "IMAGE" })).toBe(
        null,
      );
    });

    test("sourcekind matches discovered page-source kinds", () => {
      const matcher = router.matcherFunctions.sourcekind(new RegExp("^image$"));
      expect(expectMatch(matcher({ ...info, sourceKind: "image" }))[0]!).toBe("image");
      expect(matcher({ ...info, sourceKind: "video" })).toBeNull();
    });

    test("menuindex", () => {
      const matcher = router.matcherFunctions.menuindex(new RegExp("^2$"));
      expect(expectMatch(matcher(info, { menuIndex: "2" }))[0]!).toBe("2");
      expect(matcher(info, { menuIndex: "3" })).toBe(null);
      // missing menu metadata is treated as no match
      expect(matcher(info)).toBe(null);
    });

    test("comment", () => {
      const matcher = router.matcherFunctions.comment(new RegExp("save"));
      expect(expectMatch(matcher(info, { comment: "save here" }))[0]!).toBe("save");
      expect(matcher(info, { comment: "other" })).toBe(null);
      // missing menu metadata is treated as no match
      expect(matcher(info)).toBe(null);
    });

    test("fileext falls back through URL fields", () => {
      const matcher = router.matcherFunctions.fileext(new RegExp("html"));
      expect(expectMatch(matcher({ linkUrl: "http://x.com/a.html" }))[0]!).toBe("html");
      expect(expectMatch(matcher({ pageUrl: "http://x.com/b.html" }))[0]!).toBe("html");
    });

    test("fileext without a URL or extension", () => {
      const matcher = router.matcherFunctions.fileext(new RegExp(".*"));
      expect(matcher({})).toBe(false);
      expect(matcher({ srcUrl: "http://x.com/noextension" })).toBe(false);
    });

    test("filename prefers info.filename", () => {
      const matcher = router.matcherFunctions.filename(new RegExp("dog.jpg"));
      expect(expectMatch(matcher({ filename: "dog.jpg" }, {}))[0]!).toBe("dog.jpg");
    });

    test("filename missing everywhere", () => {
      const matcher = router.matcherFunctions.filename(new RegExp(".*"));
      expect(matcher({}, {})).toBe(false);
    });

    test("naivefilename falls back through URL fields", () => {
      const matcher = router.matcherFunctions.naivefilename(new RegExp("cat.jpg"));
      expect(expectMatch(matcher({ linkUrl: "http://x.com/cat.jpg" }))[0]!).toBe("cat.jpg");
      expect(expectMatch(matcher({ pageUrl: "http://x.com/cat.jpg" }))[0]!).toBe("cat.jpg");
    });

    test("naivefilename without a URL or filename", () => {
      const matcher = router.matcherFunctions.naivefilename(new RegExp(".*"));
      expect(matcher({})).toBe(false);
      expect(matcher({ srcUrl: "http://x.com/" })).toBe(false);
    });
  });

  describe("rule parsing errors", () => {
    beforeEach(() => {
      diagnostics = { filenamePatterns: [], paths: [] };
    });

    test("empty and comment-only rulesets parse to nothing", () => {
      expect(router.parseRules("")).toEqual([]);
      expect(router.parseRules("// just a comment\n\n// another")).toEqual([]);
    });

    test("disabled rules are valid but do not participate in routing", () => {
      const rules = router.parseRules(
        "disabled: true\nfilename: \\.jpg$\ninto: images\n\nfilename: \\.pdf$\ninto: documents",
      );

      expect(rules).toHaveLength(1);
      expect(router.matchRules(rules, { filename: "cat.jpg" })).toBeNull();
      expect(router.matchRules(rules, { filename: "report.pdf" })).toBe("documents");
      expect(diagnostics.filenamePatterns).toEqual([]);
    });

    test("accepts disabled false and rejects other control values", () => {
      expect(router.parseRules("filename: \\.pdf$\ninto: documents\ndisabled: false")).toHaveLength(
        1,
      );
      expect(router.parseRules("filename: \\.pdf$\ninto: documents\ndisabled: sometimes")).toEqual(
        [],
      );
      expect(diagnostics.filenamePatterns.at(-1)?.error).toBe("disabled must be true or false");
    });

    test("rejects duplicate disabled controls", () => {
      expect(
        router.parseRules("filename: \\.pdf$\ninto: documents\ndisabled: false\ndisabled: true"),
      ).toEqual([]);
      expect(diagnostics.filenamePatterns.at(-1)?.error).toBe("disabled may appear only once");
    });

    test("bad clause syntax is reported", () => {
      const rules = router.parseRules("not a clause\ninto: x");
      expect(rules).toEqual([]);
      expect(diagnostics.filenamePatterns[0]!.error).toBe("not a clause");
      expect(diagnostics.filenamePatterns[0]!.location).toEqual({
        start: 0,
        end: 12,
        line: 1,
        column: 0,
      });
    });

    test("invalid matcher regex is reported and drops the rule", () => {
      const rules = router.parseRules("sourceurl: [[\ninto: x");
      // A bad regex would compile to a match-everything matcher, so the whole
      // rule is dropped rather than routing every download by it
      expect(rules.length).toBe(0);
      expect(diagnostics.filenamePatterns[0]!.error).toMatch(/SyntaxError/);
      expect(diagnostics.filenamePatterns[0]!.location).toEqual({
        start: 11,
        end: 13,
        line: 1,
        column: 11,
      });
    });

    test("supports backward-compatible matcher flags in the clause name", () => {
      const rules = router.parseRules("filename/i: CAT\\.JPG$\ninto: cats/:filename:");
      expect(router.matchRules(rules, { filename: "cat.jpg" })).toBe("cats/:filename:");
      expect(diagnostics.filenamePatterns).toEqual([]);
    });

    test("rejects unsupported or duplicate matcher flags", () => {
      expect(router.parseRules("filename/ii: cat\ninto: cats")).toEqual([]);
      expect(diagnostics.filenamePatterns[0]!.error).toContain("flags");
    });

    test("reports the flag span for an unsupported single matcher flag", () => {
      expect(router.parseRules("filename/z: cat\ninto: cats")).toEqual([]);
      expect(diagnostics.filenamePatterns[0]).toEqual(
        expect.objectContaining({
          error: expect.stringContaining("invalid regex flags: z"),
          location: expect.objectContaining({ line: 1 }),
        }),
      );
    });

    test.each([
      ["context: ^auto$\nsourcekind: image\ninto: files", "pageurl:"],
      ["context: ^auto$\npageurl: example\ninto: files", "sourceurl:"],
    ])("reports incomplete automatic routing constraints", (source, error) => {
      expect(router.parseRules(source)).toEqual([]);
      expect(diagnostics.filenamePatterns.at(-1)?.error).toBe(error);
    });

    test("warns when a later rule duplicates an earlier rule's matchers", () => {
      const result = router.parseRulesCollecting(
        "fileext: jpg\ninto: first\n\nfileext: jpg\ninto: second",
      );
      expect(result.rules).toHaveLength(2);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          warning: true,
          error: "rule 2",
          location: expect.objectContaining({ line: 4, column: 0 }),
        }),
      );
    });

    test("warns when a match-all rule shadows every later rule", () => {
      const result = router.parseRulesCollecting(
        "sourceurl: .*\ninto: first\n\nsourceurl: cat\\.jpg\ninto: second",
      );
      expect(result.errors).toContainEqual(
        expect.objectContaining({ warning: true, error: "rule 2" }),
      );
    });

    test("treats whitespace-only lines as rule separators", () => {
      const result = router.parseRulesCollecting(
        "fileext: jpg\ninto: images\n   \nfileext: pdf\ninto: documents",
      );

      expect(result.rules).toHaveLength(2);
      expect(result.errors).toEqual([]);
    });

    test("a capture destination without a capture clause is invalid", () => {
      const rules = router.parseRules("sourceurl: (dog)\ninto: cat:$1:");
      expect(rules.length).toBe(1);
      expect(diagnostics.filenamePatterns[0]).not.toHaveProperty("warning");
      expect(diagnostics.filenamePatterns[0]!.error).toBe("cat:$1:");
    });

    test("rejects a destination that references a capture index that cannot exist", () => {
      const rules = router.parseRules("sourceurl: (dog)\ncapture: sourceurl\ninto: cat/:$2:");
      expect(rules).toEqual([]);
      expect(diagnostics.filenamePatterns[0]!.error).toBe("cat/:$2:");
    });

    test("rejects an empty destination", () => {
      expect(router.parseRules("sourceurl: dog\ninto: ")).toEqual([]);
      expect(diagnostics.filenamePatterns.length).toBe(1);
    });

    test("rejects an unknown destination variable at its exact location", () => {
      const result = router.parseRulesCollecting(
        "fileext: pdf\ninto: pdfs/:weekday:-:naivefildeddname:",
      );

      expect(result.rules).toEqual([]);
      expect(result.errors).toContainEqual({
        message: "ruleUnknownDestinationVariable",
        error: ":naivefildeddname:",
        location: {
          start: 34,
          end: 52,
          line: 2,
          column: 21,
        },
      });
    });

    test("multiple into clauses are rejected", () => {
      const rules = router.parseRules("sourceurl: a\ninto: x\ninto: y");
      expect(rules).toEqual([]);
      expect(diagnostics.filenamePatterns.length).toBe(1);
    });

    test("multiple capture clauses are rejected", () => {
      const rules = router.parseRules(
        "sourceurl: a\ncapture: sourceurl\ncapture: sourceurl\ninto: x",
      );
      expect(rules).toEqual([]);
      expect(diagnostics.filenamePatterns.length).toBe(1);
    });

    test.each(["into", "capture"])(
      "rejects non-matcher capture target %s without throwing",
      (target) => {
        expect(() => router.parseRules(`sourceurl: a\ncapture: ${target}\ninto: x`)).not.toThrow();
        expect(router.parseRules(`sourceurl: a\ncapture: ${target}\ninto: x`)).toEqual([]);
        expect(diagnostics.filenamePatterns).toContainEqual(
          expect.objectContaining({ error: `capture: ${target}` }),
        );
      },
    );
  });

  describe("capture matching internals", () => {
    test("getCaptureMatches without a capture clause", () => {
      const rules = router.parseRules("sourceurl: dog\ninto: cat");
      expect(router.getCaptureMatches(rules[0]!, info)).toBe(null);
    });

    test("getCaptureMatches when the captured matcher does not match", () => {
      const rules = router.parseRules("sourceurl: (dog)\ncapture: sourceurl\ninto: :$1:");
      expect(router.getCaptureMatches(rules[0]!, { sourceUrl: "http://cat.com/" })).toBe(null);
    });

    test("matchRule returns the destination untouched without captures", () => {
      const rules = router.parseRules("sourceurl: dog\ninto: plain");
      expect(router.matchRules(rules, { sourceUrl: "http://dog.com/" })).toBe("plain");
    });

    test("a non-participating capture group is empty, not literal 'undefined'", () => {
      // The optional (extra-)? group doesn't match "dog", so :$2: is empty
      const rules = router.parseRules(
        "sourceurl: (dog)(extra)?\ncapture: sourceurl\ninto: a/:$1:/:$2:/b",
      );
      expect(router.matchRules(rules, { sourceUrl: "http://dog.com/" })).toBe("a/dog//b");
    });

    test("capturing context does not throw when metadata is absent", () => {
      const rules = router.parseRules("context: (media)\ncapture: context\ninto: :$1:");
      expect(() => router.getCaptureMatches(rules[0]!, { sourceUrl: "http://x/" })).not.toThrow();
    });

    test.each([
      ["context", "context", "media"],
      ["menuindex", "menuIndex", "2"],
      ["comment", "comment", "save"],
    ])("captures %s metadata", (matcherName, infoName, value) => {
      const rules = router.parseRules(
        `${matcherName}: (${value})\ncapture: ${matcherName}\ninto: group/:$1:`,
      );

      expect(router.matchRules(rules, { [infoName]: value })).toBe(`group/${value}`);
    });

    test("global matcher flags preserve capture groups", () => {
      const rules = router.parseRules("sourceurl/g: (dog)\ncapture: sourceurl\ninto: animals/:$1:");

      expect(router.matchRules(rules, { sourceUrl: "https://example.test/dog" })).toBe(
        "animals/dog",
      );
    });

    test("counts named captures while ignoring escaped, class, and lookbehind parentheses", () => {
      const { rules, errors } = router.parseRulesCollecting(
        String.raw`sourceurl: [()](?<named>a)\((?<=a)(b)
capturegroups: sourceurl
into: captures/:$1:/:$2:`,
      );

      expect(rules).toHaveLength(1);
      expect(errors).toEqual([]);
    });

    test("sticky matcher flags are deterministic across evaluations", async () => {
      const rules = router.parseRules(
        "sourceurl/y: (https)\ncapture: sourceurl\ninto: schemes/:$1:",
      );
      const stickyInfo = { sourceUrl: "https://example.test/file" };

      expect(router.matchRules(rules, stickyInfo)).toBe("schemes/https");
      expect(router.matchRules(rules, stickyInfo)).toBe("schemes/https");
      expect((await router.traceRules(rules, stickyInfo)).destination).toBe("schemes/https");
    });
  });

  describe("rule preview traces", () => {
    test("reports matcher outcomes and the fully expanded selected destination", async () => {
      const rules = router.parseRules(
        "fileext: png\ninto: images/:filename:\n\nfilename: .*\ninto: other/:filename:",
      );
      const trace = await router.traceRules(rules, {
        url: "https://x/cat.jpg",
        filename: "server.png",
        initialFilename: "cat.jpg",
      });
      expect(trace).toEqual(
        expect.objectContaining({
          initialFilename: "cat.jpg",
          actualFilename: "server.png",
          selectedRule: 2,
          destination: "other/:filename:",
          expandedDestination: "other/server.png",
          sanitizedDestination: "other/server.png",
          finalPath: "other/server.png",
          filenameDiagnostics: expect.objectContaining({ utf8Bytes: 10 }),
        }),
      );
      expect(trace.rules[0]!.clauses[0]!).toEqual(
        expect.objectContaining({ name: "fileext", matched: false }),
      );
    });

    test("explains the values and fallbacks tested by each matcher", async () => {
      const rules = router.parseRules("referrerurl: gallery\\.example\ninto: galleries/:filename:");

      const trace = await router.traceRules(rules, {
        filename: "photo.jpg",
        referrerUrl: "https://mail.example/thread/7",
        pageUrl: "https://gallery.example/album/42",
      });

      expect(trace.rules[0]?.clauses[0]).toMatchObject({
        matched: true,
        attempts: [
          {
            source: "referrerUrl",
            value: "https://mail.example/thread/7",
            status: "not-matched",
          },
          {
            source: "pageUrl",
            value: "https://gallery.example/album/42",
            status: "matched",
            matchedText: "gallery.example",
          },
        ],
      });
    });

    test("distinguishes missing matcher values from invalid derived values", async () => {
      const missing = await router.traceRules(router.parseRules("fileext: pdf\ninto: pdf/"), {});
      const invalid = await router.traceRules(
        router.parseRules("pagedomain: example\ninto: sites/"),
        { pageUrl: "not a URL" },
      );

      expect(missing.rules[0]?.clauses[0]?.attempts).toEqual([
        { source: "sourceUrl", value: null, status: "missing" },
      ]);
      expect(invalid.rules[0]?.clauses[0]?.attempts).toEqual([
        { source: "pageUrl", value: "not a URL", status: "invalid" },
      ]);
    });

    test("evaluates each matcher once while producing a trace", async () => {
      let calls = 0;
      const matcherOnly = [
        {
          type: constants.RULE_TYPES.MATCHER,
          name: "filename",
          value: /(file)/,
          matcher: () => {
            calls += 1;
            return ["file", "file"] as unknown as RegExpMatchArray;
          },
        },
        { type: constants.RULE_TYPES.CAPTURE, name: "capture", value: "filename" },
        { type: constants.RULE_TYPES.DESTINATION, name: "into", value: "files/:$1:" },
      ] as unknown as RoutingRule;

      const trace = await router.traceRules([matcherOnly], { filename: "file.txt" });

      expect(trace.destination).toBe("files/file");
      expect(calls).toBe(1);
    });

    test("uses the real variable pipeline and source URL fallback", async () => {
      const rules = router.parseRules(
        "sourceurl: cat\\.jpg$\ninto: archive/:year:/:naivefilename:",
      );

      const trace = await router.traceRules(rules, {
        sourceUrl: "https://x/cat.jpg",
        now: new Date("2026-07-14T00:00:00Z"),
      });

      expect(trace.expandedDestination).toBe("archive/2026/cat.jpg");
      expect(trace.finalPath).toBe("archive/2026/cat.jpg");
    });

    test.each([
      ["an absent tab", null],
      ["malformed fields", { title: 42, incognito: "yes" }],
    ])("does not interpolate %s", async (_description, tab) => {
      const rules = router.parseRules("filename: .*\ninto: preview/:pagetitle:");

      const trace = await router.traceRules(rules, {
        filename: "cat.jpg",
        currentTab: tab,
      });

      expect(trace.expandedDestination).toBe("preview/");
    });

    test("preserves valid tab fields while expanding the title", async () => {
      const rules = router.parseRules("filename: .*\ninto: preview/:pagetitle:");
      const trace = await router.traceRules(rules, {
        filename: "cat.jpg",
        currentTab: { title: "Private tab", incognito: true },
      });

      expect(trace.expandedDestination).toBe("preview/Private tab");
    });

    test("reports filename overflow against the active truncation setting", async () => {
      const previous = options.truncateLength;
      const filename = `${"a".repeat(246)}.txt`;

      try {
        options.truncateLength = 240;
        expect((await router.traceRules([], { filename })).filenameDiagnostics).toEqual({
          utf8Bytes: 250,
          limitBytes: 240,
          exceedsLimit: true,
        });

        options.truncateLength = 0;
        expect((await router.traceRules([], { filename })).filenameDiagnostics).toEqual({
          utf8Bytes: 250,
          limitBytes: 0,
          exceedsLimit: false,
        });
      } finally {
        options.truncateLength = previous;
      }
    });

    test("traces a defensive matcher-only rule without inventing a destination", async () => {
      const matcherOnly = [
        {
          type: constants.RULE_TYPES.MATCHER,
          name: "filename",
          value: ".*",
          matcher: () => ["file"] as unknown as RegExpMatchArray,
        },
      ] as unknown as RoutingRule;

      const trace = await router.traceRules([matcherOnly], { filename: "file.txt" });

      expect(trace.destination).toBeNull();
      expect(trace.sanitizedDestination).toBeNull();
      expect(trace.rules[0]?.destination).toBe("");
    });

    test("ignores a non-string capture declaration from a stale caller", () => {
      const rule = [
        { type: constants.RULE_TYPES.CAPTURE, name: "capture", value: 42 },
      ] as unknown as RoutingRule;

      expect(router.getCaptureMatches(rule, {})).toBeNull();
    });
  });

  describe("extension matcher aliases", () => {
    test("distinguishes URL and actual filename extensions", () => {
      const extensionInfo = { url: "https://x/opaque.bin", filename: "report.pdf" };
      expect(router.matcherFunctions.urlfileext(/bin/)(extensionInfo)).toBeTruthy();
      expect(router.matcherFunctions.actualfileext(/pdf/)(extensionInfo)).toBeTruthy();
      expect(router.matcherFunctions.actualfileext(/bin/)(extensionInfo)).toBeFalsy();
    });
  });

  describe("debug logging", () => {
    let logSpy: MockInstance;

    beforeAll(() => {
      debug = true;
    });

    afterAll(() => {
      debug = false;
    });

    beforeEach(() => {
      logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      logSpy.mockRestore();
    });

    test("logs every matcher type on a match", () => {
      router.matcherFunctions.frameurl(new RegExp(".*"))(info);
      router.matcherFunctions.pagetitle(new RegExp(".*"))(info);
      router.matcherFunctions.pagedomain(new RegExp(".*"))(info);
      router.matcherFunctions.context(new RegExp(".*"))(info, { context: "image" });
      router.matcherFunctions.menuindex(new RegExp(".*"))(info, { menuIndex: "1" });
      router.matcherFunctions.comment(new RegExp(".*"))(info, { comment: "c" });
      router.matcherFunctions.fileext(new RegExp(".*"))(info);
      router.matcherFunctions.filename(new RegExp(".*"))(info, { filename: "dog.jpg" });
      router.matcherFunctions.naivefilename(new RegExp(".*"))(info);

      expect(logSpy).toHaveBeenCalledTimes(9);
      expect(logSpy.mock.calls.every((call) => call[0] === "matched")).toBe(true);
    });

    test("logs unparseable page domains", () => {
      expect(router.matcherFunctions.pagedomain(new RegExp(".*"))({ pageUrl: "%%" })).toBe(null);
      expect(logSpy).toHaveBeenCalledWith("bad page domain in matcher", "%%", expect.anything());
    });

    test("logs parsed rules", () => {
      router.parseRules("sourceurl: a\ninto: x");
      expect(logSpy).toHaveBeenCalledWith("parsedRules", expect.any(Array));
    });
  });
});

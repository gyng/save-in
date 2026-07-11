import {
  Router as router,
  type MatcherResult,
  type RoutingRule,
  type RuleError,
  type RoutingInfo,
} from "../src/router.ts";
import * as constants from "../src/constants.ts";
import { currentTab, setCurrentTab } from "../src/current-tab.ts";
import type { MockInstance } from "vitest";

const fixtures = (await import("./fixtures/clickInfo")).default;

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
    window.optionErrors = {
      filenamePatterns: [],
      paths: [],
    };
    setCurrentTab({
      title: "some title",
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
      expect(expectMatch(matcher(info))[0]).toBe("jpg");
    });

    test("fileext negative", () => {
      const matcher = router.matcherFunctions.fileext(new RegExp("foobar"));
      expect(matcher(info)).toBe(null);
    });

    test("filename", () => {
      const matcher = router.matcherFunctions.filename(new RegExp("dog.jpg"));
      expect(expectMatch(matcher(info, { filename: "dog.jpg" })).length).toBe(1);
      expect(expectMatch(matcher(info, { filename: "dog.jpg" }))[0]).toBe("dog.jpg");
    });

    test("filename negative", () => {
      const matcher = router.matcherFunctions.filename(new RegExp("dog.jpg"));
      expect(matcher(info, { filename: "cat.jpg" })).toBe(null);
    });

    test("naivefilename", () => {
      const matcher = router.matcherFunctions.naivefilename(new RegExp("cat.jpg"));
      expect(expectMatch(matcher(info)).length).toBe(1);
      expect(expectMatch(matcher(info))[0]).toBe("cat.jpg");
    });

    test("naivefilename negative", () => {
      const matcher = router.matcherFunctions.naivefilename(new RegExp("dog.jpg"));
      expect(matcher(info)).toBe(null);
    });
    test("naivefilename negative", () => {
      const matcher = router.matcherFunctions.naivefilename(new RegExp("dog.jpg"));
      expect(matcher(info)).toBe(null);
    });

    test("infoMatcherFactory matchers", () => {
      const matcher = router.matcherFunctions.frameurl(new RegExp(".*"));
      expect(expectMatch(matcher(info)).length).toBe(1);
      expect(expectMatch(matcher(info))[0]).toBe(info.frameUrl);
    });

    test("infoMatcherFactory negative", () => {
      const matcher = router.matcherFunctions.frameurl(new RegExp("notvalid"));
      expect(matcher(info)).toBe(null);
    });

    test("tabMatcherFactory matchers", () => {
      const matcher = router.matcherFunctions.pagetitle(new RegExp(".*"));
      expect(expectMatch(matcher(info)).length).toBe(1);
      expect(expectMatch(matcher(info))[0]).toBe(currentTab?.title);
    });

    test("tabMatcherFactory negative", () => {
      const matcher = router.matcherFunctions.pagetitle(new RegExp("notvalid"));
      expect(matcher(info)).toBe(null);
    });
  });

  describe("rule parsing", () => {
    test("parsing valid rules", () => {
      const rules = router.parseRules(
        "sourceurl: dog\ninto: cat\n\npageurl:cat\ncapture: pageurl\ninto:dog",
      );
      expect(rules.length).toBe(2);
      expect(rules[0].length).toBe(2);
      expect(rules[0][0].name).toBe("sourceurl");
      expect(rules[0][0].type).toBe(constants.RULE_TYPES.MATCHER);
      expect(rules[0][1].name).toBe("into");
      expect(rules[0][1].type).toBe(constants.RULE_TYPES.DESTINATION);

      expect(rules[1].length).toBe(3);
      expect(rules[1][0].type).toBe(constants.RULE_TYPES.MATCHER);
      expect(rules[1][1].type).toBe(constants.RULE_TYPES.CAPTURE);
      expect(rules[1][1].value).toBe("pageurl");
      expect(rules[1][2].type).toBe(constants.RULE_TYPES.DESTINATION);
    });

    test("parsing missing into", () => {
      const rules = router.parseRules("sourceurl: dog\n\npageurl:cat\ncapture: pageurl\ninto:dog");

      expect(rules.length).toBe(1);
      expect(rules[0].length).toBe(3);
      expect(rules[0][0].name).toBe("pageurl");
    });

    test("parsing missing matcher", () => {
      const rules = router.parseRules("into: dog\n\npageurl:cat\ncapture: pageurl\ninto:dog");

      expect(rules.length).toBe(1);
      expect(rules[0].length).toBe(3);
      expect(rules[0][0].name).toBe("pageurl");
    });

    test("parsing multiple matchers", () => {
      const rules = router.parseRules(
        "into: dog\n\npageurl:cat\nsourceurl:pig\ncapture: pageurl,sourceurl\ninto:dog",
      );

      expect(rules.length).toBe(1);
      expect(rules[0].length).toBe(4);
      expect(rules[0].filter((r) => r.type === constants.RULE_TYPES.MATCHER).length).toBe(2);
      expect(rules[0][0].name).toBe("pageurl");
      expect(rules[0][0].value.toString()).toBe("/cat/");
      expect(rules[0][1].name).toBe("sourceurl");
      expect(rules[0][1].value.toString()).toBe("/pig/");
    });

    test("parsing unknown clause", () => {
      const rules = router.parseRules("what: dog\n\npageurl:cat\ncapture: pageurl\ninto:dog");

      expect(rules.length).toBe(1);
      expect(rules[0].length).toBe(3);
      expect(rules[0][0].name).toBe("pageurl");
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

      const clickInfo = fixtures.firefoxInfo as unknown as RoutingInfo;

      const matched = router.matchRules(twitterRulesFirefox, clickInfo);

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

      const clickInfo = fixtures.chromeInfo as unknown as RoutingInfo;

      const matched = router.matchRules(twitterRulesChrome, clickInfo);

      expect(matched).toBe("Di6uEBuVsAEYVBw.jpg");
    });
  });

  describe("additional matcher functions", () => {
    test("pagedomain", () => {
      const matcher = router.matcherFunctions.pagedomain(new RegExp("page.com"));
      expect(expectMatch(matcher(info))[0]).toBe("page.com");
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
      expect(expectMatch(matcher(info))[0]).toBe("source.com");
    });

    test("context matches case-insensitively", () => {
      const matcher = router.matcherFunctions.context(new RegExp("image"));
      expect(expectMatch(matcher(info, { context: "IMAGE" }))[0]).toBe("image");
      expect(router.matcherFunctions.context(new RegExp("link"))(info, { context: "IMAGE" })).toBe(
        null,
      );
    });

    test("menuindex", () => {
      const matcher = router.matcherFunctions.menuindex(new RegExp("^2$"));
      expect(expectMatch(matcher(info, { menuIndex: "2" }))[0]).toBe("2");
      expect(matcher(info, { menuIndex: "3" })).toBe(null);
      // missing menu metadata is treated as no match
      expect(matcher(info)).toBe(null);
    });

    test("comment", () => {
      const matcher = router.matcherFunctions.comment(new RegExp("save"));
      expect(expectMatch(matcher(info, { comment: "save here" }))[0]).toBe("save");
      expect(matcher(info, { comment: "other" })).toBe(null);
      // missing menu metadata is treated as no match
      expect(matcher(info)).toBe(null);
    });

    test("fileext falls back through URL fields", () => {
      const matcher = router.matcherFunctions.fileext(new RegExp("html"));
      expect(expectMatch(matcher({ linkUrl: "http://x.com/a.html" }))[0]).toBe("html");
      expect(expectMatch(matcher({ pageUrl: "http://x.com/b.html" }))[0]).toBe("html");
    });

    test("fileext without a URL or extension", () => {
      const matcher = router.matcherFunctions.fileext(new RegExp(".*"));
      expect(matcher({})).toBe(false);
      expect(matcher({ srcUrl: "http://x.com/noextension" })).toBe(false);
    });

    test("filename prefers info.filename", () => {
      const matcher = router.matcherFunctions.filename(new RegExp("dog.jpg"));
      expect(expectMatch(matcher({ filename: "dog.jpg" }, {}))[0]).toBe("dog.jpg");
    });

    test("filename missing everywhere", () => {
      const matcher = router.matcherFunctions.filename(new RegExp(".*"));
      expect(matcher({}, {})).toBe(false);
    });

    test("naivefilename falls back through URL fields", () => {
      const matcher = router.matcherFunctions.naivefilename(new RegExp("cat.jpg"));
      expect(expectMatch(matcher({ linkUrl: "http://x.com/cat.jpg" }))[0]).toBe("cat.jpg");
      expect(expectMatch(matcher({ pageUrl: "http://x.com/cat.jpg" }))[0]).toBe("cat.jpg");
    });

    test("naivefilename without a URL or filename", () => {
      const matcher = router.matcherFunctions.naivefilename(new RegExp(".*"));
      expect(matcher({})).toBe(false);
      expect(matcher({ srcUrl: "http://x.com/" })).toBe(false);
    });
  });

  describe("rule parsing errors", () => {
    beforeEach(() => {
      window.optionErrors = { filenamePatterns: [], paths: [] };
    });

    test("empty and comment-only rulesets parse to nothing", () => {
      expect(router.parseRules("")).toEqual([]);
      expect(router.parseRules("// just a comment\n\n// another")).toEqual([]);
    });

    test("bad clause syntax is reported", () => {
      const rules = router.parseRules("not a clause\ninto: x");
      expect(rules).toEqual([]);
      expect(window.optionErrors.filenamePatterns[0].error).toBe("not a clause");
    });

    test("an empty line inside a rule is reported as invalid syntax", () => {
      // tokenizeLines is pure: it reports into the passed collector
      const errors: RuleError[] = [];
      expect(router.tokenizeLines("", errors)).toEqual([]);
      expect(errors[0].error).toBe("invalid line syntax");
      expect(window.optionErrors.filenamePatterns).toEqual([]);
    });

    test("invalid matcher regex is reported and drops the rule", () => {
      const rules = router.parseRules("sourceurl: [[\ninto: x");
      // A bad regex would compile to a match-everything matcher, so the whole
      // rule is dropped rather than routing every download by it
      expect(rules.length).toBe(0);
      expect(window.optionErrors.filenamePatterns[0].error).toMatch(/SyntaxError/);
    });

    test("a capture destination without a capture clause warns", () => {
      const rules = router.parseRules("sourceurl: (dog)\ninto: cat:$1:");
      expect(rules.length).toBe(1);
      expect(window.optionErrors.filenamePatterns[0].warning).toBe(true);
      expect(window.optionErrors.filenamePatterns[0].error).toBe("cat:$1:");
    });

    test("multiple into clauses are rejected", () => {
      const rules = router.parseRules("sourceurl: a\ninto: x\ninto: y");
      expect(rules).toEqual([]);
      expect(window.optionErrors.filenamePatterns.length).toBe(1);
    });

    test("multiple capture clauses are rejected", () => {
      const rules = router.parseRules(
        "sourceurl: a\ncapture: sourceurl\ncapture: sourceurl\ninto: x",
      );
      expect(rules).toEqual([]);
      expect(window.optionErrors.filenamePatterns.length).toBe(1);
    });
  });

  describe("capture matching internals", () => {
    test("getCaptureMatches without a capture clause", () => {
      const rules = router.parseRules("sourceurl: dog\ninto: cat");
      expect(router.getCaptureMatches(rules[0], info)).toBe(null);
    });

    test("getCaptureMatches when the captured matcher does not match", () => {
      const rules = router.parseRules("sourceurl: (dog)\ncapture: sourceurl\ninto: :$1:");
      expect(router.getCaptureMatches(rules[0], { sourceUrl: "http://cat.com/" })).toBe(null);
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
      expect(() => router.getCaptureMatches(rules[0], { sourceUrl: "http://x/" })).not.toThrow();
    });
  });

  describe("debug logging", () => {
    let logSpy: MockInstance;

    beforeAll(() => {
      window.SI_DEBUG = 1;
    });

    afterAll(() => {
      window.SI_DEBUG = 0;
    });

    beforeEach(() => {
      logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
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
      expect(logSpy.mock.calls.every((c) => c[0] === "matched")).toBe(true);
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

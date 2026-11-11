import { cssTextSelectorsForPage, replayedCssTextCapture } from "../../src/routing/css-text.ts";
import {
  capturedCssTextFor,
  evaluateRule,
  matchRulesDetailed,
} from "../../src/routing/rule-matcher.ts";
import { parseRulesCollecting } from "../../src/routing/rule-parser.ts";
import { traceRules } from "../../src/routing/router.ts";
import { Path } from "../../src/routing/path.ts";
import { applyVariables, expandVariableTemplate } from "../../src/routing/variable.ts";
import { expandFetchUrl } from "../../src/routing/fetch-url.ts";
import { isCssTextMatcherClause, isSelectorMatcherName } from "../../src/routing/rule-types.ts";
import { MAX_CSS_TEXT_LENGTH, MAX_CSS_TEXT_SELECTORS } from "../../src/shared/css-text-capture.ts";

const rulesFor = (source: string) => {
  const parsed = parseRulesCollecting(source);
  expect(parsed.errors.filter((error) => !error.warning)).toEqual([]);
  return parsed.rules;
};

const AUTHOR_RULE = "csstext: header .author\ninto: authors/:csstext:/:filename:";

describe("csstext: parsing", () => {
  test("parses a selector clause whose text the rule may place with :csstext:", () => {
    const [rule] = rulesFor(AUTHOR_RULE);
    const clause = rule?.find((candidate) => candidate.name === "csstext");
    expect(clause).toMatchObject({ type: "MATCHER", value: "header .author" });
    expect(isSelectorMatcherName("csstext")).toBe(true);
    expect(isSelectorMatcherName("css")).toBe(true);
    expect(isSelectorMatcherName("pageurl")).toBe(false);
  });

  test("keeps the selector byte-for-byte, colons and escaped whitespace included", () => {
    const [rule] = rulesFor("csstext:a.user:not(.bot) > b\\ \ninto: x/:csstext:");
    expect(rule?.find((clause) => clause.name === "csstext")?.value).toBe(
      "a.user:not(.bot) > b\\ ",
    );
  });

  test.each([
    ["an empty selector", "csstext: \ninto: x/:filename:", "ruleInvalidCssSelector"],
    [
      "an oversized selector",
      `csstext: ${"x".repeat(513)}\ninto: x/:filename:`,
      "ruleInvalidCssSelector",
    ],
    ["regular-expression flags", "csstext/i: .author\ninto: x/:filename:", "ruleClauseFlags"],
    [
      "a second csstext: clause",
      "csstext: .author\ncsstext: .title\ninto: x/:csstext:",
      "ruleExtraCssText",
    ],
    [
      "a capture of the selector clause",
      "csstext: .author\ncapture: csstext\ninto: x/:$1:",
      "ruleCaptureMissingMatcher",
    ],
    [
      "a capturegroups of the selector clause",
      "csstext: .author\ncapturegroups: csstext\ninto: x/:$1:",
      "ruleCaptureMissingMatcher",
    ],
    [
      ":csstext: in into: without the clause",
      "pageurl: .\ninto: x/:csstext:",
      "ruleCssTextMissingClause",
    ],
    [
      ":csstext: in rename: without the clause",
      "pageurl: .\nrename: ^ -> :csstext:-\ninto: x/:filename:",
      "ruleCssTextMissingClause",
    ],
    [
      ":csstext: in fetch: without the clause",
      "pageurl: .\nfetch: https://example.com/:csstext:\ninto: x/:filename:",
      "ruleCssTextMissingClause",
    ],
  ])("rejects %s", (_label, source, message) => {
    const parsed = parseRulesCollecting(source);
    expect(parsed.rules).toEqual([]);
    expect(parsed.errors).toContainEqual(expect.objectContaining({ message }));
  });

  test("reports every clause that uses :csstext: without a csstext: clause", () => {
    const parsed = parseRulesCollecting(
      "pageurl: .\nfetch: https://example.com/:csstext:\nrename: ^ -> :csstext:\ninto: x/:csstext:",
    );
    expect(
      parsed.errors.filter((error) => error.message === "ruleCssTextMissingClause"),
    ).toHaveLength(3);
  });

  test("accepts :csstext: in every output clause of a rule that captures", () => {
    const [rule] = rulesFor(
      "csstext: .author\nfetch: https://example.com/:csstext:/full.jpg\nrename: ^ -> :csstext:-\ninto: x/:csstext:/:filename:",
    );
    expect(rule).toBeDefined();
    expect(rulesFor("csstext: .blocked\nexclude: true")).toHaveLength(1);
    // The clause is a matcher in its own right; the variable is optional.
    expect(rulesFor("csstext: .gallery\ninto: galleries/:filename:")).toHaveLength(1);
  });

  test("bounds the csstext: clauses of a whole configuration", () => {
    const rules = (count: number) =>
      Array.from(
        { length: count },
        (_value, index) => `csstext: .author-${index}\ninto: x/:csstext:`,
      ).join("\n\n");

    expect(rulesFor(rules(MAX_CSS_TEXT_SELECTORS))).toHaveLength(MAX_CSS_TEXT_SELECTORS);

    const over = parseRulesCollecting(rules(MAX_CSS_TEXT_SELECTORS + 1));
    expect(over.rules).toEqual([]);
    expect(over.errors).toContainEqual(
      expect.objectContaining({
        message: "ruleTooManyCssTextSelectors",
        error: `.author-${MAX_CSS_TEXT_SELECTORS}`,
      }),
    );
  });

  test("a disabled or invalid rule does not count toward the bound", () => {
    const live = Array.from(
      { length: MAX_CSS_TEXT_SELECTORS },
      (_value, index) => `csstext: .author-${index}\ninto: x/:csstext:`,
    ).join("\n\n");
    const parsed = parseRulesCollecting(
      `${live}\n\ndisabled: true\ncsstext: .parked\ninto: x/:csstext:`,
    );
    expect(parsed.rules).toHaveLength(MAX_CSS_TEXT_SELECTORS);
  });

  test("leaves rules that never mention csstext exactly as they were", () => {
    const source =
      "css: article img\npagedomain: ^example\\.com$\ninto: Articles/:filename:\n\nfilename/i: \\.pdf$\ncapturegroups: filename\ninto: docs/:$0:";
    const parsed = parseRulesCollecting(source);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rules.map((rule) => rule.map((clause) => clause.name))).toEqual([
      ["css", "pagedomain", "into"],
      ["filename", "capturegroups", "into"],
    ]);
    expect(
      matchRulesDetailed(parsed.rules, { filename: "Report.PDF", pageUrl: "https://other.test/" }),
    ).toEqual({
      outcome: "route",
      rule: parsed.rules[1],
      destination: "docs/.PDF",
      fetch: null,
      rename: null,
      tabAction: null,
    });
  });
});

describe("csstext: matching", () => {
  const [rule] = rulesFor(AUTHOR_RULE);
  if (!rule) throw new Error("fixture rule did not parse");

  test.each([
    ["the page reported text for the selector", [["header .author", "example author"]], true],
    ["the page reported text for another selector only", [[".title", "A title"]], false],
    ["the page reported nothing", [], false],
    ["there is no capture at all", undefined, false],
  ] as const)("when %s", (_label, capturedCssText, matched) => {
    const info = {
      filename: "cat.jpg",
      ...(capturedCssText ? { capturedCssText: capturedCssText.map((pair) => [...pair]) } : {}),
    } as Parameters<typeof evaluateRule>[1];
    const evaluation = evaluateRule(rule, info);

    expect(evaluation.outcome).toBe(matched ? "route" : null);
    expect(evaluation.cssText).toBe(matched ? "example author" : false);
    expect(evaluation.clauses[0]?.attempts).toEqual(
      matched
        ? [
            {
              source: "pageText",
              value: "example author",
              status: "matched",
              matchedText: "example author",
              captures: [],
            },
          ]
        : [{ source: "pageText", value: null, status: "missing" }],
    );

    const clause = rule.find((candidate) => candidate.name === "csstext");
    if (!clause || clause.type !== "MATCHER" || !isCssTextMatcherClause(clause)) {
      throw new Error("fixture clause missing");
    }
    expect(Boolean(clause.matcher(info))).toBe(matched);
    expect(capturedCssTextFor(info, "header .author")).toBe(matched ? "example author" : undefined);
  });

  test("the template keeps the variable: page text is never spliced into it", () => {
    const evaluation = evaluateRule(rule, {
      capturedCssText: [["header .author", ":sha256:/../x"]],
    });
    expect(evaluation.destination).toBe("authors/:csstext:/:filename:");
    expect(evaluation.cssText).toBe(":sha256:/../x");
  });

  test("the winning rule supplies the text, and a rule without the clause supplies none", () => {
    const rules = rulesFor(
      "pageurl: /first\ncsstext: .first\ninto: a/:csstext:\n\ncsstext: .second\ninto: b/:csstext:\n\npageurl: .\ninto: c/:filename:",
    );
    const capturedCssText: [string, string][] = [
      [".first", "First"],
      [".second", "Second"],
    ];
    expect(matchRulesDetailed(rules, { pageUrl: "https://x.test/first", capturedCssText })).toEqual(
      expect.objectContaining({ destination: "a/:csstext:", cssText: "First" }),
    );
    expect(matchRulesDetailed(rules, { pageUrl: "https://x.test/other", capturedCssText })).toEqual(
      expect.objectContaining({ destination: "b/:csstext:", cssText: "Second" }),
    );
    const plain = matchRulesDetailed(rules, { pageUrl: "https://x.test/other" });
    expect(plain).toEqual(expect.objectContaining({ destination: "c/:filename:" }));
    expect(plain).not.toHaveProperty("cssText");
  });

  test("an exclusion that matched on page text carries none", () => {
    const rules = rulesFor("csstext: .sponsored\nexclude: true");
    const match = matchRulesDetailed(rules, { capturedCssText: [[".sponsored", "Ad"]] });
    expect(match?.outcome).toBe("exclude");
    expect(match).not.toHaveProperty("cssText");
    expect(matchRulesDetailed(rules, { capturedCssText: [] })).toBeNull();
  });
});

describe(":csstext: expansion", () => {
  const expand = async (template: string, cssText: string | undefined) =>
    (await applyVariables(new Path(template), { cssText, filename: "cat.jpg" })).finalize();

  test("expands to the captured text as a folder or a file name", async () => {
    expect(await expand("authors/:csstext:/:filename:", "example author")).toBe(
      "authors/example author/cat.jpg",
    );
    expect(await expand("authors/:csstext:_:filename:", "example")).toBe("authors/example_cat.jpg");
  });

  test.each([
    ["path separators", "../../etc/passwd", "authors/_._.._etc_passwd/cat.jpg"],
    ["backslash separators", "..\\..\\windows", "authors/_._.._windows/cat.jpg"],
    ["a parent directory", "..", "authors/_/cat.jpg"],
    ["the current directory", ".", "authors/_/cat.jpg"],
    ["an absolute path", "/etc/passwd", "authors/_etc_passwd/cat.jpg"],
    ["a drive path", "C:\\Users", "authors/C__Users/cat.jpg"],
    ["control characters", "line\none\ttwo", "authors/line_one_two/cat.jpg"],
    ["a variable token", ":sha256:", "authors/_sha256_/cat.jpg"],
    ["a capture token", ":$1:", "authors/_$1_/cat.jpg"],
    ["nothing", undefined, "authors/_/cat.jpg"],
  ])("page text made of %s stays one sanitized component", async (_label, text, expected) => {
    const output = await expand("authors/:csstext:/:filename:", text);
    expect(output).toBe(expected);
    expect(output.split("/")).toHaveLength(3);
  });

  test("a rename replacement and a fetch address take the text verbatim, unexpanded", async () => {
    const info = { cssText: ":filename:/x", filename: "cat.jpg" };
    // Templates are expanded once: a token inside the text is literal text.
    expect(await expandVariableTemplate(":csstext:-", info)).toBe(":filename:/x-");
    expect(await expandFetchUrl("https://example.com/u/:csstext:", { cssText: "name" })).toBe(
      "https://example.com/u/name",
    );
  });
});

describe("csstext: in a trace", () => {
  const rules = rulesFor(
    "pageurl: /first\ncsstext: .first\ninto: a/:csstext:/:filename:\n\ncsstext: .second\nrename: ^ -> :csstext:-\ninto: b/:filename:",
  );

  test("a rule's own capture names the traced destination", async () => {
    const trace = await traceRules(rules, {
      pageUrl: "https://x.test/first",
      filename: "cat.jpg",
      capturedCssText: [[".first", "example/author"]],
    });
    expect(trace).toMatchObject({
      selectedRule: 1,
      destination: "a/:csstext:/:filename:",
      finalPath: "a/example_author/cat.jpg",
    });
    expect(trace.rules[0]?.clauses[1]).toMatchObject({
      name: "csstext",
      pattern: ".first",
      matched: true,
    });
  });

  test("a rename keeps separators in page text inside the file name", async () => {
    const trace = await traceRules(rules, {
      pageUrl: "https://x.test/other",
      filename: "cat.jpg",
      capturedCssText: [[".second", "../up"]],
    });
    expect(trace).toMatchObject({ selectedRule: 2, renamedTo: "../up-cat.jpg" });
    expect(trace.finalPath?.split("/")).toHaveLength(2);
    expect(trace.finalPath).toBe("b/_._up-cat.jpg");
  });

  test("replayed text stands in for every csstext: selector, normalized like a capture", async () => {
    const replay = await traceRules(rules, {
      pageUrl: "https://x.test/first",
      filename: "cat.jpg",
      cssText: "  recorded \n name ",
    });
    expect(replay).toMatchObject({ selectedRule: 1, finalPath: "a/recorded name/cat.jpg" });

    const second = await traceRules(rules, {
      pageUrl: "https://x.test/other",
      filename: "cat.jpg",
      cssText: "recorded",
    });
    expect(second).toMatchObject({ selectedRule: 2, finalPath: "b/recorded-cat.jpg" });
  });

  test("a real capture is never overridden by replayed text", async () => {
    const trace = await traceRules(rules, {
      pageUrl: "https://x.test/first",
      filename: "cat.jpg",
      cssText: "stale",
      capturedCssText: [[".second", "fresh"]],
    });
    expect(trace).toMatchObject({ selectedRule: 2, finalPath: "b/fresh-cat.jpg" });
  });

  test("without any page text no csstext: rule is selected", async () => {
    const trace = await traceRules(rules, {
      pageUrl: "https://x.test/first",
      filename: "cat.jpg",
    });
    expect(trace.selectedRule).toBeNull();
    expect(trace.rules[0]?.clauses[1]).toMatchObject({ name: "csstext", matched: false });
  });

  test("a rule the trace may not run reports no capture", async () => {
    const trace = await traceRules(
      rules,
      { filename: "cat.jpg", cssText: "recorded" },
      () => false,
    );
    expect(trace.selectedRule).toBeNull();
  });
});

describe("selectors worth reading on a page", () => {
  const rules = rulesFor(
    [
      "pagedomain: ^photos\\.example$\ncsstext: header .author\ninto: a/:csstext:",
      "pageurl: /gallery/\npagerootdomain: ^example\\.com$\ncsstext: .gallery-title\ninto: b/:csstext:",
      "sourcekind: ^image$\ncsstext: .anywhere\ninto: c/:csstext:",
      "pagedomain: ^photos\\.example$\ncsstext: header .author\ninto: d/:csstext:",
      "pagedomain: ^photos\\.example$\ninto: e/:filename:",
    ].join("\n\n"),
  );

  test.each([
    ["https://photos.example/post/1", ["header .author", ".anywhere"]],
    ["https://www.example.com/gallery/2", [".gallery-title", ".anywhere"]],
    // Every page condition of a rule has to hold, not just one of them.
    ["https://www.example.com/post/2", [".anywhere"]],
    ["https://elsewhere.test/", [".anywhere"]],
    [undefined, [".anywhere"]],
    ["not a url", [".anywhere"]],
  ])("on %j", (pageUrl, expected) => {
    expect(cssTextSelectorsForPage(rules, pageUrl)).toEqual(expected);
  });

  test("reads nothing when no rule captures page text", () => {
    expect(
      cssTextSelectorsForPage(rulesFor("pageurl: .\ninto: x/:filename:"), "https://x/"),
    ).toEqual([]);
    expect(cssTextSelectorsForPage([], "https://x/")).toEqual([]);
  });

  test("replays one text for each distinct selector, and nothing for empty text", () => {
    expect(replayedCssTextCapture(rules, " recorded\nname ")).toEqual([
      ["header .author", "recorded name"],
      [".gallery-title", "recorded name"],
      [".anywhere", "recorded name"],
    ]);
    expect(
      replayedCssTextCapture(rules, "x".repeat(MAX_CSS_TEXT_LENGTH + 1))?.[0]?.[1],
    ).toHaveLength(MAX_CSS_TEXT_LENGTH);
    expect(replayedCssTextCapture(rules, "  ")).toBeUndefined();
    expect(replayedCssTextCapture(rules, undefined)).toBeUndefined();
    expect(replayedCssTextCapture([], "recorded")).toEqual([]);
  });
});

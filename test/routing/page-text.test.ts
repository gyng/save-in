import {
  pageTextSelectorOf,
  pageTextSelectorsForPage,
  replayedPageTextCapture,
} from "../../src/routing/page-text.ts";
import {
  capturedPageTextFor,
  evaluateRule,
  matchRulesDetailed,
} from "../../src/routing/rule-matcher.ts";
import { parseRulesCollecting } from "../../src/routing/rule-parser.ts";
import { traceRules } from "../../src/routing/router.ts";
import { Path } from "../../src/routing/path.ts";
import { applyVariables, expandVariableTemplate } from "../../src/routing/variable.ts";
import { expandFetchUrl } from "../../src/routing/fetch-url.ts";
import { isPageTextMatcherClause, isSelectorMatcherName } from "../../src/routing/rule-types.ts";
import {
  MAX_PAGE_TEXT_LENGTH,
  MAX_PAGE_TEXT_SELECTORS,
} from "../../src/shared/page-text-capture.ts";

const rulesFor = (source: string) => {
  const parsed = parseRulesCollecting(source);
  expect(parsed.errors.filter((error) => !error.warning)).toEqual([]);
  return parsed.rules;
};

const AUTHOR_RULE = "pagetext: header .author\ninto: authors/:pagetext:/:filename:";

describe("pagetext: parsing", () => {
  test("parses a selector clause whose text the rule may place with :pagetext:", () => {
    const [rule] = rulesFor(AUTHOR_RULE);
    const clause = rule?.find((candidate) => candidate.name === "pagetext");
    expect(clause).toMatchObject({ type: "MATCHER", value: "header .author" });
    expect(isSelectorMatcherName("pagetext")).toBe(true);
    expect(isSelectorMatcherName("css")).toBe(true);
    expect(isSelectorMatcherName("pageurl")).toBe(false);
  });

  test("keeps the selector byte-for-byte, colons and escaped whitespace included", () => {
    const [rule] = rulesFor("pagetext:a.user:not(.bot) > b\\ \ninto: x/:pagetext:");
    expect(rule?.find((clause) => clause.name === "pagetext")?.value).toBe(
      "a.user:not(.bot) > b\\ ",
    );
  });

  test.each([
    ["an empty selector", "pagetext: \ninto: x/:filename:", "ruleInvalidCssSelector"],
    [
      "an oversized selector",
      `pagetext: ${"x".repeat(513)}\ninto: x/:filename:`,
      "ruleInvalidCssSelector",
    ],
    ["regular-expression flags", "pagetext/i: .author\ninto: x/:filename:", "ruleClauseFlags"],
    [
      "a second pagetext: clause",
      "pagetext: .author\npagetext: .title\ninto: x/:pagetext:",
      "ruleExtraPageText",
    ],
    [
      "a capture of the selector clause",
      "pagetext: .author\ncapture: pagetext\ninto: x/:$1:",
      "ruleCaptureMissingMatcher",
    ],
    [
      "a capturegroups of the selector clause",
      "pagetext: .author\ncapturegroups: pagetext\ninto: x/:$1:",
      "ruleCaptureMissingMatcher",
    ],
    [
      ":pagetext: in into: without the clause",
      "pageurl: .\ninto: x/:pagetext:",
      "rulePageTextMissingClause",
    ],
    [
      ":pagetext: in rename: without the clause",
      "pageurl: .\nrename: ^ -> :pagetext:-\ninto: x/:filename:",
      "rulePageTextMissingClause",
    ],
    [
      ":pagetext: in fetch: without the clause",
      "pageurl: .\nfetch: https://example.com/:pagetext:\ninto: x/:filename:",
      "rulePageTextMissingClause",
    ],
  ])("rejects %s", (_label, source, message) => {
    const parsed = parseRulesCollecting(source);
    expect(parsed.rules).toEqual([]);
    expect(parsed.errors).toContainEqual(expect.objectContaining({ message }));
  });

  test("reports every clause that uses :pagetext: without a pagetext: clause", () => {
    const parsed = parseRulesCollecting(
      "pageurl: .\nfetch: https://example.com/:pagetext:\nrename: ^ -> :pagetext:\ninto: x/:pagetext:",
    );
    expect(
      parsed.errors.filter((error) => error.message === "rulePageTextMissingClause"),
    ).toHaveLength(3);
  });

  test("accepts :pagetext: in every output clause of a rule that captures", () => {
    const [rule] = rulesFor(
      "pagetext: .author\nfetch: https://example.com/:pagetext:/full.jpg\nrename: ^ -> :pagetext:-\ninto: x/:pagetext:/:filename:",
    );
    expect(rule).toBeDefined();
    expect(rulesFor("pagetext: .blocked\nexclude: true")).toHaveLength(1);
    // The clause is a matcher in its own right; the variable is optional.
    expect(rulesFor("pagetext: .gallery\ninto: galleries/:filename:")).toHaveLength(1);
  });

  test("bounds the pagetext: clauses of a whole configuration", () => {
    const rules = (count: number) =>
      Array.from(
        { length: count },
        (_value, index) => `pagetext: .author-${index}\ninto: x/:pagetext:`,
      ).join("\n\n");

    expect(rulesFor(rules(MAX_PAGE_TEXT_SELECTORS))).toHaveLength(MAX_PAGE_TEXT_SELECTORS);

    const over = parseRulesCollecting(rules(MAX_PAGE_TEXT_SELECTORS + 1));
    expect(over.rules).toEqual([]);
    expect(over.errors).toContainEqual(
      expect.objectContaining({
        message: "ruleTooManyPageTextSelectors",
        error: `.author-${MAX_PAGE_TEXT_SELECTORS}`,
      }),
    );
  });

  test("a disabled or invalid rule does not count toward the bound", () => {
    const live = Array.from(
      { length: MAX_PAGE_TEXT_SELECTORS },
      (_value, index) => `pagetext: .author-${index}\ninto: x/:pagetext:`,
    ).join("\n\n");
    const parsed = parseRulesCollecting(
      `${live}\n\ndisabled: true\npagetext: .parked\ninto: x/:pagetext:`,
    );
    expect(parsed.rules).toHaveLength(MAX_PAGE_TEXT_SELECTORS);
  });

  test("leaves rules that never mention pagetext exactly as they were", () => {
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

describe("pagetext: matching", () => {
  const [rule] = rulesFor(AUTHOR_RULE);
  if (!rule) throw new Error("fixture rule did not parse");

  test.each([
    ["the page reported text for the selector", [["header .author", "example author"]], true],
    ["the page reported text for another selector only", [[".title", "A title"]], false],
    ["the page reported nothing", [], false],
    ["there is no capture at all", undefined, false],
  ] as const)("when %s", (_label, capturedPageText, matched) => {
    const info = {
      filename: "cat.jpg",
      ...(capturedPageText ? { capturedPageText: capturedPageText.map((pair) => [...pair]) } : {}),
    } as Parameters<typeof evaluateRule>[1];
    const evaluation = evaluateRule(rule, info);

    expect(evaluation.outcome).toBe(matched ? "route" : null);
    expect(evaluation.pageText).toBe(matched ? "example author" : false);
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

    const clause = rule.find((candidate) => candidate.name === "pagetext");
    if (!clause || clause.type !== "MATCHER" || !isPageTextMatcherClause(clause)) {
      throw new Error("fixture clause missing");
    }
    expect(Boolean(clause.matcher(info))).toBe(matched);
    expect(capturedPageTextFor(info, "header .author")).toBe(
      matched ? "example author" : undefined,
    );
  });

  test("the template keeps the variable: page text is never spliced into it", () => {
    const evaluation = evaluateRule(rule, {
      capturedPageText: [["header .author", ":sha256:/../x"]],
    });
    expect(evaluation.destination).toBe("authors/:pagetext:/:filename:");
    expect(evaluation.pageText).toBe(":sha256:/../x");
  });

  test("the winning rule supplies the text, and a rule without the clause supplies none", () => {
    const rules = rulesFor(
      "pageurl: /first\npagetext: .first\ninto: a/:pagetext:\n\npagetext: .second\ninto: b/:pagetext:\n\npageurl: .\ninto: c/:filename:",
    );
    const capturedPageText: [string, string][] = [
      [".first", "First"],
      [".second", "Second"],
    ];
    expect(
      matchRulesDetailed(rules, { pageUrl: "https://x.test/first", capturedPageText }),
    ).toEqual(expect.objectContaining({ destination: "a/:pagetext:", pageText: "First" }));
    expect(
      matchRulesDetailed(rules, { pageUrl: "https://x.test/other", capturedPageText }),
    ).toEqual(expect.objectContaining({ destination: "b/:pagetext:", pageText: "Second" }));
    const plain = matchRulesDetailed(rules, { pageUrl: "https://x.test/other" });
    expect(plain).toEqual(expect.objectContaining({ destination: "c/:filename:" }));
    expect(plain).not.toHaveProperty("pageText");
  });

  test("an exclusion that matched on page text carries none", () => {
    const rules = rulesFor("pagetext: .sponsored\nexclude: true");
    const match = matchRulesDetailed(rules, { capturedPageText: [[".sponsored", "Ad"]] });
    expect(match?.outcome).toBe("exclude");
    expect(match).not.toHaveProperty("pageText");
    expect(matchRulesDetailed(rules, { capturedPageText: [] })).toBeNull();
  });
});

describe(":pagetext: expansion", () => {
  const expand = async (template: string, pageText: string | undefined) =>
    (await applyVariables(new Path(template), { pageText, filename: "cat.jpg" })).finalize();

  test("expands to the captured text as a folder or a file name", async () => {
    expect(await expand("authors/:pagetext:/:filename:", "example author")).toBe(
      "authors/example author/cat.jpg",
    );
    expect(await expand("authors/:pagetext:_:filename:", "example")).toBe(
      "authors/example_cat.jpg",
    );
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
    const output = await expand("authors/:pagetext:/:filename:", text);
    expect(output).toBe(expected);
    expect(output.split("/")).toHaveLength(3);
  });

  test("a rename replacement and a fetch address take the text verbatim, unexpanded", async () => {
    const info = { pageText: ":filename:/x", filename: "cat.jpg" };
    // Templates are expanded once: a token inside the text is literal text.
    expect(await expandVariableTemplate(":pagetext:-", info)).toBe(":filename:/x-");
    expect(await expandFetchUrl("https://example.com/u/:pagetext:", { pageText: "name" })).toBe(
      "https://example.com/u/name",
    );
  });
});

describe("pagetext: in a trace", () => {
  const rules = rulesFor(
    "pageurl: /first\npagetext: .first\ninto: a/:pagetext:/:filename:\n\npagetext: .second\nrename: ^ -> :pagetext:-\ninto: b/:filename:",
  );

  test("a rule's own capture names the traced destination", async () => {
    const trace = await traceRules(rules, {
      pageUrl: "https://x.test/first",
      filename: "cat.jpg",
      capturedPageText: [[".first", "example/author"]],
    });
    expect(trace).toMatchObject({
      selectedRule: 1,
      destination: "a/:pagetext:/:filename:",
      finalPath: "a/example_author/cat.jpg",
    });
    expect(trace.rules[0]?.clauses[1]).toMatchObject({
      name: "pagetext",
      pattern: ".first",
      matched: true,
    });
  });

  test("a rename keeps separators in page text inside the file name", async () => {
    const trace = await traceRules(rules, {
      pageUrl: "https://x.test/other",
      filename: "cat.jpg",
      capturedPageText: [[".second", "../up"]],
    });
    expect(trace).toMatchObject({ selectedRule: 2, renamedTo: "../up-cat.jpg" });
    expect(trace.finalPath?.split("/")).toHaveLength(2);
    expect(trace.finalPath).toBe("b/_._up-cat.jpg");
  });

  test("replayed text stands in for every pagetext: selector, normalized like a capture", async () => {
    const replay = await traceRules(rules, {
      pageUrl: "https://x.test/first",
      filename: "cat.jpg",
      pageText: "  recorded \n name ",
    });
    expect(replay).toMatchObject({ selectedRule: 1, finalPath: "a/recorded name/cat.jpg" });

    const second = await traceRules(rules, {
      pageUrl: "https://x.test/other",
      filename: "cat.jpg",
      pageText: "recorded",
    });
    expect(second).toMatchObject({ selectedRule: 2, finalPath: "b/recorded-cat.jpg" });
  });

  test("replayed text with its recorded selector reaches only that rule", async () => {
    const trace = await traceRules(rules, {
      pageUrl: "https://x.test/first",
      filename: "cat.jpg",
      pageText: "recorded",
      pageTextSelector: ".second",
    });
    expect(trace).toMatchObject({ selectedRule: 2, finalPath: "b/recorded-cat.jpg" });
    expect(trace.rules[0]?.clauses[1]).toMatchObject({ name: "pagetext", matched: false });
  });

  test("a real capture is never overridden by replayed text", async () => {
    const trace = await traceRules(rules, {
      pageUrl: "https://x.test/first",
      filename: "cat.jpg",
      pageText: "stale",
      capturedPageText: [[".second", "fresh"]],
    });
    expect(trace).toMatchObject({ selectedRule: 2, finalPath: "b/fresh-cat.jpg" });
  });

  test("without any page text no pagetext: rule is selected", async () => {
    const trace = await traceRules(rules, {
      pageUrl: "https://x.test/first",
      filename: "cat.jpg",
    });
    expect(trace.selectedRule).toBeNull();
    expect(trace.rules[0]?.clauses[1]).toMatchObject({ name: "pagetext", matched: false });
  });

  test("a rule the trace may not run reports no capture", async () => {
    const trace = await traceRules(
      rules,
      { filename: "cat.jpg", pageText: "recorded" },
      () => false,
    );
    expect(trace.selectedRule).toBeNull();
  });
});

describe("selectors worth reading on a page", () => {
  const rules = rulesFor(
    [
      "pagedomain: ^photos\\.example$\npagetext: header .author\ninto: a/:pagetext:",
      "pageurl: /gallery/\npagerootdomain: ^example\\.com$\npagetext: .gallery-title\ninto: b/:pagetext:",
      "sourcekind: ^image$\npagetext: .anywhere\ninto: c/:pagetext:",
      "pagedomain: ^photos\\.example$\npagetext: header .author\ninto: d/:pagetext:",
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
    expect(pageTextSelectorsForPage(rules, pageUrl)).toEqual(expected);
  });

  test("reads nothing when no rule captures page text", () => {
    expect(
      pageTextSelectorsForPage(rulesFor("pageurl: .\ninto: x/:filename:"), "https://x/"),
    ).toEqual([]);
    expect(pageTextSelectorsForPage([], "https://x/")).toEqual([]);
  });

  test("replays one text for each distinct selector, and nothing for empty text", () => {
    expect(replayedPageTextCapture(rules, " recorded\nname ")).toEqual([
      ["header .author", "recorded name"],
      [".gallery-title", "recorded name"],
      [".anywhere", "recorded name"],
    ]);
    expect(
      replayedPageTextCapture(rules, "x".repeat(MAX_PAGE_TEXT_LENGTH + 1))?.[0]?.[1],
    ).toHaveLength(MAX_PAGE_TEXT_LENGTH);
    expect(replayedPageTextCapture(rules, "  ")).toBeUndefined();
    expect(replayedPageTextCapture(rules, undefined)).toBeUndefined();
    expect(replayedPageTextCapture([], "recorded")).toEqual([]);
  });

  // A History row names the selector its text came from; the replay offers the
  // text to that selector alone while a rule still uses it. Typed text, older
  // rows, and a selector since edited out of the rules offer it to every one.
  test.each([
    ["a recorded selector one rule uses", ".gallery-title", [[".gallery-title", "recorded name"]]],
    [
      "a recorded selector no rule uses any more",
      ".gone",
      [
        ["header .author", "recorded name"],
        [".gallery-title", "recorded name"],
        [".anywhere", "recorded name"],
      ],
    ],
    [
      "no recorded selector (older row or typed text)",
      undefined,
      [
        ["header .author", "recorded name"],
        [".gallery-title", "recorded name"],
        [".anywhere", "recorded name"],
      ],
    ],
    [
      "an empty recorded selector",
      "",
      [
        ["header .author", "recorded name"],
        [".gallery-title", "recorded name"],
        [".anywhere", "recorded name"],
      ],
    ],
  ])("replays for %s", (_label, selector, expected) => {
    expect(replayedPageTextCapture(rules, " recorded\nname ", selector)).toEqual(expected);
  });

  test("a recorded selector with no text replays nothing", () => {
    expect(replayedPageTextCapture(rules, " ", ".gallery-title")).toBeUndefined();
  });

  test("names a rule's own pagetext: selector, or none", () => {
    expect(rules.map(pageTextSelectorOf)).toEqual([
      "header .author",
      ".gallery-title",
      ".anywhere",
      "header .author",
      undefined,
    ]);
  });
});

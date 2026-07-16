import {
  buildRuleAuthoringPrompt,
  buildRuleCritiquePrompt,
  cleanRuleSuggestion,
  isSingleRuleSuggestion,
  parseRuleCritique,
  parseRuleDraft,
  ruleRequestGuardrailIssues,
} from "../../../src/options/integrations/prompt-assistant-model.ts";

const grammar = {
  id: "routing" as const,
  option: "filenamePatterns" as const,
  ebnf: 'rule = matcher, "into:", destination ;',
  semantics: ["Blank lines separate rules.", "A rule ends with an into destination."],
  examples: ["fileext: ^png$\ninto: Images/:filename:"],
};

describe("Prompt API rule-authoring model", () => {
  test("builds a bounded grammar-grounded request for one rule", () => {
    const result = buildRuleAuthoringPrompt("Put PNG files in Images", grammar, {
      matchers: ["fileext", "pagedomain"],
      variables: ["filename", "pagedomain"],
    });

    expect(result).toContain("Put PNG files in Images");
    expect(result).toContain(grammar.ebnf);
    expect(result).not.toContain(grammar.examples[0]);
    expect(result).toContain("fileext, pagedomain");
    expect(result).toContain(":filename:, :pagedomain:");
    expect(result).toContain("Return JSON matching the supplied response schema");
    expect(result).toContain("Do not add file types, sites, folders, renames, or behavior");
  });

  test("extracts a fenced rule without retaining Markdown", () => {
    expect(
      cleanRuleSuggestion("Here is the rule:\n```text\nfileext: ^png$\ninto: Images\n```"),
    ).toBe("fileext: ^png$\ninto: Images");
  });

  test("preserves an unfenced rule and rejects empty output", () => {
    expect(cleanRuleSuggestion("  fileext: ^png$\ninto: Images  ")).toBe(
      "fileext: ^png$\ninto: Images",
    );
    expect(cleanRuleSuggestion("  \n ")).toBeNull();
    expect(cleanRuleSuggestion("```text\n   \n```")).toBeNull();
  });

  test("distinguishes one semantic rule from a multi-rule response", () => {
    expect(isSingleRuleSuggestion("fileext: ^png$\ninto: Images/")).toBe(true);
    expect(
      isSingleRuleSuggestion("fileext: ^png$\ninto: Images/\n\nfileext: ^jpg$\ninto: Photos/"),
    ).toBe(false);
  });

  test("parses constrained author and critic responses at the runtime boundary", () => {
    expect(parseRuleDraft(JSON.stringify({ rule: "fileext: ^png$\ninto: dongs/" }))).toBe(
      "fileext: ^png$\ninto: dongs/",
    );
    expect(
      parseRuleCritique(
        JSON.stringify({
          accepted: false,
          issues: ["Wrong folder"],
          repairedRule: "fileext: ^png$\ninto: dongs/",
        }),
      ),
    ).toEqual({
      accepted: false,
      issues: ["Wrong folder"],
      repairedRule: "fileext: ^png$\ninto: dongs/",
    });
    expect(parseRuleDraft("not JSON")).toBeNull();
    expect(parseRuleCritique(JSON.stringify({ accepted: true, issues: [] }))).toBeNull();
  });

  test("grounds the independent review in the request, candidate, and validator findings", () => {
    const result = buildRuleCritiquePrompt(
      "save png into /dongs",
      "fileext/i: ^(?:png|jpe?g)$\ninto: Images/:filename:",
      [
        "The fileext matcher also matches unrequested file types (jpeg, jpg).",
        "The destination must use the requested dongs/ folder.",
      ],
      grammar,
      { matchers: ["fileext"], variables: ["filename"] },
    );

    expect(result).toContain(JSON.stringify("save png into /dongs"));
    expect(result).toContain(JSON.stringify("fileext/i: ^(?:png|jpe?g)$\ninto: Images/:filename:"));
    expect(result).toContain("all and only the requested behavior");
    expect(result).toContain("The destination must use the requested dongs/ folder.");
  });

  test.each([
    [
      "save png into /dongs",
      "fileext/i: ^(?:png|jpe?g)$\ninto: Images/:filename:",
      [
        "The fileext matcher also matches unrequested file types (jpeg, jpg).",
        "The destination must use the requested dongs/ folder.",
      ],
    ],
    [
      "save png into /dongs",
      "pagedomain: .*\ninto: dongs/:filename:",
      ["The request names png file types, but the rule has no fileext matcher."],
    ],
    [
      "save png into /dongs",
      "fileext: ^jpg$\ninto: dongs/:filename:",
      [
        "The fileext matcher does not match the requested png type.",
        "The fileext matcher also matches unrequested file types (jpg).",
      ],
    ],
    [
      "save png into /dongs",
      "fileext: ^png$\ninto: dongs",
      ["The destination must use the requested dongs/ folder."],
    ],
    ["save png into /dongs", "fileext/i: ^png$\ninto: dongs/:filename:", []],
    [
      "from docs.example.com, save PDF and PNG files into /archive",
      "fileext/i: ^(?:pdf|png)$\npagedomain: ^docs\\.example\\.com$\ninto: archive/:filename:",
      [],
    ],
    [
      "from docs.example.com, save PDF into /archive",
      "fileext/i: ^pdf$\npagedomain: ^other\\.example$\ninto: archive/:filename:",
      ["The matchers do not contain the requested docs.example.com site."],
    ],
  ] as const)("checks explicit request anchors for %s", (request, rule, expected) => {
    const issues = ruleRequestGuardrailIssues(request, rule);
    expect(issues).toEqual(expected);
  });
});

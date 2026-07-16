import {
  applyRuleRequestGuardrails,
  buildRuleAuthoringPrompt,
  cleanRuleSuggestion,
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
    expect(result).toContain(grammar.examples[0]);
    expect(result).toContain("fileext, pagedomain");
    expect(result).toContain(":filename:, :pagedomain:");
    expect(result).toContain("Return exactly one rule");
    expect(result).toContain("Do not use Markdown");
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

  test.each([
    ["save images to /Pictures", "sourcekind: ^image$\ninto: Pictures/:filename:"],
    ["save photos into /Pictures please", "sourcekind: ^image$\ninto: Pictures/:filename:"],
  ])("does not mistake category nouns or politeness for grammar values: %s", (request, rule) => {
    expect(ruleRequestGuardrailIssues(request, rule)).toEqual([]);
  });

  test("checks explicit file extensions and extension-relative folders", () => {
    expect(
      ruleRequestGuardrailIssues(
        "save PNG files into /Pictures please",
        "fileext/i: ^jpe?g$\ninto: Images/:filename:",
      ),
    ).toEqual([
      "The fileext matcher does not match the requested png type.",
      "The fileext matcher also matches unrequested file types (jpeg, jpg).",
      "The destination must use the requested Pictures/ folder.",
    ]);
  });

  test("locks explicit extensions and folders without discarding unrelated matchers", () => {
    expect(
      applyRuleRequestGuardrails(
        "save png into /dongs",
        "pagedomain: ^example\\.com$\nfileext/png: ^(?:png|jpe?g)$\ninto: Dongs/:filename:",
      ),
    ).toBe("pagedomain: ^example\\.com$\nfileext/i: ^png$\ninto: dongs/:filename:");
  });

  test("does not invent an extension for a media category or override an explicit rename", () => {
    expect(
      applyRuleRequestGuardrails(
        "save images into /Pictures",
        "sourcekind: ^image$\ninto: elsewhere/:filename:",
      ),
    ).toBe("sourcekind: ^image$\ninto: Pictures/:filename:");
    expect(
      applyRuleRequestGuardrails(
        "save PNG into /Pictures and rename it",
        "fileext: png\ninto: Pictures/custom.png",
      ),
    ).toBe("fileext/i: ^png$\ninto: Pictures/custom.png");
  });
});

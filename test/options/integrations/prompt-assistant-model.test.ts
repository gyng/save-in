import {
  buildRuleAuthoringPrompt,
  cleanRuleSuggestion,
  isSingleRuleSuggestion,
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
  });

  test("distinguishes one semantic rule from a multi-rule response", () => {
    expect(isSingleRuleSuggestion("fileext: ^png$\ninto: Images")).toBe(true);
    expect(
      isSingleRuleSuggestion("fileext: ^png$\ninto: Images\n\nfileext: ^jpg$\ninto: Photos"),
    ).toBe(false);
  });
});

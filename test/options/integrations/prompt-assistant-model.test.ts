import {
  buildRuleAuthoringPrompt,
  cleanRuleSuggestion,
  isSingleRuleSuggestion,
  ruleSuggestionFidelityError,
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
    expect(result).toContain("Do not add file types");
    expect(result).toContain("remove only the leading slash");
  });

  test("puts exact extracted constraints after examples and the user request", () => {
    const result = buildRuleAuthoringPrompt("save png into /dongs", grammar, {
      matchers: ["fileext"],
      variables: ["filename"],
    });

    expect(result).toContain("fileext must match only: png");
    expect(result).toContain("into destination folder must be exactly: dongs");
    expect(result).toContain("bare into: dongs would rename the file and is wrong");
    expect(result.indexOf("Exact constraints")).toBeGreaterThan(result.indexOf("User request:"));
  });

  test("rejects a model draft that broadens an explicit file type", () => {
    expect(
      ruleSuggestionFidelityError(
        "save png into /dongs",
        "fileext/i: ^(?:png|jpe?g)$\ninto: Images/:filename:",
      ),
    ).toBe("The generated file types do not exactly match the request");
    expect(
      ruleSuggestionFidelityError(
        "save png into /dongs",
        "fileext/i: ^png$\ninto: dongs/:filename:",
      ),
    ).toBeNull();
  });

  test("rejects a model draft that changes an explicit slash-prefixed folder", () => {
    expect(
      ruleSuggestionFidelityError(
        "save png into /dongs",
        "fileext/i: ^png$\ninto: Images/:filename:",
      ),
    ).toBe("The generated destination does not match /dongs");
    expect(
      ruleSuggestionFidelityError(
        "save jpg to the folder /Photos",
        "fileext: ^jpe?g$\ninto: Photos/",
      ),
    ).toBeNull();
    expect(ruleSuggestionFidelityError("save png into /dongs", "fileext: ^png$\ninto: dongs")).toBe(
      "The generated destination would rename the file instead of saving it in /dongs",
    );
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
    expect(isSingleRuleSuggestion("fileext: ^png$\ninto: Images")).toBe(true);
    expect(
      isSingleRuleSuggestion("fileext: ^png$\ninto: Images\n\nfileext: ^jpg$\ninto: Photos"),
    ).toBe(false);
  });
});

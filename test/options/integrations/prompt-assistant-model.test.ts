import {
  buildRuleAuthoringPrompt,
  buildRuleCritiquePrompt,
  cleanRuleSuggestion,
  isSingleRuleSuggestion,
  parseRuleCritique,
  parseRuleDraft,
  ruleRequestGuardrailIssues,
  sanitizeRuleDraft,
} from "../../../src/options/integrations/prompt-assistant-model.ts";
import { transformers } from "../../../src/routing/variable.ts";
import { matcherFunctions } from "../../../src/routing/matchers.ts";

const vocabulary = { matchers: ["fileext", "pagedomain", "css"], variables: ["filename"] };

const grammar = {
  id: "routing" as const,
  option: "filenamePatterns" as const,
  ebnf: 'rule = matcher, "into:", destination ;',
  semantics: ["Blank lines separate rules.", "A rule ends with an into destination."],
  examples: ["fileext: ^png$\ninto: Images/:filename:"],
};

describe("Prompt API rule-authoring model", () => {
  test("builds a bounded grammar-grounded request for one rule", () => {
    // GET_KEYWORDS sends variables already delimited, as SPECIAL_DIRS spells them.
    const result = buildRuleAuthoringPrompt("Put PNG files in Images", grammar, {
      matchers: ["fileext", "pagedomain"],
      variables: [":filename:", ":pagedomain:"],
    });

    expect(result).toContain("Put PNG files in Images");
    expect(result).toContain(grammar.ebnf);
    expect(result).not.toContain(grammar.examples[0]);
    expect(result).toContain("fileext, pagedomain");
    expect(result).toContain(":filename:, :pagedomain:");
    expect(result).not.toContain("::");
    expect(result).toContain("Return JSON matching the supplied response schema");
    expect(result).toContain("Do not add file types, sites, folders, renames, or behavior");
    expect(result).toContain("categories, not filename extensions");
  });

  test("names the vocabulary the background actually sends", () => {
    // Built the way the GET_KEYWORDS handler builds it, so a change to
    // SPECIAL_DIRS or the registries cannot drift the reference the model reads
    // without failing here first.
    const wireVocabulary = {
      matchers: [...Object.keys(matcherFunctions), "css"],
      variables: Object.keys(transformers),
    };
    const result = buildRuleAuthoringPrompt("save png into /dongs", grammar, wireVocabulary);

    expect(result).not.toContain("::");
    expect(result).toContain(":filename:");
    expect(result).toContain("fileext");
  });

  test("states the requirements it will enforce, last, where the model reads them", () => {
    const vocabulary = { matchers: ["fileext", "sourcekind"], variables: [":filename:"] };
    const result = buildRuleAuthoringPrompt("save png into /dongs", grammar, vocabulary);

    expect(result).toContain("Match only these file types: png.");
    expect(result).toContain("Save into the dongs/ folder.");
    expect(result).toContain("dongs/:filename:");
    expect(result.indexOf("This request requires exactly:")).toBeGreaterThan(
      result.indexOf("User request"),
    );
  });

  // A request that asks for a rename must not also be told to keep the
  // original filename: the two requirements contradict each other.
  test("omits the keep-the-filename requirement when the request asks for a rename", () => {
    const vocabulary = { matchers: ["fileext"], variables: [":filename:", ":sha256:"] };
    const result = buildRuleAuthoringPrompt(
      "save png into /dongs and rename to :sha256:",
      grammar,
      vocabulary,
    );

    expect(result).toContain("Save into the dongs/ folder.");
    expect(result).not.toContain("Keep the original filename");
  });

  test("states a category requirement without inventing a file type", () => {
    const vocabulary = { matchers: ["fileext", "sourcekind"], variables: [":filename:"] };
    const result = buildRuleAuthoringPrompt(
      "save images from docs.example.com into /archive",
      grammar,
      vocabulary,
    );

    expect(result).toContain("sourcekind");
    expect(result).toContain("Match only the docs.example.com site.");
    expect(result).toContain("Save into the archive/ folder.");
    expect(result).not.toContain("Match only these file types");
  });

  test("adds no requirements it cannot prove from the request", () => {
    const vocabulary = { matchers: ["fileext"], variables: [":filename:"] };
    const result = buildRuleAuthoringPrompt("sort my downloads sensibly", grammar, vocabulary);

    expect(result).not.toContain("This request requires exactly:");
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

  test("drops explanatory prose the model adds around recognized clauses", () => {
    expect(
      sanitizeRuleDraft(
        "Here is your rule:\nfileext/i: ^(?:pdf|png)$\ninto: archive/:filename:\n\nrule, context, sourcekind, fileext, ...",
        vocabulary,
      ),
    ).toBe("fileext/i: ^(?:pdf|png)$\ninto: archive/:filename:");
  });

  test("retains comments, flags, and clause values containing separators", () => {
    expect(
      sanitizeRuleDraft(
        "// Save PDFs\ncss: div > a\nrename/i: ^(.*)$ -> cover.png\ninto: archive/:filename:",
        vocabulary,
      ),
    ).toBe("// Save PDFs\ncss: div > a\nrename/i: ^(.*)$ -> cover.png\ninto: archive/:filename:");
  });

  test("rejects unknown clause-looking text instead of silently dropping it", () => {
    // Dropping a misnamed matcher would leave a rule that matches every file.
    expect(sanitizeRuleDraft("extension: ^png$\ninto: archive/:filename:", vocabulary)).toBeNull();
    expect(sanitizeRuleDraft("Note: this saves PNG files\nfileext: ^png$", vocabulary)).toBeNull();
  });

  test("rejects a draft that keeps no clause at all", () => {
    expect(sanitizeRuleDraft("I cannot create that rule.", vocabulary)).toBeNull();
    expect(sanitizeRuleDraft("   \n\n  ", vocabulary)).toBeNull();
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
    expect(parseRuleDraft("[]")).toBeNull();
    expect(parseRuleCritique(JSON.stringify({ accepted: true, issues: [] }))).toBeNull();
    expect(
      parseRuleCritique(JSON.stringify({ accepted: false, issues: [], repairedRule: "  " })),
    ).toBeNull();
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
    // Naming the site in a rename template does not match on it, so a rule that
    // only spells it there still routes every site's PNGs into the folder.
    [
      "save png from example.com into /archive",
      "fileext: ^png$\nrename/i: ^(.*)$ -> example.com-:filename:\ninto: archive/:filename:",
      ["The matchers do not contain the requested example.com site."],
    ],
    // A site clause after the file type must not cost the request its file-type
    // anchor, and must not be read as a type itself.
    [
      "save PDF from docs.example.com into /archive",
      "fileext/i: ^(?:pdf|png|jpg)$\npagedomain: ^docs\\.example\\.com$\ninto: archive/:filename:",
      ["The fileext matcher also matches unrequested file types (jpg, png)."],
    ],
    [
      "save PDF from docs.example.com into /archive",
      "fileext/i: ^pdf$\npagedomain: ^docs\\.example\\.com$\ninto: archive/:filename:",
      [],
    ],
    [
      "save png on example.com into /archive",
      "fileext/i: ^png$\npagedomain: ^example\\.com$\ninto: archive/:filename:",
      [],
    ],
    [
      "save .png from https://docs.example.com into /archive",
      "fileext: ^png$\npagedomain: ^docs\\.example\\.com$\ninto: archive/:filename:",
      [],
    ],
    ["save pngs into /archive", "fileext: ^png$\ninto: archive/:filename:", []],
    ["save foobar into /archive", "fileext: ^foobar$\ninto: archive/:filename:", []],
    ["save images into /Pictures", "sourcekind: ^image$\ninto: Pictures/:filename:", []],
    // A category names what a source is, so inventing an extension list for it
    // both adds unrequested types and silently misses others (webp, avif).
    [
      "save images into /Pictures",
      "fileext/i: ^(?:png|jpe?g|gif)$\ninto: Pictures/:filename:",
      ["The request names images as a media category, not a file type."],
    ],
    // An explicit type alongside the category still anchors a fileext matcher.
    ["save PNG images into /Pictures", "fileext/i: ^png$\ninto: Pictures/:filename:", []],
    ["save photos into /Pictures please", "sourcekind: ^image$\ninto: Pictures/:filename:", []],
    ["save png into / please", "fileext: ^png$\ninto: elsewhere/:filename:", []],
    ['save png into "/"', "fileext: ^png$\ninto: elsewhere/:filename:", []],
    ["save a b c d e f into /archive", "filename: .*\ninto: archive/:filename:", []],
    ['save png into "archive"', "fileext: ^png$\ninto: archive/:filename:", []],
    // A slash folder ends at the path token. Words after it describe the rest
    // of the request, and are not part of the folder name.
    [
      "save PNG into /Pictures and rename it cover.png",
      "fileext/i: ^png$\ninto: Pictures/cover.png",
      [],
    ],
    [
      "save PNG into /Pictures and rename it cover.png",
      "fileext/i: ^png$\ninto: Downloads/cover.png",
      ["The destination must use the requested Pictures/ folder."],
    ],
    // A folder name may still contain spaces when no conjunction follows it.
    ["save png into /My Documents", "fileext: ^png$\ninto: My Documents/:filename:", []],
    [
      "save PDF and PNG files into /archive",
      "fileext/i: ^(?:pdf|png)$\ninto: archive/:filename:",
      [],
    ],
    // jpg and jpeg spell one format, so covering both is not a broadening.
    ["save jpg into /photos", "fileext/i: ^jpe?g$\ninto: photos/:filename:", []],
    ["save jpeg into /photos", "fileext/i: ^jpe?g$\ninto: photos/:filename:", []],
    [
      "save images from docs.example.com into /archive",
      "sourcekind: ^image$\npagedomain: ^docs\\.example\\.com$\ninto: archive/:filename:",
      [],
    ],
    [
      "save png into /archive",
      "fileext: ^png$\ninto: archive/custom-name",
      ["Saving into a folder must preserve the original filename."],
    ],
    [
      "save png into /archive",
      "fileext: ^png$",
      ["The destination must use the requested archive/ folder."],
    ],
  ] as const)("checks explicit request anchors for %s", (request, rule, expected) => {
    const issues = ruleRequestGuardrailIssues(request, rule);
    expect(issues).toEqual(expected);
  });

  test.each(["\r", "\u2028", "\u2029"])(
    "checks request anchors across %j rule line boundaries",
    (terminator) => {
      expect(
        ruleRequestGuardrailIssues(
          "save PNG into /Pictures",
          `fileext/i: ^png$${terminator}into: Pictures/:filename:`,
        ),
      ).toEqual([]);
    },
  );
});

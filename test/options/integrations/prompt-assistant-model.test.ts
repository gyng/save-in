import {
  RULE_PLAN_RESPONSE_CONSTRAINT,
  assembleRule,
  buildRuleCritiquePrompt,
  buildRulePlanPrompt,
  describesSameRule,
  isSingleRuleSuggestion,
  parseRuleCritique,
  parseRulePlan,
  ruleRequestGuardrailIssues,
  rulePlanConstraint,
  type RulePlan,
} from "../../../src/options/integrations/prompt-assistant-model.ts";
import { parseRulesCollecting } from "../../../src/routing/rule-parser.ts";
import { PAGE_SOURCE_KINDS } from "../../../src/shared/page-source.ts";
import { transformers } from "../../../src/routing/variable.ts";
import { matcherFunctions } from "../../../src/routing/matchers.ts";

const grammar = {
  id: "routing" as const,
  option: "filenamePatterns" as const,
  ebnf: 'rule = matcher, "into:", destination ;',
  semantics: ["Blank lines separate rules.", "A rule ends with an into destination."],
  examples: ["fileext: ^png$\ninto: Images/:filename:"],
};

describe("Prompt API rule-plan model", () => {
  test("asks for the facts of the request instead of for rule syntax", () => {
    const result = buildRulePlanPrompt("Put PNG files in Images");

    expect(result).toContain("Put PNG files in Images");
    expect(result).toContain("You are not writing rule syntax");
    expect(result).toContain("Return JSON matching the supplied response schema");
    // The grammar is what the model cannot spell. Showing it to the author step
    // would only invite it back into a field that is no longer rule text.
    expect(result).not.toContain(grammar.ebnf);
    expect(result).not.toContain("into:");
    expect(result).toContain("sourceKind");
    expect(result).toContain("never expand a category into fileExtensions");
  });

  test("states the requirements it will enforce, last, where the model reads them", () => {
    const result = buildRulePlanPrompt("save png into /dongs");

    expect(result).toContain("fileExtensions must be exactly: png.");
    expect(result).toContain("folder must be dongs.");
    expect(result).toContain("Leave filename out");
    expect(result.indexOf("This request requires exactly:")).toBeGreaterThan(
      result.indexOf("User request"),
    );
  });

  // A request that asks for a rename must not also be told to leave the
  // filename out: the two requirements contradict each other.
  test("omits the keep-the-filename requirement when the request asks for a rename", () => {
    const result = buildRulePlanPrompt("save png into /dongs and rename to :sha256:");

    expect(result).toContain("folder must be dongs.");
    expect(result).not.toContain("Leave filename out");
  });

  test("still requires the filename when the request asks to keep it", () => {
    expect(buildRulePlanPrompt("save png into /dongs and keep the original filename")).toContain(
      "Leave filename out",
    );
  });

  test("states a category requirement without inventing a file type", () => {
    const result = buildRulePlanPrompt("save images from docs.example.com into /archive");

    expect(result).toContain("is a category, not a file type");
    expect(result).toContain("site must be docs.example.com.");
    expect(result).toContain("folder must be archive.");
    expect(result).not.toContain("fileExtensions must be exactly");
  });

  test("adds no requirements it cannot prove from the request", () => {
    expect(buildRulePlanPrompt("sort my downloads sensibly")).not.toContain(
      "This request requires exactly:",
    );
  });

  test("narrows a constrained plan response at the runtime boundary", () => {
    expect(
      parseRulePlan(
        JSON.stringify({ folder: "archive", fileExtensions: ["png", 7], sourceKind: "image" }),
      ),
    ).toEqual({ folder: "archive", fileExtensions: ["png"], sourceKind: "image" });
    // folder is the one field every plan needs; the rest are absent, not
    // undefined, when the model leaves them out.
    expect(parseRulePlan(JSON.stringify({ folder: "archive" }))).toEqual({ folder: "archive" });
    // A rename the request asked for survives the boundary as a plan field.
    expect(parseRulePlan(JSON.stringify({ folder: "archive", filename: "cover.png" }))).toEqual({
      folder: "archive",
      filename: "cover.png",
    });
    expect(parseRulePlan(JSON.stringify({ fileExtensions: ["png"] }))).toBeNull();
    expect(parseRulePlan(JSON.stringify({ folder: 7 }))).toBeNull();
    expect(parseRulePlan("not JSON")).toBeNull();
    expect(parseRulePlan("[]")).toBeNull();
  });

  // The schema caps pathVariables, but the plan is parsed from raw model output
  // that the constraint may not have shaped, so the cap is re-applied here.
  test("keeps only string path variables, in order, up to the plan's cap", () => {
    expect(
      parseRulePlan(
        JSON.stringify({
          folder: "archive",
          pathVariables: [":pagedomain:", 7, ":year:", ":month:", ":day:"],
        }),
      ),
    ).toEqual({ folder: "archive", pathVariables: [":pagedomain:", ":year:", ":month:"] });
    // An empty or non-array value is the model saying "none", not a plan field.
    expect(parseRulePlan(JSON.stringify({ folder: "archive", pathVariables: [] }))).toEqual({
      folder: "archive",
    });
    expect(
      parseRulePlan(JSON.stringify({ folder: "archive", pathVariables: ":pagedomain:" })),
    ).toEqual({ folder: "archive" });
  });
});

const assembled = (plan: RulePlan): string => {
  const rule = assembleRule(plan);
  if (rule === null) throw new Error(`assembleRule returned null for ${JSON.stringify(plan)}`);
  return rule;
};

describe("deterministic rule assembly", () => {
  test("anchors a file-type plan so a neighbouring extension cannot match", () => {
    // Unanchored "png" also takes apng, which is the broadening the model kept
    // producing when it wrote the matcher itself.
    expect(assembled({ folder: "archive", fileExtensions: ["png", "pdf"] })).toBe(
      "fileext/i: ^(?:png|pdf)$\ninto: archive/:filename:",
    );
    expect(
      ruleRequestGuardrailIssues(
        "save png into /archive",
        assembled({
          folder: "archive",
          fileExtensions: ["png"],
        }),
      ),
    ).toEqual([]);
  });

  test("normalizes the spellings of an extension the model may return", () => {
    expect(assembled({ folder: "a", fileExtensions: [".PNG", "png", " jpg "] })).toBe(
      "fileext/i: ^(?:png|jpg)$\ninto: a/:filename:",
    );
    // One type needs no alternation group around it.
    expect(assembled({ folder: "a", fileExtensions: ["PNG", "png"] })).toBe(
      "fileext/i: ^png$\ninto: a/:filename:",
    );
  });

  test("escapes regex metacharacters in an extracted value", () => {
    // A value from the model is untrusted input, not a pattern.
    expect(assembled({ folder: "a", fileExtensions: ["c++"] })).toBe(
      "fileext/i: ^c\\+\\+$\ninto: a/:filename:",
    );
    expect(assembled({ folder: "a", site: "docs.example.com" })).toContain(
      "(?:^|\\.)docs\\.example\\.com$",
    );
  });

  test("matches a category with sourcekind for every kind the collector reports", () => {
    for (const kind of PAGE_SOURCE_KINDS) {
      expect(assembled({ folder: "a", sourceKind: kind })).toBe(
        `sourcekind: ^${kind}$\ninto: a/:filename:`,
      );
    }
  });

  // A model that answers with the origin it was shown, rather than a bare
  // hostname, still names one site exactly — the scheme and trailing slash
  // narrow nothing a domain matcher would have to drop.
  test("accepts a site given as a bare origin and matches on its hostname", () => {
    expect(assembled({ folder: "a", site: "https://docs.example.com/" })).toContain(
      "(?:^|\\.)docs\\.example\\.com$",
    );
    expect(assembled({ folder: "a", site: "https://docs.example.com" })).toContain(
      "(?:^|\\.)docs\\.example\\.com$",
    );
  });

  // Whether the model answers with the site as typed or as the origin it was
  // shown is incidental, so the two must not disagree. pagedomain matches on
  // URL.hostname, which is punycode, so that is the form the rule has to carry
  // for the site the request actually named.
  test("accepts an internationalized site in either form and matches its punycode host", () => {
    expect(assembled({ folder: "a", site: "münchen.de" })).toContain(
      "(?:^|\\.)xn--mnchen-3ya\\.de$",
    );
    expect(assembled({ folder: "a", site: "https://münchen.de" })).toContain(
      "(?:^|\\.)xn--mnchen-3ya\\.de$",
    );
  });

  test("reads a named site as the page being browsed unless the request says otherwise", () => {
    // pageUrl is present for every save, and "from example.com" almost always
    // names the site the user is on rather than the host serving the bytes.
    expect(assembled({ folder: "a", site: "example.com" })).toContain("pagedomain: ");
    expect(assembled({ folder: "a", site: "example.com", siteScope: "page" })).toContain(
      "pagedomain: ",
    );
    expect(assembled({ folder: "a", site: "cdn.example.com", siteScope: "source" })).toContain(
      "sourcedomain: ",
    );
  });

  test("accepts a subdomain of the named site but not a lookalike host", () => {
    const rule = assembled({ folder: "a", site: "example.com" });
    const expression = new RegExp(rule.split("pagedomain: ")[1]?.split("\n")[0] ?? "");

    expect(expression.test("example.com")).toBe(true);
    expect(expression.test("docs.example.com")).toBe(true);
    expect(expression.test("notexample.com")).toBe(false);
    expect(expression.test("example.com.attacker.test")).toBe(false);
  });

  test("keeps the original filename unless the plan renames the file", () => {
    expect(assembled({ folder: "archive", fileExtensions: ["png"] })).toContain(
      "into: archive/:filename:",
    );
    expect(
      assembled({ folder: "Pictures", fileExtensions: ["png"], filename: "cover.png" }),
    ).toContain("into: Pictures/cover.png");
  });

  test("roots a folder inside the extension's directory however the model spells it", () => {
    // A leading slash is the request's shorthand for an extension-relative
    // folder; passed through, the destination is rejected as non-relative.
    for (const folder of ["/archive", "archive/", " /archive/ ", "//archive//"]) {
      expect(assembled({ folder, fileExtensions: ["png"] })).toContain("into: archive/:filename:");
    }
    expect(assembled({ folder: "/a/b/c", fileExtensions: ["png"] })).toContain(
      "into: a/b/c/:filename:",
    );
    expect(assembled({ folder: "My Documents", fileExtensions: ["png"] })).toContain(
      "into: My Documents/:filename:",
    );
  });

  test.each<[RulePlan, string]>([
    // Nothing to match on: the rule would route every download.
    [{ folder: "archive" }, "no matcher"],
    [{ folder: "archive", fileExtensions: [] }, "no matcher"],
    // A dot inside an extension names something fileext never reads.
    [{ folder: "a", fileExtensions: ["tar.gz"] }, "multi-part extension"],
    [{ folder: "a", fileExtensions: ["not an extension"] }, "prose extension"],
    [{ folder: "a", fileExtensions: [".*"] }, "regex smuggled as an extension"],
    [{ folder: "a", sourceKind: "photo" }, "kind the matcher never reports"],
    [{ folder: "a", site: "not a host" }, "prose site"],
    // A domain matcher cannot express a path, and dropping the path would
    // route more than the request asked for.
    [{ folder: "a", site: "example.com/docs" }, "site carrying a path"],
    [{ folder: "a", site: "https://example.com:8443" }, "site carrying a port"],
    // The plan is model output, so a site that looks like a URL but cannot be
    // parsed as one must fail closed rather than throw out of the assembler.
    [{ folder: "a", site: "https://[" }, "site that is not a parseable URL"],
    [{ folder: "", fileExtensions: ["png"] }, "empty folder"],
    [{ folder: "/", fileExtensions: ["png"] }, "root-only folder"],
    [{ folder: "../secrets", fileExtensions: ["png"] }, "folder escaping upwards"],
    // ":" opens a variable and "/" a path segment: a literal carrying either
    // would silently mean something other than its own text.
    [{ folder: "a:pagetitle:", fileExtensions: ["png"] }, "folder smuggling a variable"],
    [{ folder: "a", fileExtensions: ["png"], filename: ":filename:.bak" }, "filename variable"],
    [{ folder: "a", fileExtensions: ["png"], filename: "b/c.png" }, "filename with a path"],
    [{ folder: "a", fileExtensions: ["png"], filename: "" }, "empty rename"],
    // A relative segment names a folder, not a file, so it cannot be the rename.
    [{ folder: "a", fileExtensions: ["png"], filename: "." }, "filename that is a dot segment"],
    [{ folder: "a", fileExtensions: ["png"], filename: ".." }, "filename that escapes upwards"],
    [{ folder: "a", site: "   " }, "site that is only whitespace"],
    // A host with no dot is a machine name, not the site a request can name.
    [{ folder: "a", site: "https://localhost/" }, "origin whose host is not a domain"],
    // Nesting an unknown token would name a folder the request never asked for.
    [
      { folder: "a", fileExtensions: ["png"], pathVariables: [":nonsense:"] },
      "path variable outside the offered set",
    ],
  ])("refuses to assemble a plan it cannot express exactly (%#: %s)", (plan) => {
    expect(assembleRule(plan)).toBeNull();
  });

  // The schema caps and orders pathVariables, but the plan is model output: a
  // repeated dimension would nest the same folder twice.
  test("nests each path variable once, in the order the plan gives them", () => {
    expect(
      assembled({
        folder: "a",
        fileExtensions: ["png"],
        pathVariables: [":year:", ":pagedomain:", ":year:"],
      }),
    ).toBe("fileext/i: ^png$\ninto: a/:year:/:pagedomain:/:filename:");
  });

  // The whole point of the plan: the assembler's output is valid because of how
  // it is built, not because a model typed it correctly. Checked against the
  // real routing parser, which is what the background VALIDATE gate runs.
  test.each<RulePlan>([
    { folder: "archive", fileExtensions: ["pdf", "png"], site: "docs.example.com" },
    { folder: "Pictures", sourceKind: "image" },
    { folder: "dongs", fileExtensions: ["png"], filename: "cover.png" },
    { folder: "a/b", sourceKind: "video", site: "cdn.example.com", siteScope: "source" },
    { folder: "My Documents", fileExtensions: ["c++"] },
  ])("assembles rule text the routing parser accepts (%#)", (plan) => {
    const rule = assembled(plan);
    const { rules, errors } = parseRulesCollecting(rule);

    expect(errors.filter((error) => !error.warning)).toEqual([]);
    expect(rules).toHaveLength(1);
    expect(isSingleRuleSuggestion(rule)).toBe(true);
  });

  // The four acceptance requests, planned as the model reads them. Every rule
  // the plan produces has to survive the deterministic gate the panel applies
  // before Add is enabled.
  test.each<[string, RulePlan]>([
    [
      "from docs.example.com, save PDF and PNG files into /archive",
      { folder: "archive", fileExtensions: ["pdf", "png"], site: "docs.example.com" },
    ],
    ["save images into /Pictures", { folder: "Pictures", sourceKind: "image" }],
    ["save png into /dongs", { folder: "dongs", fileExtensions: ["png"] }],
    [
      "save PNG into /Pictures and rename it cover.png",
      { folder: "Pictures", fileExtensions: ["png"], filename: "cover.png" },
    ],
  ])("passes the request guardrails for %s", (request, plan) => {
    expect(ruleRequestGuardrailIssues(request, assembled(plan))).toEqual([]);
  });
});

describe("Prompt API rule review", () => {
  test("names the vocabulary the background actually sends", () => {
    // Built the way the GET_KEYWORDS handler builds it, so a change to
    // SPECIAL_DIRS or the registries cannot drift the reference the reviewer
    // reads without failing here first.
    const wireVocabulary = {
      matchers: [...Object.keys(matcherFunctions), "css"],
      variables: Object.keys(transformers),
    };
    const result = buildRuleCritiquePrompt(
      "save png into /dongs",
      "fileext: ^png$",
      [],
      grammar,
      wireVocabulary,
    );

    expect(result).not.toContain("::");
    expect(result).toContain(":filename:");
    expect(result).toContain("fileext");
  });

  test("reads a reviewer's agreement through its typing", () => {
    const candidate = "fileext/i: ^png$\ninto: dongs/:filename:";

    // Indentation, a trailing newline, and a stray blank line are how a small
    // model retypes a rule it agrees with.
    expect(describesSameRule(candidate, "  fileext/i: ^png$\n\n  into: dongs/:filename:  \n")).toBe(
      true,
    );
    // A different rule stays a different rule, and a regex is case sensitive.
    expect(describesSameRule(candidate, "fileext/i: ^jpg$\ninto: dongs/:filename:")).toBe(false);
    expect(describesSameRule(candidate, "fileext/i: ^PNG$\ninto: dongs/:filename:")).toBe(false);
    expect(describesSameRule(candidate, "fileext/i: ^png$\ninto: Downloads/:filename:")).toBe(
      false,
    );
  });

  test("distinguishes one semantic rule from a multi-rule response", () => {
    expect(isSingleRuleSuggestion("fileext: ^png$\ninto: Images/")).toBe(true);
    expect(
      isSingleRuleSuggestion("fileext: ^png$\ninto: Images/\n\nfileext: ^jpg$\ninto: Photos/"),
    ).toBe(false);
  });

  test("carries a reviewer's repair as a plan, not as rule text", () => {
    // A reviewer that can only correct the facts cannot reintroduce the syntax
    // mistakes the plan step removed.
    expect(
      parseRuleCritique(
        JSON.stringify({
          accepted: false,
          issues: ["Wrong folder"],
          repairedPlan: { folder: "dongs", fileExtensions: ["png"] },
        }),
      ),
    ).toEqual({
      accepted: false,
      issues: ["Wrong folder"],
      repairedPlan: { folder: "dongs", fileExtensions: ["png"] },
    });
    expect(parseRuleCritique(JSON.stringify({ accepted: true, issues: [] }))).toBeNull();
    expect(
      parseRuleCritique(
        JSON.stringify({ accepted: false, issues: [], repairedPlan: "fileext: ^png$" }),
      ),
    ).toBeNull();
    expect(
      parseRuleCritique(JSON.stringify({ accepted: true, issues: [], repairedPlan: {} })),
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
    // The reviewer judges the rule that will actually run, so it still needs
    // the grammar the assembler wrote it in.
    expect(result).toContain(grammar.ebnf);
    expect(result).toContain("repairedPlan is not rule syntax");
  });
});

// The deterministic gate, which reads the assembled rule text and does not care
// which step produced it.
describe("rule request guardrails", () => {
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
    // link and stream are page-source kinds like image and video, so a rule
    // reading one as a file extension matches nothing, forever.
    [
      "save links into /Links",
      "fileext/i: ^links$\ninto: Links/:filename:",
      ["The request names links as a media category, not a file type."],
    ],
    [
      "save streams into /Live",
      "fileext/i: ^streams$\ninto: Live/:filename:",
      ["The request names streams as a media category, not a file type."],
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
    // Asking to keep the filename is the opposite of asking to rename, even
    // though both name the filename.
    [
      "save png into /archive and keep the filename",
      "fileext: ^png$\ninto: archive/custom-name",
      ["Saving into a folder must preserve the original filename."],
    ],
    // A request that does name a new filename still renames.
    ["save png into /archive, name it cover.png", "fileext: ^png$\ninto: archive/cover.png", []],
    // "with" opens a clause about the file, not more folder name.
    [
      "save png into /archive with filename cover.png",
      "fileext: ^png$\ninto: archive/cover.png",
      [],
    ],
    [
      "save png into /archive with the same filename",
      "fileext: ^png$\ninto: archive/:filename:",
      [],
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

describe("plan fields the model must fill in", () => {
  test("requires every field so the model cannot answer with the folder alone", () => {
    // Constrained decoding lets the model stop once the required fields are
    // emitted. Asked for "save png into /dongs" with only folder required, an
    // on-device model answered {"folder":"dongs","filename":""} and dropped the
    // file type — leaving a plan with no matcher, which assembleRule refuses.
    const required = (RULE_PLAN_RESPONSE_CONSTRAINT as { required: string[] }).required;

    expect(required).toContain("fileExtensions");
    expect(required).toContain("sourceKind");
    expect(required).toContain("site");
    expect(required).toContain("folder");
  });

  test("reads an empty answer to a required field as the request not naming it", () => {
    expect(
      parseRulePlan(
        JSON.stringify({
          folder: "dongs",
          fileExtensions: ["png"],
          sourceKind: "",
          site: "",
          siteScope: "page",
          filename: "",
        }),
      ),
    ).toEqual({ folder: "dongs", fileExtensions: ["png"], siteScope: "page" });
  });
});

describe("matchers the request never asked for", () => {
  test("rejects a category matcher the request does not name", () => {
    // Measured against the on-device model: asked for "save PDF and PNG files
    // into /archive" it produced fileext ^(?:pdf|png)$ AND sourcekind ^document$
    // — a rule that can never route a PNG, because a PNG is not a document
    // source. Add was enabled. A matcher the request never named narrows the
    // rule to something the user did not ask for and cannot see.
    expect(
      ruleRequestGuardrailIssues(
        "save PDF and PNG files into /archive",
        "fileext/i: ^(?:pdf|png)$\nsourcekind: ^document$\ninto: archive/:filename:",
      ),
    ).toContain("The rule matches a source category the request does not name.");
  });

  test("keeps the category matcher a request does name", () => {
    expect(
      ruleRequestGuardrailIssues(
        "save images from docs.example.com into /archive",
        "sourcekind: ^image$\npagedomain: (?:^|\\.)docs\\.example\\.com$\ninto: archive/:filename:",
      ),
    ).toEqual([]);
  });
});

describe("the schema offered for one request", () => {
  test("withholds the category field from a request that names a file type", () => {
    // Measured: asked for "png" the model answers sourceKind "image" and leaves
    // fileExtensions empty — 0/5 for every file-type request. It cannot use a
    // field it is not offered.
    const constraint = rulePlanConstraint("save png into /dongs");

    expect(Object.keys(constraint.properties as object)).not.toContain("sourceKind");
    expect(constraint.required).not.toContain("sourceKind");
    expect(Object.keys(constraint.properties as object)).toContain("fileExtensions");
  });

  test("offers the category field to a request that names no file type", () => {
    const constraint = rulePlanConstraint("save images from docs.example.com into /archive");

    expect(Object.keys(constraint.properties as object)).toContain("sourceKind");
    expect(constraint.required).toContain("sourceKind");
  });

  // A request that justifies every field is the one case with nothing to
  // withhold, so the whole schema is offered rather than a rebuilt subset.
  test("offers the whole schema to a request that justifies every field", () => {
    const constraint = rulePlanConstraint("save images served from the cdn, organized by date");

    expect(constraint).toBe(RULE_PLAN_RESPONSE_CONSTRAINT);
    for (const field of ["sourceKind", "siteScope", "pathVariables"]) {
      expect(Object.keys(constraint.properties as object)).toContain(field);
    }
  });
});

describe("the site scope a request can justify", () => {
  test("withholds the scope field from a request that names only a site", () => {
    // Measured: for "save images from docs.example.com" the model answered
    // siteScope "source" on some runs and "page" on others, and both were
    // accepted — materially different rules. "from example.com" names the page
    // being browsed; pageUrl is present for every save and sourceUrl is not, so
    // page is both the likelier reading and the one that fails safe. The model
    // is not offered the choice unless the request states it.
    const constraint = rulePlanConstraint("save images from docs.example.com into /archive");

    expect(Object.keys(constraint.properties as object)).not.toContain("siteScope");
    expect(constraint.required).not.toContain("siteScope");
    expect(Object.keys(constraint.properties as object)).toContain("site");
  });

  test("offers the scope field to a request that names where the file is hosted", () => {
    const constraint = rulePlanConstraint("save images hosted on cdn.example.com into /archive");

    expect(Object.keys(constraint.properties as object)).toContain("siteScope");
  });

  test("reads a site as the page being browsed when no scope was asked for", () => {
    expect(assembled({ folder: "a", site: "example.com" })).toContain("pagedomain: ");
  });
});

describe("grouping a destination by variables", () => {
  test("names only variables the routing language actually has", () => {
    // The enum is what stops the model inventing :website:. It is worth nothing
    // if an entry is not a real transformer, so prove each against the registry.
    const constraint = rulePlanConstraint("save png into /Images sorted by site and date");
    const offered = (constraint.properties as { pathVariables: { items: { enum: string[] } } })
      .pathVariables.items.enum;

    expect(offered.length).toBeGreaterThan(0);
    for (const variable of offered) expect(Object.keys(transformers)).toContain(variable);
    expect(offered).not.toContain(":filename:");
  });

  test("groups the destination between the folder and the file", () => {
    expect(
      assembled({
        folder: "Images",
        fileExtensions: ["png"],
        pathVariables: [":pagedomain:", ":date:"],
      }),
    ).toBe("fileext/i: ^png$\ninto: Images/:pagedomain:/:date:/:filename:");
  });

  test("keeps a rename under the grouping it was asked for", () => {
    expect(
      assembled({
        folder: "a",
        fileExtensions: ["png"],
        pathVariables: [":year:"],
        filename: "c.png",
      }),
    ).toContain("into: a/:year:/c.png");
  });

  test("refuses a variable the routing language does not have", () => {
    // Narrowing it to a literal would name a folder nobody asked for.
    expect(
      assembleRule({ folder: "a", fileExtensions: ["png"], pathVariables: [":website:"] }),
    ).toBeNull();
    expect(
      assembleRule({ folder: "a", fileExtensions: ["png"], pathVariables: [":pageurl:"] }),
    ).toBeNull();
  });

  test("offers grouping only to a request that asks for it", () => {
    expect(
      Object.keys(rulePlanConstraint("save png into /Images sorted by site").properties as object),
    ).toContain("pathVariables");
    expect(
      Object.keys(rulePlanConstraint("save png into /Images by date").properties as object),
    ).toContain("pathVariables");
    // Nesting is behaviour; a request that did not ask for it must not get it.
    expect(
      Object.keys(rulePlanConstraint("save png into /dongs").properties as object),
    ).not.toContain("pathVariables");
  });
});

describe("a folder that is really the rest of the sentence", () => {
  test("ends the folder where the request starts asking for grouping", () => {
    // Measured: "save png into /Images sorted by site and date" extracted the
    // folder as "Images sorted by site", told the model that was the
    // requirement, and then checked the draft against the same wrong fact — so
    // both sides agreed and Add lit up on a rule saving into a sentence.
    expect(
      ruleRequestGuardrailIssues(
        "save png into /Images sorted by site and date",
        "fileext/i: ^png$\ninto: Images/:pagedomain:/:date:/:filename:",
      ),
    ).toEqual([]);
    expect(buildRulePlanPrompt("save png into /Images sorted by site and date")).toContain(
      "folder must be Images.",
    );
  });

  test.each([
    ["save png into /Images sorted by site and date", "Images"],
    ["save png into /archive grouped by date", "archive"],
    ["save png into /Media organised by type", "Media"],
    ["save png into /files by domain", "files"],
    ["save png into /My Documents", "My Documents"],
  ])("reads the folder of %j as %j", (request, folder) => {
    expect(buildRulePlanPrompt(request)).toContain(`folder must be ${folder}.`);
  });
});

describe("grouping a request asked for", () => {
  test("rejects a destination that drops the grouping the request asked for", () => {
    // Measured: "sorted by site and date" was answered with into: Images/
    // :filename: — no grouping at all — and Add lit up. A rule that silently
    // does neither of the two things the request named is not a draft of it.
    expect(
      ruleRequestGuardrailIssues(
        "save png into /Images sorted by site and date",
        "fileext/i: ^png$\ninto: Images/:filename:",
      ),
    ).toContain("The destination does not group saves the way the request asks.");
    expect(
      ruleRequestGuardrailIssues(
        "save png into /Images sorted by site and date",
        "fileext/i: ^png$\ninto: Images/:pagedomain:/:date:/:filename:",
      ),
    ).toEqual([]);
  });

  test("asks nothing of a request that never mentioned grouping", () => {
    expect(
      ruleRequestGuardrailIssues(
        "save png into /dongs",
        "fileext/i: ^png$\ninto: dongs/:filename:",
      ),
    ).toEqual([]);
  });

  test("offers only the variables the request's own words name", () => {
    const constraint = rulePlanConstraint("save png into /Images sorted by site and date");
    const offered = (constraint.properties as { pathVariables: { items: { enum: string[] } } })
      .pathVariables.items.enum;

    expect(offered).toContain(":pagedomain:");
    expect(offered).toContain(":date:");
    // Nothing the request never named: it asked for site and date, not the type.
    expect(offered).not.toContain(":fileext:");
    expect(offered).not.toContain(":pagetitleslug:");
  });
});

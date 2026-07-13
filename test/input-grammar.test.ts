import {
  parsePathLineSyntax,
  parsePathMetadata,
  serializePathLine,
  validatePathLineSyntax,
} from "../src/config/path-syntax.ts";
import {
  parseRoutingRuleSyntax,
  tokenizeRuleLines,
  validateRoutingRuleSyntax,
} from "../src/routing/rule-syntax.ts";

describe("directory-line grammar", () => {
  test.each([
    ["images", { depth: 0, body: "images", comment: "" }],
    ["> images/cats", { depth: 1, body: "images/cats", comment: "" }],
    [
      ">> work // notes (alias: Work (shared))",
      { depth: 2, body: "work", comment: "notes (alias: Work (shared))" },
    ],
  ])("parses and serializes %s", (source, row) => {
    const parsed = parsePathLineSyntax(source);

    expect(parsed).toEqual({ row, issues: [] });
    expect(parsePathLineSyntax(serializePathLine(row))).toEqual({ row, issues: [] });
  });

  test.each(["", "   ", ">>>", "> // comment only"])(
    "reports a missing directory in %j",
    (source) => {
      expect(validatePathLineSyntax(source)).toEqual([
        expect.objectContaining({ code: "missing-path", source }),
      ]);
    },
  );

  test("parses balanced metadata values without treating prose as metadata", () => {
    expect(parsePathMetadata("photo (edited) (alias: Work (shared)) (key: w)")).toEqual({
      alias: "Work (shared)",
      key: "w",
    });
  });
});

describe("routing-rule grammar", () => {
  test("parses comments, blank-line rule boundaries, flags, and values", () => {
    const parsed = parseRoutingRuleSyntax(
      [
        "// image rule",
        "filename/i: \\.png$",
        "into: images/:filename:",
        "   ",
        "sourceurl: files/(report)",
        "capturegroups: sourceurl",
        "into: reports/:$1:",
      ].join("\n"),
    );

    expect(parsed.issues).toEqual([]);
    expect(parsed.rules).toEqual([
      [
        ["filename/i: \\.png$", "filename/i", "\\.png$"],
        ["into: images/:filename:", "into", "images/:filename:"],
      ],
      [
        ["sourceurl: files/(report)", "sourceurl", "files/(report)"],
        ["capturegroups: sourceurl", "capturegroups", "sourceurl"],
        ["into: reports/:$1:", "into", "reports/:$1:"],
      ],
    ]);
  });

  test("reports malformed clauses with their source locations", () => {
    const parsed = parseRoutingRuleSyntax("sourceurl: ok\nnot a clause\ninto: saved");

    expect(parsed.rules).toEqual([
      [
        ["sourceurl: ok", "sourceurl", "ok"],
        ["into: saved", "into", "saved"],
      ],
    ]);
    expect(parsed.issues).toEqual([
      { code: "bad-clause", line: 2, column: 0, source: "not a clause" },
    ]);
    expect(validateRoutingRuleSyntax("sourceurl: ok\nnot a clause\ninto: saved")).toEqual(
      parsed.issues,
    );
  });

  test("preserves legacy whole-document whitespace normalization", () => {
    expect(parseRoutingRuleSyntax("  filename: jpg\ninto: images  ")).toEqual({
      rules: [
        [
          ["filename: jpg", "filename", "jpg"],
          ["into: images", "into", "images"],
        ],
      ],
      issues: [],
    });
  });

  test("validates standalone rule blocks through the same tokenizer", () => {
    expect(tokenizeRuleLines("filename: jpg\ninto: images")).toEqual({
      tokens: [
        ["filename: jpg", "filename", "jpg"],
        ["into: images", "into", "images"],
      ],
      issues: [],
    });
    expect(tokenizeRuleLines("").issues).toEqual([
      { code: "bad-clause", line: 1, column: 0, source: "" },
    ]);
  });
});

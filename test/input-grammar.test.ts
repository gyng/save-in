import {
  parsePathLine,
  parsePathLineAst,
  parsePathMetadata,
  serializePathLine,
  validatePathLineSyntax,
} from "../src/config/path-syntax.ts";
import { parseRoutingRuleAst, validateRoutingRuleSyntax } from "../src/routing/rule-syntax.ts";

describe("directory-line grammar", () => {
  test("builds a spanned AST for paths, comments, and metadata", () => {
    const source = "  >> work // notes (alias: Work (shared))";
    const { ast, issues } = parsePathLineAst(source);

    expect(issues).toEqual([]);
    expect(ast).toEqual(
      expect.objectContaining({
        kind: "directory-line",
        depth: 2,
        path: expect.objectContaining({ kind: "path", value: "work" }),
        comment: expect.objectContaining({
          kind: "comment",
          value: "notes (alias: Work (shared))",
        }),
        metadata: [
          expect.objectContaining({ kind: "metadata", key: "alias", value: "Work (shared)" }),
        ],
      }),
    );
    expect(source.slice(ast.path.span.start.offset, ast.path.span.end.offset)).toBe("work");
    const metadata = ast.metadata[0]!;
    expect(source.slice(metadata.span.start.offset, metadata.span.end.offset)).toBe(
      "(alias: Work (shared))",
    );
  });

  test.each([
    ["images", { depth: 0, body: "images", comment: "" }],
    ["> images/cats", { depth: 1, body: "images/cats", comment: "" }],
    [
      ">> work // notes (alias: Work (shared))",
      { depth: 2, body: "work", comment: "notes (alias: Work (shared))" },
    ],
  ])("parses and serializes %s", (source, row) => {
    expect(parsePathLine(source)).toEqual(row);
    expect(parsePathLine(serializePathLine(row))).toEqual(row);
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
  test("builds a source-backed document AST with typed clauses and trivia", () => {
    const source = "// image rule\nfilename/i: \\.png$\ninto: images/:filename:\n\nnot a clause";
    const { ast, issues } = parseRoutingRuleAst(source);

    expect(ast.rules).toHaveLength(2);
    expect(ast.lines.map((line) => line.kind)).toEqual([
      "comment",
      "clause",
      "clause",
      "blank",
      "invalid",
    ]);
    const matcher = ast.rules[0]!.clauses[0]!;
    expect(matcher).toEqual(
      expect.objectContaining({
        clauseKind: "matcher",
        rawName: "filename/i",
        name: "filename",
        flags: "i",
        value: "\\.png$",
      }),
    );
    expect(source.slice(matcher.span.start.offset, matcher.span.end.offset)).toBe(
      "filename/i: \\.png$",
    );
    expect(issues).toEqual([{ code: "bad-clause", line: 5, column: 3, source: "not a clause" }]);
  });

  test("parses comments, blank-line rule boundaries, flags, and values", () => {
    const parsed = parseRoutingRuleAst(
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
    expect(
      parsed.ast.rules.map((rule) => rule.clauses.map((clause) => [clause.rawName, clause.value])),
    ).toEqual([
      [
        ["filename/i", "\\.png$"],
        ["into", "images/:filename:"],
      ],
      [
        ["sourceurl", "files/(report)"],
        ["capturegroups", "sourceurl"],
        ["into", "reports/:$1:"],
      ],
    ]);
  });

  test("reports malformed clauses with their source locations", () => {
    const parsed = parseRoutingRuleAst("sourceurl: ok\nnot a clause\ninto: saved");

    expect(parsed.ast.rules[0]!.clauses.map((clause) => [clause.name, clause.value])).toEqual([
      ["sourceurl", "ok"],
      ["into", "saved"],
    ]);
    expect(parsed.issues).toEqual([
      { code: "bad-clause", line: 2, column: 3, source: "not a clause" },
    ]);
    expect(validateRoutingRuleSyntax("sourceurl: ok\nnot a clause\ninto: saved")).toEqual(
      parsed.issues,
    );
  });

  test("preserves legacy whole-document whitespace normalization", () => {
    const parsed = parseRoutingRuleAst("  filename: jpg\ninto: images  ");
    expect(parsed.issues).toEqual([]);
    expect(parsed.ast.rules[0]!.clauses.map((clause) => clause.raw)).toEqual([
      "filename: jpg",
      "into: images",
    ]);
  });
});

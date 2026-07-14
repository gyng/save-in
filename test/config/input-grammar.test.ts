import {
  parsePathLineAst,
  serializeDirectoryLine,
  updateDirectoryLine,
  validatePathLineSyntax,
} from "../../src/config/path-syntax.ts";
import {
  parseRoutingRuleAst,
  serializeRoutingDocument,
  validateRoutingRuleSyntax,
} from "../../src/routing/rule-syntax.ts";

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
    expect(ast.cst).toEqual(
      expect.objectContaining({
        valid: true,
        leadingTrivia: expect.objectContaining({ raw: "  " }),
        nesting: expect.objectContaining({ raw: ">>" }),
        pathLeadingTrivia: expect.objectContaining({ raw: " " }),
        pathTrailingTrivia: expect.objectContaining({ raw: " " }),
        comment: expect.objectContaining({
          delimiter: expect.objectContaining({ raw: "//" }),
          leadingTrivia: expect.objectContaining({ raw: " " }),
          content: expect.objectContaining({ raw: "notes (alias: Work (shared))" }),
          trailingTrivia: expect.objectContaining({ raw: "" }),
        }),
      }),
    );
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
    const parsed = parsePathLineAst(source).ast;
    const project = (node: typeof parsed) => ({
      depth: node.depth,
      body: node.path.value,
      comment: node.comment?.value ?? "",
    });
    expect(project(parsed)).toEqual(row);
    expect(project(parsePathLineAst(serializeDirectoryLine(parsed)).ast)).toEqual(row);
  });

  test("rebuilds valid spans after immutable AST edits", () => {
    const source = "> images // notes (alias: Images)";
    const parsed = parsePathLineAst(source).ast;
    const updated = updateDirectoryLine(parsed, { depth: 2, path: "archive" });

    expect(serializeDirectoryLine(updated)).toBe(">> archive // notes (alias: Images)");
    expect(updated).not.toBe(parsed);
    expect(updated.raw.slice(updated.path.span.start.offset, updated.path.span.end.offset)).toBe(
      "archive",
    );
    const metadata = updated.metadata[0]!;
    expect(updated.raw.slice(metadata.span.start.offset, metadata.span.end.offset)).toBe(
      "(alias: Images)",
    );
  });

  test("keeps simultaneous insertions in semantic order on an empty line", () => {
    const updated = updateDirectoryLine(parsePathLineAst("").ast, {
      depth: 2,
      path: "archive",
      comment: "notes",
    });

    expect(serializeDirectoryLine(updated)).toBe(">>archive // notes");
    expect(updated).toMatchObject({
      depth: 2,
      path: { value: "archive" },
      comment: { value: "notes" },
    });
  });

  test("canonically repairs an invalid persisted line", () => {
    const invalid = parsePathLineAst("old\npath").ast;
    expect(invalid.cst.valid).toBe(false);

    expect(
      serializeDirectoryLine(
        updateDirectoryLine(invalid, { depth: 2, path: "archive", comment: "repaired" }),
      ),
    ).toBe(">>archive // repaired");
    expect(serializeDirectoryLine(updateDirectoryLine(invalid, {}))).toBe("");
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
    const parsed = parsePathLineAst("path // photo (edited) (alias: Work (shared)) (key: w)").ast;
    expect(Object.fromEntries(parsed.metadata.map((entry) => [entry.key, entry.value]))).toEqual({
      alias: "Work (shared)",
      key: "w",
    });
  });
});

describe("routing-rule grammar", () => {
  test("retains a lossless CST for clause and line trivia", () => {
    const source = "  filename/i:  \\.png$\r\n  // note  \ninto: images  ";
    const parsed = parseRoutingRuleAst(source).ast;
    const matcher = parsed.rules[0]!.clauses[0]!;
    const comment = parsed.lines.find((line) => line.kind === "comment")!;
    const destination = parsed.rules[0]!.clauses[1]!;

    expect(serializeRoutingDocument(parsed)).toBe(source);
    expect(matcher.cst).toEqual(
      expect.objectContaining({
        leadingTrivia: expect.objectContaining({ raw: "  " }),
        rawName: expect.objectContaining({ raw: "filename/i" }),
        flagsSeparator: expect.objectContaining({ raw: "/" }),
        colon: expect.objectContaining({ raw: ":" }),
        valueLeadingTrivia: expect.objectContaining({ raw: " " }),
        value: expect.objectContaining({ raw: " \\.png$" }),
        trailingTrivia: expect.objectContaining({ raw: "\r" }),
        terminator: expect.objectContaining({ raw: "\n" }),
      }),
    );
    expect(comment.cst).toEqual(
      expect.objectContaining({
        leadingTrivia: expect.objectContaining({ raw: "  " }),
        delimiter: expect.objectContaining({ raw: "//" }),
        content: expect.objectContaining({ raw: " note  " }),
        terminator: expect.objectContaining({ raw: "\n" }),
      }),
    );
    expect(destination.cst.trailingTrivia.raw).toBe("  ");
  });

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
    expect(issues).toEqual([
      expect.objectContaining({ code: "bad-clause", line: 5, column: 3, source: "not a clause" }),
    ]);
    expect(source.slice(issues[0]!.span.start.offset, issues[0]!.span.end.offset)).toBe(
      "not a clause",
    );
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
      expect.objectContaining({ code: "bad-clause", line: 2, column: 3, source: "not a clause" }),
    ]);
    expect(validateRoutingRuleSyntax("sourceurl: ok\nnot a clause\ninto: saved")).toEqual(
      parsed.issues,
    );

    expect(parseRoutingRuleAst("filename/[ : jpg").issues).toEqual([
      expect.objectContaining({ code: "bad-clause", column: 10 }),
    ]);
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

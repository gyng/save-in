import {
  addRoutingClause,
  addAutomaticRoutingRule,
  addRoutingRule,
  deleteRoutingClause,
  deleteRoutingRule,
  duplicateRoutingRule,
  moveRoutingRule,
  parseVisualRoutingRules,
  setRoutingRuleEnabled,
  updateRoutingClause,
} from "../src/options/rule-visual-editor-model.ts";

describe("routing visual editor model", () => {
  const source = [
    "// Images from the CDN",
    "  sourceurl/i: cdn\\.example\\.com  ",
    "into: images/:filename:",
    "",
    "fileext: pdf",
    "capturegroups: fileext",
    "into: documents/:filename:",
  ].join("\n");

  test("projects the lossless AST into editable rule cards", () => {
    const document = parseVisualRoutingRules(source);

    expect(document.rules).toHaveLength(2);
    expect(document.rules[0]).toMatchObject({
      index: 0,
      line: 2,
      editable: true,
      comment: "Images from the CDN",
      clauses: [
        { name: "sourceurl", flags: "i", value: "cdn\\.example\\.com", line: 2 },
        { name: "into", flags: "", value: "images/:filename:", line: 3 },
      ],
    });
    expect(document.rules[1]?.clauses[1]).toMatchObject({
      kind: "capture",
      name: "capturegroups",
    });
    expect(document.source).toBe(source);
  });

  test("adds and removes a disabled control clause without changing the rule", () => {
    const disabled = setRoutingRuleEnabled(source, 0, false);

    expect(disabled).toContain(
      "// Images from the CDN\n  sourceurl/i: cdn\\.example\\.com  \ninto: images/:filename:\ndisabled: true",
    );
    expect(parseVisualRoutingRules(disabled).rules[0]).toMatchObject({
      enabled: false,
      clauses: [{ name: "sourceurl" }, { name: "into" }],
    });
    expect(setRoutingRuleEnabled(disabled, 0, true)).toBe(source);
  });

  test("patches only a clause value and preserves surrounding bytes", () => {
    expect(updateRoutingClause(source, 0, 0, { value: "assets\\.example\\.com" })).toBe(
      [
        "// Images from the CDN",
        "  sourceurl/i: assets\\.example\\.com  ",
        "into: images/:filename:",
        "",
        "fileext: pdf",
        "capturegroups: fileext",
        "into: documents/:filename:",
      ].join("\n"),
    );
  });

  test("updates matcher flags without normalizing its formatting", () => {
    const sensitive = updateRoutingClause(source, 0, 0, { caseInsensitive: false });
    expect(sensitive).toContain("  sourceurl: cdn\\.example\\.com  ");
    expect(updateRoutingClause(sensitive, 0, 0, { caseInsensitive: true })).toBe(source);
  });

  test("updates destinations through the same source patch model", () => {
    expect(updateRoutingClause(source, 1, 2, { value: "papers/:filename:" })).toContain(
      "into: papers/:filename:",
    );
  });

  test("inserts a matcher immediately before capture and destination clauses", () => {
    expect(
      addRoutingClause(source, 1, {
        name: "pagedomain",
        value: "example\\.com$",
        caseInsensitive: true,
      }),
    ).toContain(
      [
        "fileext: pdf",
        "pagedomain/i: example\\.com$",
        "capturegroups: fileext",
        "into: documents/:filename:",
      ].join("\n"),
    );
  });

  test("deletes one clause line without disturbing comments or other rules", () => {
    expect(deleteRoutingClause(source, 1, 1)).toBe(source.replace("capturegroups: fileext\n", ""));
  });

  test("adds a canonical rule after the existing document", () => {
    expect(
      addRoutingRule("filename: jpg\ninto: images/:filename:\n", {
        name: "mime",
        value: "^application/pdf$",
        destination: "documents/:filename:",
      }),
    ).toBe(
      "filename: jpg\ninto: images/:filename:\n\nmime: ^application/pdf$\ninto: documents/:filename:\n",
    );
  });

  test("adds a disabled, guarded automatic-source rule", () => {
    expect(addAutomaticRoutingRule("filename: jpg\ninto: images/:filename:\n")).toContain(
      [
        "context: ^auto$",
        "pageurl: ^https://example\\.com/",
        "sourcekind: ^image$",
        "into: automatic/:pagedomain:/",
        "disabled: true",
      ].join("\n"),
    );
  });

  test("duplicates a rule with its attached comment", () => {
    const duplicated = duplicateRoutingRule(source, 0);
    expect(duplicated.match(/\/\/ Images from the CDN/g)).toHaveLength(2);
    expect(duplicated).toContain(
      "into: images/:filename:\n\n// Images from the CDN\n  sourceurl/i:",
    );
  });

  test("deletes a rule and its attached comment with one separator", () => {
    expect(deleteRoutingRule(source, 0)).toBe(
      "fileext: pdf\ncapturegroups: fileext\ninto: documents/:filename:",
    );
  });

  test("moves rules while carrying attached comments and preserving rule text", () => {
    expect(moveRoutingRule(source, 0, 1)).toBe(
      [
        "fileext: pdf",
        "capturegroups: fileext",
        "into: documents/:filename:",
        "",
        "// Images from the CDN",
        "  sourceurl/i: cdn\\.example\\.com  ",
        "into: images/:filename:",
      ].join("\n"),
    );
  });

  test("marks malformed rule blocks as read-only and refuses destructive edits", () => {
    const malformed = "filename: jpg\nnot a clause\ninto: images/:filename:";
    const document = parseVisualRoutingRules(malformed);

    expect(document.rules[0]).toMatchObject({ editable: false, line: 1 });
    expect(document.rules[0]?.issues[0]).toMatchObject({ line: 2, code: "bad-clause" });
    expect(() => updateRoutingClause(malformed, 0, 0, { value: "png" })).toThrow(
      /Edit this rule in Text mode/,
    );
  });

  test("keeps CRLF endings when inserting clauses and rules", () => {
    const crlf = "filename: jpg\r\ninto: images/:filename:\r\n";
    expect(addRoutingClause(crlf, 0, { name: "context", value: "image" })).toBe(
      "filename: jpg\r\ncontext: image\r\ninto: images/:filename:\r\n",
    );
    expect(
      addRoutingRule(crlf, {
        name: "fileext",
        value: "pdf",
        destination: "documents/:filename:",
      }),
    ).toBe(
      "filename: jpg\r\ninto: images/:filename:\r\n\r\nfileext: pdf\r\ninto: documents/:filename:\r\n",
    );
    const disabled = setRoutingRuleEnabled(crlf, 0, false);
    expect(disabled).toBe("filename: jpg\r\ninto: images/:filename:\r\ndisabled: true\r\n");
    expect(setRoutingRuleEnabled(disabled, 0, true)).toBe(crlf);
  });
});

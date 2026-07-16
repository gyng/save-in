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
  setRoutingRuleName,
  updateRoutingClause,
} from "../../../src/options/rule-editor/rule-visual-editor-model.ts";

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

  test("renames an attached rule comment without changing its clauses", () => {
    expect(setRoutingRuleName(source, 0, "CDN images")).toBe(
      source.replace("// Images from the CDN", "// CDN images"),
    );
  });

  test("adds and removes a name on an unnamed rule", () => {
    const unnamed = "filename: jpg\ninto: images\n\nfileext: pdf\ninto: documents";
    const named = setRoutingRuleName(unnamed, 1, "PDF files");

    expect(named).toBe(
      "filename: jpg\ninto: images\n\n// PDF files\nfileext: pdf\ninto: documents",
    );
    expect(setRoutingRuleName(named, 1, "")).toBe(unnamed);
    expect(setRoutingRuleName(unnamed, 1, "  ")).toBe(unnamed);
  });

  test("collapses a multiline attached comment into one trimmed rule name", () => {
    expect(setRoutingRuleName("// First\n// Second\nfilename: jpg", 0, "  New\nname  ")).toBe(
      "// New name\nfilename: jpg",
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

  test("updates a matcher name, flags, and unpadded value in one lossless patch", () => {
    expect(
      updateRoutingClause("filename/i: jpg\ninto: images", 0, 0, {
        name: "fileext",
        caseInsensitive: false,
        value: "png",
      }),
    ).toBe("fileext: png\ninto: images");
    expect(updateRoutingClause("filename: jpg\ninto: images", 0, 0, { name: "fileext" })).toBe(
      "fileext: jpg\ninto: images",
    );
    expect(updateRoutingClause("filename: pdf\ninto:", 0, 1, { value: ":filename:" })).toBe(
      "filename: pdf\ninto: :filename:",
    );
    expect(updateRoutingClause("filename: pdf\ninto:old", 0, 1, { value: ":date:" })).toBe(
      "filename: pdf\ninto: :date:",
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

  test("appends a clause when an incomplete rule has no capture or destination", () => {
    expect(addRoutingClause("filename: jpg", 0, { name: "context", value: "image" })).toBe(
      "filename: jpg\ncontext: image",
    );
  });

  test("inserts a fetch clause after capture but immediately before the destination", () => {
    expect(
      addRoutingClause(source, 1, { name: "fetch", value: "https://x.example/:$1:" }),
    ).toContain(
      [
        "fileext: pdf",
        "capturegroups: fileext",
        "fetch: https://x.example/:$1:",
        "into: documents/:filename:",
      ].join("\n"),
    );
    expect(
      addRoutingClause("filename: jpg\ninto: images", 0, {
        name: "fetch",
        value: "https://x.example/full.jpg",
      }),
    ).toBe("filename: jpg\nfetch: https://x.example/full.jpg\ninto: images");
  });

  test("deletes one clause line without disturbing comments or other rules", () => {
    expect(deleteRoutingClause(source, 1, 1)).toBe(source.replace("capturegroups: fileext\n", ""));
  });

  test("deletes a final clause by consuming its preceding newline", () => {
    expect(deleteRoutingClause("filename: jpg\ninto: images", 0, 1)).toBe("filename: jpg");
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

  test("adds an enabled, guarded automatic-source rule", () => {
    const source = addAutomaticRoutingRule("filename: jpg\ninto: images/:filename:\n");
    expect(source).toContain(
      [
        "context: ^auto$",
        "pageurl: ^https://example\\.com/",
        "sourcekind: ^image$",
        "into: automatic/:pagedomain:/",
      ].join("\n"),
    );
    expect(source).not.toContain("disabled: true");
  });

  test.each([
    ["", ""],
    ["filename: jpg\ninto: images", "\n\n"],
    ["filename: jpg\ninto: images\n", "\n"],
    ["filename: jpg\ninto: images\n\n", ""],
  ])("adds canonical and automatic rules after separator form %j", (prefix, separator) => {
    expect(
      addRoutingRule(prefix, {
        name: "fileext",
        value: "pdf",
        destination: "documents",
        caseInsensitive: true,
      }),
    ).toBe(`${prefix}${separator}fileext/i: pdf\ninto: documents\n`);
    expect(
      addAutomaticRoutingRule(prefix).startsWith(`${prefix}${separator}context: ^auto$\n`),
    ).toBe(true);
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

  test("deletes a sole rule or the final rule", () => {
    expect(deleteRoutingRule("filename: jpg\ninto: images", 0)).toBe("");
    expect(deleteRoutingRule(source, 1)).toBe(
      "// Images from the CDN\n  sourceurl/i: cdn\\.example\\.com  \ninto: images/:filename:",
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

  test("rejects invalid model indexes and treats a same-position move as a no-op", () => {
    expect(() => updateRoutingClause(source, 0, 99, { value: "x" })).toThrow(/Routing clause 100/);
    expect(() => deleteRoutingClause(source, 0, 99)).toThrow(/Routing clause 100/);
    expect(() => duplicateRoutingRule(source, 99)).toThrow(/Routing rule 100/);
    expect(() => moveRoutingRule(source, 0, -1)).toThrow(/Routing rule 0/);
    expect(() => moveRoutingRule(source, 0, 2)).toThrow(/Routing rule 3/);
    expect(moveRoutingRule(source, 0, 0)).toBe(source);
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

  test.each([
    "filename/x: jpg\ninto: images",
    "disabled: maybe\nfilename: jpg\ninto: images",
    "disabled/i: false\nfilename: jpg\ninto: images",
    "disabled: false\ndisabled: true\nfilename: jpg\ninto: images",
  ])("marks unsupported visual control syntax as read-only", (unsupported) => {
    expect(parseVisualRoutingRules(unsupported).rules[0]?.editable).toBe(false);
    expect(() => setRoutingRuleEnabled(unsupported, 0, false)).toThrow(/Text mode/);
  });

  test("updates an existing disabled control and removes a trailing control", () => {
    const disabled = "filename: jpg\ninto: images\ndisabled: false";
    expect(setRoutingRuleEnabled(disabled, 0, false)).toBe(
      "filename: jpg\ninto: images\ndisabled: true",
    );
    expect(setRoutingRuleEnabled(disabled, 0, true)).toBe("filename: jpg\ninto: images");
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

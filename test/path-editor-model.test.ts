import {
  getPathAlias,
  getPathSourceRange,
  parsePathLine,
  pathLinesToRows,
  serializePathLine,
  setPathAlias,
} from "../src/options/path-editor-model.ts";

describe("path editor model", () => {
  test("parses and serializes normalized path rows", () => {
    const row = parsePathLine(">>i/cats // cute (alias: Cats)");
    expect(row).toEqual({ depth: 2, body: "i/cats", comment: "cute (alias: Cats)" });
    expect(serializePathLine(row)).toBe(">>i/cats // cute (alias: Cats)");
    expect(pathLinesToRows("a\n\n>b")).toHaveLength(2);
  });

  test("updates aliases without disturbing other comment metadata", () => {
    expect(getPathAlias("cute (edited) (alias: Cats (tabby)) (key: c)")).toBe("Cats (tabby)");
    expect(setPathAlias("cute (edited) (alias: Cats (tabby)) (key: c)", "Dogs")).toBe(
      "cute (edited) (key: c) (alias: Dogs)",
    );
    expect(setPathAlias("cute  notes (alias: Cats) (key: c)", "Dogs")).toBe(
      "cute  notes (key: c) (alias: Dogs)",
    );
  });

  test("maps a menu source index to the matching non-empty text line", () => {
    const text = "  images  \n\nimages\n  >images/cats  ";

    expect(getPathSourceRange(text, 1)).toEqual({ start: 12, end: 18 });
    expect(getPathSourceRange(text, 2)).toEqual({ start: 21, end: 33 });
    expect(getPathSourceRange(text, 3)).toBeNull();
  });
});

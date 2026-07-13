import {
  getPathAlias,
  getPathEnabled,
  getPathSourceRange,
  parseDirectoryLine,
  pathLinesToNodes,
  serializeDirectoryLine,
  setPathAlias,
  setPathEnabled,
} from "../src/options/path-editor-model.ts";

describe("path editor model", () => {
  test("parses and serializes lossless directory AST nodes", () => {
    const node = parseDirectoryLine(">>i/cats // cute (alias: Cats)");
    expect(node).toEqual(
      expect.objectContaining({
        kind: "directory-line",
        depth: 2,
        path: expect.objectContaining({ value: "i/cats" }),
        comment: expect.objectContaining({ value: "cute (alias: Cats)" }),
      }),
    );
    expect(serializeDirectoryLine(node)).toBe(">>i/cats // cute (alias: Cats)");
    expect(pathLinesToNodes("a\n\n>b")).toHaveLength(2);
    expect(pathLinesToNodes("  a  \n\n\t>b // c  ").map(serializeDirectoryLine)).toEqual([
      "  a  ",
      "\t>b // c  ",
    ]);
  });

  test("updates aliases without disturbing other comment metadata", () => {
    const node = parseDirectoryLine("path // cute (edited) (alias: Cats (tabby)) (key: c)");
    expect(getPathAlias(node)).toBe("Cats (tabby)");
    expect(serializeDirectoryLine(setPathAlias(node, "Dogs"))).toBe(
      "path // cute (edited) (key: c) (alias: Dogs)",
    );
    expect(
      serializeDirectoryLine(
        setPathAlias(parseDirectoryLine("path // cute  notes (alias: Cats) (key: c)"), "Dogs"),
      ),
    ).toBe("path // cute  notes (key: c) (alias: Dogs)");
    expect(
      serializeDirectoryLine(
        setPathAlias(parseDirectoryLine("  path\t //  cute (alias: Cats)  "), "Dogs"),
      ),
    ).toBe("  path\t //  cute (alias: Dogs)  ");
  });

  test("stores the enabled state in existing comment metadata", () => {
    const node = parseDirectoryLine("path // note (alias: Work)");

    expect(getPathEnabled(node)).toBe(true);
    const disabled = setPathEnabled(node, false);
    expect(serializeDirectoryLine(disabled)).toBe("path // note (alias: Work) (disabled: true)");
    expect(getPathEnabled(disabled)).toBe(false);
    expect(serializeDirectoryLine(setPathEnabled(disabled, true))).toBe(
      "path // note (alias: Work)",
    );
  });

  test("maps a menu source index to the matching non-empty text line", () => {
    const text = "  images  \n\nimages\n  >images/cats  ";

    expect(getPathSourceRange(text, 1)).toEqual({ start: 12, end: 18 });
    expect(getPathSourceRange(text, 2)).toEqual({ start: 21, end: 33 });
    expect(getPathSourceRange(text, 3)).toBeNull();
  });
});

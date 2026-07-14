import {
  deletePathNode,
  dropPathNode,
  getPathAccessKey,
  getPathAlias,
  getPathEnabled,
  getPathSourceRange,
  pathNodesToLines,
  parseDirectoryLine,
  pathLinesToNodes,
  reorderPathNode,
  serializeDirectoryLine,
  setPathAlias,
  setPathAccessKey,
  setPathEnabled,
} from "../../../src/options/path-editor-model.ts";

describe("path editor model", () => {
  const edit = (
    text: string,
    update: (nodes: ReturnType<typeof pathLinesToNodes>) => ReturnType<typeof pathLinesToNodes>,
  ) => pathNodesToLines(update(pathLinesToNodes(text))).join("\n");

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

  test("updates access keys without disturbing other comment metadata", () => {
    const node = parseDirectoryLine("path // note (alias: Work) (key: w)");

    expect(getPathAccessKey(node)).toBe("w");
    expect(serializeDirectoryLine(setPathAccessKey(node, "p"))).toBe(
      "path // note (alias: Work) (key: p)",
    );
    expect(serializeDirectoryLine(setPathAccessKey(node, ""))).toBe("path // note (alias: Work)");
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

  test.each([
    ["a\nb\nc", 0, 2, "after", "b\nc\na"],
    ["a\n>b\nc", 2, 1, "after", "a\n>b\n>c"],
    ["a\nb\nc", 2, 1, "before", "a\nc\nb"],
    ["a\nb\nc", 2, 0, "inside", "a\n>c\nb"],
    [
      "group\n>child\n>>grandchild\nsibling",
      3,
      2,
      "inside",
      "group\n>child\n>>grandchild\n>>>sibling",
    ],
    ["parent\n>child\nsibling", 0, 2, "after", "child\nsibling\nparent"],
  ] as const)(
    "moves path rows without producing invalid hierarchy %#",
    (text, from, target, placement, expected) => {
      expect(edit(text, (nodes) => dropPathNode(nodes, from, target, placement))).toBe(expected);
    },
  );

  test("treats invalid and same-row moves as no-ops", () => {
    expect(edit("a\nb\nc", (nodes) => dropPathNode(nodes, 1, 1, "inside"))).toBe("a\nb\nc");
    expect(edit("a\nb\nc", (nodes) => reorderPathNode(nodes, 0, -1))).toBe("a\nb\nc");
    expect(edit("a\nb\nc", (nodes) => deletePathNode(nodes, 9))).toBe("a\nb\nc");
  });

  test("normalizes keyboard reordering and promotes children when a parent is deleted", () => {
    expect(edit("a\n>b\nc", (nodes) => reorderPathNode(nodes, 1, 0))).toBe("b\na\nc");
    expect(edit("parent\n>child\n>>grandchild\nsibling", (nodes) => deletePathNode(nodes, 0))).toBe(
      "child\n>grandchild\nsibling",
    );
  });
});

import {
  getPathAlias,
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
    expect(getPathAlias("cute (alias: Cats) (key: c)")).toBe("Cats");
    expect(setPathAlias("cute (alias: Cats) (key: c)", "Dogs")).toBe("cute (key: c) (alias: Dogs)");
  });
});

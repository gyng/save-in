import { parsePickerModel, parsePickerSource } from "../../src/shared/destination-picker.ts";
import { DATA_URL_MAX_LENGTH } from "../../src/shared/data-url.ts";

const copy = { title: "Choose a folder", filter: "Filter", empty: "None", lastUsed: "Last used" };

describe("destination picker contract", () => {
  test("keeps the ids and titles the page side needs and nothing else", () => {
    expect(
      parsePickerModel({
        lastUsed: { id: "save-in-last-used", title: "Photos", path: "secret/path" },
        items: [
          { kind: "path", id: "save-in-0", title: "Work", parentId: null, parsedDir: "work" },
          { kind: "separator", id: "ignored" },
          { kind: "path", id: "save-in-2", title: "Deep", parentId: "save-in-0" },
          { kind: "path", id: "save-in-3", title: "No parent field" },
        ],
        copy: { ...copy, extra: "ignored" },
      }),
    ).toEqual({
      lastUsed: { id: "save-in-last-used", title: "Photos" },
      items: [
        { kind: "path", id: "save-in-0", title: "Work", parentId: null },
        { kind: "separator" },
        { kind: "path", id: "save-in-2", title: "Deep", parentId: "save-in-0" },
        { kind: "path", id: "save-in-3", title: "No parent field", parentId: null },
      ],
      copy,
    });
  });

  test("keeps a one-character key and drops anything else", () => {
    const keyed = (key: unknown) =>
      parsePickerModel({
        lastUsed: { id: "save-in-last-used", title: "Photos", key },
        items: [{ kind: "path", id: "save-in-0", title: "Work", key }],
        copy,
      });

    expect(keyed("e")?.lastUsed).toEqual({ id: "save-in-last-used", title: "Photos", key: "e" });
    expect(keyed("1")?.items[0]).toMatchObject({ key: "1" });
    for (const bad of ["ab", "", " ", 7, null, undefined]) {
      expect(keyed(bad)?.lastUsed).toEqual({ id: "save-in-last-used", title: "Photos" });
      expect(keyed(bad)?.items[0]).not.toHaveProperty("key");
    }
  });

  test("treats an unusable Last used entry as none", () => {
    expect(parsePickerModel({ lastUsed: null, items: [], copy })?.lastUsed).toBeNull();
    expect(parsePickerModel({ lastUsed: { id: "x" }, items: [], copy })?.lastUsed).toBeNull();
    expect(parsePickerModel({ lastUsed: { title: "x" }, items: [], copy })?.lastUsed).toBeNull();
  });

  test.each([
    ["no answer", undefined],
    ["a non-record", "model"],
    ["items that are not a list", { items: {}, copy }],
    ["missing copy", { items: [] }],
    ["non-record copy", { items: [], copy: "Choose" }],
    ["incomplete copy", { items: [], copy: { ...copy, empty: "" } }],
    ["a non-record item", { items: ["save-in-0"], copy }],
    ["an unknown item kind", { items: [{ kind: "folder", id: "a", title: "A" }], copy }],
    ["an item without an id", { items: [{ kind: "path", title: "A" }], copy }],
    ["an item without a title", { items: [{ kind: "path", id: "a", title: 7 }], copy }],
    ["an oversized title", { items: [{ kind: "path", id: "a", title: "x".repeat(1025) }], copy }],
    [
      "too many items",
      { items: Array.from({ length: 2001 }, () => ({ kind: "separator" })), copy },
    ],
  ])("rejects %s", (_label, value) => {
    expect(parsePickerModel(value)).toBeNull();
  });

  test("accepts a click-to-save source up to the inline data cap", () => {
    const large = `data:image/png;base64,${"A".repeat(20_000)}`;
    expect(parsePickerSource({ media: { url: large, kind: "image" } })).toEqual({
      media: { url: large, kind: "image" },
    });
    expect(parsePickerSource({ linkUrl: "https://example.test/a" })).toEqual({
      linkUrl: "https://example.test/a",
    });
    expect(
      parsePickerSource({ linkUrl: `data:text/plain,${"x".repeat(DATA_URL_MAX_LENGTH)}` }),
    ).toBeNull();
    expect(parsePickerSource(null)).toBeNull();
  });
});

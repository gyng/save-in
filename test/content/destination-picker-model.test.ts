import {
  createPickerState,
  filterPickerRows,
  flattenPickerModel,
  hasPickerDestinations,
  movePickerActive,
  setPickerActive,
  setPickerQuery,
  type PickerRow,
} from "../../src/content/destination-picker-model.ts";
import type { PickerItem, PickerModel } from "../../src/shared/destination-picker.ts";

const copy = { title: "Choose a folder", filter: "Filter", empty: "None", lastUsed: "Last used" };
const path = (id: string, title: string, parentId: string | null = null): PickerItem => ({
  kind: "path",
  id,
  title,
  parentId,
});
const separator: PickerItem = { kind: "separator" };
const model = (items: PickerItem[], lastUsed: PickerModel["lastUsed"] = null): PickerModel => ({
  lastUsed,
  items,
  copy,
});
const destination = (
  id: string,
  title: string,
  overrides: Partial<Extract<PickerRow, { kind: "destination" }>> = {},
): PickerRow => ({
  kind: "destination",
  id,
  title,
  label: title,
  depth: 0,
  lastUsed: false,
  ...overrides,
});

const nested = model(
  [
    path("a", "Images"),
    path("b", "Work"),
    path("c", "Reports", "b"),
    path("d", "2026", "c"),
    path("e", "Invoices", "b"),
    separator,
    path("f", "Read later"),
  ],
  { id: "last", title: "Wallpapers" },
);

describe("flattening the picker model", () => {
  test("lists Last used first, then the menu in order with nesting as depth", () => {
    expect(flattenPickerModel(nested)).toEqual([
      destination("last", "Wallpapers", { lastUsed: true }),
      { kind: "separator" },
      destination("a", "Images"),
      { kind: "heading", title: "Work", depth: 0 },
      { kind: "heading", title: "Reports", depth: 1 },
      destination("d", "2026", { depth: 2, label: "Work / Reports / 2026" }),
      destination("e", "Invoices", { depth: 1, label: "Work / Invoices" }),
      { kind: "separator" },
      destination("f", "Read later"),
    ]);
  });

  test("never starts, ends, or doubles up on a separator", () => {
    expect(flattenPickerModel(model([separator, path("a", "A"), separator, separator]))).toEqual([
      destination("a", "A"),
    ]);
    expect(
      flattenPickerModel(model([separator, path("a", "A")], { id: "last", title: "L" })),
    ).toEqual([
      destination("last", "L", { lastUsed: true }),
      { kind: "separator" },
      destination("a", "A"),
    ]);
    expect(flattenPickerModel(model([], { id: "last", title: "L" }))).toEqual([
      destination("last", "L", { lastUsed: true }),
    ]);
    expect(flattenPickerModel(model([]))).toEqual([]);
  });

  test("places an item whose parent was not sent at the top level", () => {
    expect(flattenPickerModel(model([path("a", "Orphan", "missing")]))).toEqual([
      destination("a", "Orphan"),
    ]);
  });

  test("knows whether anything can be picked", () => {
    expect(hasPickerDestinations(flattenPickerModel(nested))).toBe(true);
    expect(hasPickerDestinations([{ kind: "heading", title: "Work", depth: 0 }])).toBe(false);
    expect(hasPickerDestinations([])).toBe(false);
  });
});

describe("filtering", () => {
  const rows = flattenPickerModel(nested);

  test("an empty or blank query keeps the whole structure", () => {
    expect(filterPickerRows(rows, "")).toEqual(rows);
    expect(filterPickerRows(rows, "   ")).toEqual(rows);
  });

  test("matches every term against the full label, in any order and case", () => {
    expect(filterPickerRows(rows, "REPORTS work")).toEqual([
      destination("d", "Work / Reports / 2026", { label: "Work / Reports / 2026" }),
    ]);
    expect(
      filterPickerRows(rows, "w").map((row) => (row.kind === "destination" ? row.id : "")),
    ).toEqual(["last", "d", "e"]);
  });

  test("a filtered list is flat and can be empty", () => {
    expect(filterPickerRows(rows, "invoices")).toEqual([
      destination("e", "Work / Invoices", { label: "Work / Invoices" }),
    ]);
    expect(filterPickerRows(rows, "nothing here")).toEqual([]);
  });
});

describe("keyboard state", () => {
  const rows = flattenPickerModel(nested);

  test("starts on the first destination, or on nothing", () => {
    expect(createPickerState(rows)).toEqual({ rows, visible: rows, query: "", activeId: "last" });
    expect(createPickerState([]).activeId).toBeNull();
  });

  test("moves over destinations only and wraps at both ends", () => {
    let state = createPickerState(rows);
    const visited = [state.activeId];
    for (let step = 0; step < 5; step += 1) {
      state = movePickerActive(state, 1);
      visited.push(state.activeId);
    }
    expect(visited).toEqual(["last", "a", "d", "e", "f", "last"]);

    state = movePickerActive(state, -1);
    expect(state.activeId).toBe("f");
    state = movePickerActive(state, -1);
    expect(state.activeId).toBe("e");
  });

  test("moving with no active row starts from the matching end", () => {
    const idle = { ...createPickerState(rows), activeId: null };
    expect(movePickerActive(idle, 1).activeId).toBe("last");
    expect(movePickerActive(idle, -1).activeId).toBe("f");
  });

  test("moving through an empty list changes nothing", () => {
    const empty = setPickerQuery(createPickerState(rows), "nothing here");
    expect(empty.activeId).toBeNull();
    expect(movePickerActive(empty, 1)).toBe(empty);
  });

  test("a new query restarts from its first match", () => {
    const moved = movePickerActive(movePickerActive(createPickerState(rows), 1), 1);
    const filtered = setPickerQuery(moved, "work");
    expect(filtered).toMatchObject({ query: "work", activeId: "d" });
    expect(filtered.visible).toHaveLength(2);
    expect(setPickerQuery(filtered, "").activeId).toBe("last");
  });

  test("activates only a destination that is listed and not already active", () => {
    const state = createPickerState(rows);
    expect(setPickerActive(state, "e").activeId).toBe("e");
    expect(setPickerActive(state, "last")).toBe(state);
    expect(setPickerActive(state, "missing")).toBe(state);
    expect(setPickerActive(setPickerQuery(state, "work"), "a").activeId).toBe("d");
  });
});

import {
  createPickerState,
  filterPickerRows,
  flattenPickerModel,
  hasPickerDestinations,
  movePickerActive,
  isPickerKeyLive,
  leavePickerScope,
  pickerKeyAction,
  setPickerActive,
  setPickerQuery,
  pickerSubject,
  splitPickerMatches,
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
  parentId: null,
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
      { kind: "heading", id: "b", title: "Work", depth: 0, parentId: null },
      { kind: "heading", id: "c", title: "Reports", depth: 1, parentId: "b" },
      destination("d", "2026", { depth: 2, label: "Work / Reports / 2026", parentId: "c" }),
      destination("e", "Invoices", { depth: 1, label: "Work / Invoices", parentId: "b" }),
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
    expect(
      hasPickerDestinations([
        { kind: "heading", id: "w", title: "Work", depth: 0, parentId: null },
      ]),
    ).toBe(false);
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
      destination("d", "Work / Reports / 2026", {
        label: "Work / Reports / 2026",
        parentId: "c",
      }),
    ]);
    expect(
      filterPickerRows(rows, "w").map((row) => (row.kind === "destination" ? row.id : "")),
    ).toEqual(["last", "d", "e"]);
  });

  test("a filtered list is flat and can be empty", () => {
    expect(filterPickerRows(rows, "invoices")).toEqual([
      destination("e", "Work / Invoices", { label: "Work / Invoices", parentId: "b" }),
    ]);
    expect(filterPickerRows(rows, "nothing here")).toEqual([]);
  });
});

describe("keyboard state", () => {
  const rows = flattenPickerModel(nested);

  test("starts on the first destination, or on nothing", () => {
    expect(createPickerState(rows)).toEqual({
      rows,
      visible: rows,
      query: "",
      activeId: "last",
      scope: null,
    });
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

describe("picker subject", () => {
  test.each([
    [
      "an image by its file name",
      { media: { url: "https://cdn.test/a/b/forest%20dawn.jpg?x=1", kind: "image" as const } },
      { kind: "image", name: "forest dawn.jpg" },
    ],
    [
      "media over its link",
      {
        media: { url: "https://cdn.test/v.mp4", kind: "video" as const },
        linkUrl: "https://x.test/page",
      },
      { kind: "video", name: "v.mp4" },
    ],
    [
      "a link by its last segment",
      { linkUrl: "https://x.test/files/doc.pdf" },
      { kind: "link", name: "doc.pdf" },
    ],
    ["a bare host", { linkUrl: "https://x.test/" }, { kind: "link", name: "x.test" }],
    [
      "a segment that is not valid percent-encoding",
      { linkUrl: "https://x.test/100%" },
      { kind: "link", name: "100%" },
    ],
    [
      "an inline address, which has no name",
      { media: { url: "data:image/png;base64,AAAA", kind: "image" as const } },
      { kind: "image", name: "" },
    ],
    ["an address that does not parse", { linkUrl: "not a url" }, { kind: "link", name: "" }],
  ])("names %s", (_label, source, expected) => {
    expect(pickerSubject(source, "Ignored title")).toEqual(expected);
  });

  test("names the page by its trimmed title", () => {
    expect(pickerSubject(null, "  Gallery  ")).toEqual({ kind: "page", name: "Gallery" });
    expect(pickerSubject({}, "")).toEqual({ kind: "page", name: "" });
  });
});

describe("filter match marks", () => {
  test("leaves a title whole when nothing is being filtered", () => {
    expect(splitPickerMatches("Images / Nature", "  ")).toEqual([
      { text: "Images / Nature", match: false },
    ]);
  });

  test("marks every term wherever it occurs, in any case", () => {
    expect(splitPickerMatches("Images / Nature", "na IM")).toEqual([
      { text: "Im", match: true },
      { text: "ages / ", match: false },
      { text: "Na", match: true },
      { text: "ture", match: false },
    ]);
  });

  test("merges overlapping and repeated matches", () => {
    expect(splitPickerMatches("banana", "ana nan")).toEqual([
      { text: "b", match: false },
      { text: "anana", match: true },
    ]);
  });

  test("shows a title unmarked when case folding changes its length", () => {
    expect(splitPickerMatches("\u0130stanbul", "i")).toEqual([
      { text: "\u0130stanbul", match: false },
    ]);
  });
});

describe("menu keys", () => {
  // Images=1, Work=2 (a submenu: Reports=1, Archive=2 (a submenu: 2026=1)), Notes has none.
  const keyed: PickerModel = {
    lastUsed: { id: "save-in-last-used", title: "Wallpapers", key: "e" },
    items: [
      { kind: "path", id: "images", title: "Images", parentId: null, key: "1" },
      { kind: "path", id: "work", title: "Work", parentId: null, key: "2" },
      { kind: "path", id: "reports", title: "Reports", parentId: "work", key: "1" },
      { kind: "path", id: "archive", title: "Archive", parentId: "work", key: "2" },
      { kind: "path", id: "y2026", title: "2026", parentId: "archive", key: "1" },
      { kind: "path", id: "notes", title: "Notes", parentId: null },
    ],
    copy,
  };
  const state = () => createPickerState(flattenPickerModel(keyed));
  const enter = (from: ReturnType<typeof state>, key: string) => {
    const action = pickerKeyAction(from, key);
    if (action?.kind !== "enter") throw new Error(`key ${key} did not enter a submenu`);
    return action.state;
  };

  test("a top-level key picks its destination in either case", () => {
    expect(pickerKeyAction(state(), "1")).toEqual({ kind: "pick", id: "images" });
    expect(pickerKeyAction(state(), "E")).toEqual({ kind: "pick", id: "save-in-last-used" });
  });

  test("a submenu's key steps into it, and the same digit then means its child", () => {
    const inWork = enter(state(), "2");

    expect(inWork.scope).toBe("work");
    expect(inWork.activeId).toBe("reports");
    expect(pickerKeyAction(inWork, "1")).toEqual({ kind: "pick", id: "reports" });
  });

  test("nested submenus step in one level at a time and back out the same way", () => {
    const inArchive = enter(enter(state(), "2"), "2");

    expect(inArchive.scope).toBe("archive");
    expect(inArchive.activeId).toBe("y2026");
    expect(pickerKeyAction(inArchive, "1")).toEqual({ kind: "pick", id: "y2026" });
    expect(leavePickerScope(inArchive).scope).toBe("work");
    expect(leavePickerScope(leavePickerScope(inArchive)).scope).toBeNull();
    expect(leavePickerScope(state())).toEqual(state());
  });

  test("a submenu with nothing to pick keeps the highlight where it was", () => {
    const empty = createPickerState([
      {
        kind: "destination",
        id: "a",
        title: "A",
        label: "A",
        depth: 0,
        lastUsed: false,
        parentId: null,
      },
      { kind: "heading", id: "h", title: "H", depth: 0, parentId: null, key: "9" },
      { kind: "separator" },
      { kind: "heading", id: "inner", title: "Inner", depth: 1, parentId: "h" },
    ]);

    expect(enter(empty, "9")).toMatchObject({ scope: "h", activeId: "a" });
  });

  test("leaving a submenu whose heading is gone returns to the top", () => {
    expect(leavePickerScope({ ...state(), scope: "missing" }).scope).toBeNull();
  });

  test("a key nothing at this level owns does nothing", () => {
    expect(pickerKeyAction(state(), "x")).toBeNull();
    expect(pickerKeyAction(state(), "Enter")).toBeNull();
    // Reports is 1 only inside Work; at the top level 1 is Images.
    expect(pickerKeyAction(enter(state(), "2"), "e")).toBeNull();
  });

  test("keys stop once a filter is typed, and typing leaves any submenu", () => {
    const filtered = setPickerQuery(enter(state(), "2"), "ima");

    expect(filtered.scope).toBeNull();
    expect(pickerKeyAction(filtered, "1")).toBeNull();
  });

  test("a key is live only at the level the keys are in", () => {
    const rows = flattenPickerModel(keyed);
    const live = (from: ReturnType<typeof state>) =>
      rows.flatMap((row) =>
        row.kind !== "separator" && isPickerKeyLive(from, row) ? [row.id] : [],
      );

    expect(live(state())).toEqual(["save-in-last-used", "images", "work"]);
    expect(live(enter(state(), "2"))).toEqual(["reports", "archive"]);
    expect(live(setPickerQuery(state(), "i"))).toEqual([]);
    expect(isPickerKeyLive(state(), { kind: "separator" })).toBe(false);
  });
});

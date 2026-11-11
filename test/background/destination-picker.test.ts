import { options } from "../../src/config/options-data.ts";
import { menuState } from "../../src/background/menu-build.ts";
import { backgroundRuntime } from "../../src/background/runtime.ts";
import {
  buildPickerMenu,
  openPickerForActiveTab,
  openPickerInTab,
  pickerSourceForTab,
} from "../../src/background/destination-picker.ts";

const tab = { id: 9, url: "https://example.com/page", title: "P" };
const mapping = (parsedDir: string) => ({ parsedDir, comment: "", menuIndex: "1", title: "" });
const path = (id: string, title: string, parentId: string | null = null) => ({
  kind: "path",
  id,
  title,
  parentId,
});

const answerTabs = (hovered: unknown, opened: unknown = { opened: true }) => {
  global.browser.tabs.sendMessage = vi.fn((_tabId: number, message: { type: string }) =>
    Promise.resolve(message.type === "SAVE_IN_HOVERED_SOURCE" ? hovered : opened),
  ) as never;
};
const openRequests = () =>
  vi
    .mocked(global.browser.tabs.sendMessage)
    .mock.calls.filter(([, message]) => message.type === "SAVE_IN_OPEN_PICKER");

beforeEach(() => {
  backgroundRuntime.ready = Promise.resolve();
  Object.assign(options, {
    paths:
      "Images // (alias: Pictures)\nWork\n>Reports\n>>2026\n---\nRead later\nOff // (disabled: true)",
    links: true,
    page: true,
    selection: false,
    preferLinks: false,
    preferLinksFilterEnabled: false,
    enableLastLocation: true,
    routeHideFolderChoices: false,
    quickSaveEnabled: false,
    quickSaveOnly: false,
    persistPrivateActivity: false,
    // Keys have their own cases below; the structural cases read without them.
    enableNumberedItems: false,
    keyLastUsed: "",
  });
  Object.assign(menuState, {
    lastUsedPath: null,
    lastUsedMeta: null,
    privateLastUsedPath: null,
    privateLastUsedMeta: null,
    pathMappings: Object.fromEntries(
      [0, 1, 2, 3, 5].map((index) => [`save-in-${index}`, mapping(`dir-${index}`)]),
    ),
  });
  global.browser.tabs.query = vi.fn(() => Promise.resolve([tab])) as never;
  answerTabs(null);
});

describe("picker menu", () => {
  test("mirrors the context menu: titles, order, nesting, and separators", () => {
    const { model, selectable } = buildPickerMenu(false);

    expect(model.lastUsed).toBeNull();
    expect(model.items).toEqual([
      path("save-in-0", "Pictures"),
      path("save-in-1", "Work"),
      path("save-in-2", "Reports", "save-in-1"),
      path("save-in-3", "2026", "save-in-2"),
      { kind: "separator" },
      path("save-in-5", "Read later"),
    ]);
    // Submenu headings are listed but can never be chosen.
    expect([...selectable]).toEqual(["save-in-0", "save-in-3", "save-in-5"]);
  });

  test("offers Last used by its menu title, and only an id the click handler knows", () => {
    menuState.lastUsedPath = "wallpapers";
    menuState.lastUsedMeta = { title: "Wallpapers" };
    Reflect.deleteProperty(menuState.pathMappings, "save-in-5");

    const { model, selectable } = buildPickerMenu(false);

    expect(model.lastUsed).toEqual({ id: "save-in-last-used", title: "Wallpapers" });
    expect(model.items.at(-1)).toEqual({ kind: "separator" });
    expect([...selectable]).toEqual(["save-in-last-used", "save-in-0", "save-in-3"]);

    menuState.lastUsedMeta = null;
    expect(buildPickerMenu(false).model.lastUsed?.title).toBe("wallpapers");
    options.enableLastLocation = false;
    expect(buildPickerMenu(false).model.lastUsed).toBeNull();
  });

  test("gives every item the key the context menu shows for it", () => {
    options.paths = "First\nGroup\n>Nested\n>Keyed // (key: N)\nThird // (key: )\nFourth";
    options.enableNumberedItems = true;
    options.keyLastUsed = "E";
    menuState.lastUsedPath = "wallpapers";
    menuState.pathMappings = Object.fromEntries(
      [0, 1, 2, 3, 4, 5].map((index) => [`save-in-${index}`, mapping(`dir-${index}`)]),
    );

    const { model } = buildPickerMenu(false);

    expect(model.lastUsed?.key).toBe("e");
    expect(
      model.items.map((item) => (item.kind === "path" ? [item.title, item.key] : null)),
    ).toEqual([
      ["First", "1"],
      // A submenu keeps its own number, and its children are numbered within it.
      ["Group", "2"],
      ["Nested", "1"],
      ["Keyed", "n"],
      // An empty key asks for none, numbering included.
      ["Third", undefined],
      ["Fourth", "4"],
    ]);
  });

  test("an explicit key still applies with numbering off, and a tenth item has none", () => {
    options.paths = [
      "Keyed // (key: K)",
      ...Array.from({ length: 10 }, (_, index) => `Folder ${index + 2}`),
    ].join("\n");
    menuState.pathMappings = Object.fromEntries(
      Array.from({ length: 11 }, (_, index) => [`save-in-${index}`, mapping(`dir-${index}`)]),
    );

    const keysOf = () =>
      buildPickerMenu(false).model.items.map((item) => (item.kind === "path" ? item.key : null));

    expect(keysOf()[0]).toBe("k");
    expect(
      keysOf()
        .slice(1)
        .every((key) => key === undefined),
    ).toBe(true);
    options.enableNumberedItems = true;
    expect(keysOf()).toEqual(["k", "2", "3", "4", "5", "6", "7", "8", "9", undefined, undefined]);
  });

  test("offers no keys when numbering and the Last used key are off", () => {
    menuState.lastUsedPath = "wallpapers";

    const { model } = buildPickerMenu(false);

    expect(model.lastUsed).not.toHaveProperty("key");
    expect(model.items.every((item) => item.kind !== "path" || item.key === undefined)).toBe(true);
  });

  test("keeps a regular window's Last used out of a private tab", () => {
    menuState.lastUsedPath = "wallpapers";

    expect(buildPickerMenu(true).model.lastUsed).toBeNull();
    menuState.privateLastUsedPath = "private-folder";
    expect(buildPickerMenu(true).model.lastUsed?.title).toBe("private-folder");
    expect(buildPickerMenu(false).model.lastUsed?.title).toBe("wallpapers");

    options.persistPrivateActivity = true;
    expect(buildPickerMenu(true).model.lastUsed?.title).toBe("wallpapers");
  });

  test("offers only the routing item when the menu hides folder choices", () => {
    options.routeHideFolderChoices = true;
    menuState.lastUsedPath = "wallpapers";

    const { model, selectable } = buildPickerMenu(false);

    expect(model).toMatchObject({
      lastUsed: null,
      items: [path("save-in-route-exclusive", "Translated<contextMenuExclusive>")],
    });
    expect([...selectable]).toEqual(["save-in-route-exclusive"]);
  });

  test("offers nothing when the menu is Quick save only", () => {
    options.quickSaveEnabled = true;
    options.quickSaveOnly = true;

    const { model, selectable } = buildPickerMenu(false);

    expect(model).toMatchObject({ lastUsed: null, items: [] });
    expect(selectable.size).toBe(0);

    options.quickSaveEnabled = false;
    expect(buildPickerMenu(false).selectable.size).toBe(3);
  });
});

describe("picker source for a tab", () => {
  test("is what a menu click on the hovered element would save", async () => {
    const hovered = {
      media: { url: "https://img.example.com/a.png", kind: "image" },
      linkUrl: "https://example.com/full",
    };
    answerTabs(hovered);
    expect(await pickerSourceForTab(tab)).toEqual(hovered);

    answerTabs(null);
    expect(await pickerSourceForTab(tab)).toBeNull();
  });

  test("is the page for a link the link settings exclude, and nothing with page saves off", async () => {
    options.links = false;
    answerTabs({ linkUrl: "https://example.com/full" });
    expect(await pickerSourceForTab(tab)).toBeNull();

    options.page = false;
    expect(await pickerSourceForTab(tab)).toBeUndefined();
  });
});

describe("opening the picker", () => {
  test("asks the top frame and reports whether a picker appeared", async () => {
    const source = { linkUrl: "https://example.com/full" };

    expect(await openPickerInTab(tab, source)).toBe(true);
    expect(global.browser.tabs.sendMessage).toHaveBeenCalledWith(
      9,
      { type: "SAVE_IN_OPEN_PICKER", body: { source } },
      { frameId: 0 },
    );

    answerTabs(null, { opened: "yes" });
    expect(await openPickerInTab(tab, null)).toBe(false);
    answerTabs(null, null);
    expect(await openPickerInTab(tab, null)).toBe(false);
    expect(await openPickerInTab({ url: tab.url }, null)).toBe(false);
  });

  test("the command opens it for what is under the pointer in the active tab", async () => {
    const hovered = { media: { url: "https://img.example.com/a.png", kind: "image" } };
    answerTabs(hovered);

    await openPickerForActiveTab();

    expect(global.browser.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(openRequests()).toEqual([
      [9, { type: "SAVE_IN_OPEN_PICKER", body: { source: hovered } }, { frameId: 0 }],
    ]);
  });

  test("the command does nothing without a tab address or anything to save", async () => {
    // A cold start can deliver the command before init assigns the promise.
    Reflect.deleteProperty(backgroundRuntime, "ready");
    global.browser.tabs.query = vi.fn(() => Promise.resolve([])) as never;
    await openPickerForActiveTab();
    global.browser.tabs.query = vi.fn(() => Promise.resolve([{ id: 9 }])) as never;
    await openPickerForActiveTab();
    expect(global.browser.tabs.sendMessage).not.toHaveBeenCalled();

    global.browser.tabs.query = vi.fn(() => Promise.resolve([tab])) as never;
    options.page = false;
    await openPickerForActiveTab();
    expect(openRequests()).toEqual([]);
  });
});

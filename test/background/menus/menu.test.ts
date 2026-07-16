// Menu construction only reads the real options bag and WEB_EXTENSION_CAPABILITIES — the click
// handlers' Download/Notifier/Shortcut/currentTab deps are never exercised here,
// so those modules import for real (unused). chrome-detector is the one mock:
// its WEB_EXTENSION_CAPABILITIES is a read-only live binding, and tests need to swap it
// per tab-menu case, so a hoisted holder backs it.
const detector = vi.hoisted(() => ({ features: undefined as any }));
vi.mock("../../../src/platform/chrome-detector.ts", () => ({
  BROWSERS: { CHROME: "CHROME", FIREFOX: "FIREFOX", UNKNOWN: "UNKNOWN" },
  get WEB_EXTENSION_CAPABILITIES() {
    return detector.features;
  },
  get CURRENT_BROWSER() {
    return "CHROME";
  },
  CURRENT_BROWSER_VERSION: undefined,
  detectCapabilities: (b: string) => ({ tabContextMenus: b === "FIREFOX" }),
}));

import * as menuBuild from "../../../src/background/menu-build.ts";
import type { MenuContext } from "../../../src/background/menu-build.ts";
import * as menuTabs from "../../../src/background/menu-tabs.ts";
import * as menuTree from "../../../src/menus/menu-tree.ts";
import { SPECIAL_DIRS, MEDIA_TYPES } from "../../../src/shared/constants.ts";
import { options } from "../../../src/config/options-data.ts";
import { configureRoutingPorts } from "../../../src/routing/ports.ts";
import { backgroundRuntime } from "../../../src/background/runtime.ts";
import { rebuildMenus } from "../../../src/background/menu-rebuild.ts";

const menu = {
  ...menuBuild,
  ...menuTabs,
  ...menuTree,
  addPaths: (paths: string[], contexts: MenuContext[]) =>
    menuBuild.renderPathTree(menuTree.buildTree(paths), contexts),
  IDS: menuBuild.MENU_IDS,
  pathMappings: menuBuild.menuState.pathMappings,
};

describe("menu parsing", () => {
  const metadataFor = (comment: string) => menu.parsePath(`path // ${comment}`).meta;

  test("parses comments for metadata", () => {
    const input = "(alias: doggo is (cute!)) cats (foo:bar)";
    const actual = metadataFor(input);

    const expected = {
      alias: "doggo is (cute!)",
      foo: "bar",
    };
    expect(actual).toEqual(expected);
  });

  test("parses path for comments", () => {
    const input = "> i/foo/bar // comment (alias: baz)";
    const actual = menu.parsePath(input);

    const expected = {
      raw: input,
      comment: "comment (alias: baz)",
      depth: 1,
      meta: {
        alias: "baz",
      },
      parsedDir: "i/foo/bar",
      validation: {
        valid: true,
      },
    };

    expect(actual).toEqual(expected);
  });

  test("returns empty metadata when there are no key-value pairs", () => {
    expect(metadataFor("plain comment (not a pair)")).toEqual({});
    expect(metadataFor("")).toEqual({});
  });

  test("preserves colons inside metadata values", () => {
    expect(metadataFor("(alias: Work: 2026)")).toEqual({ alias: "Work: 2026" });
  });

  test("ignores ordinary parentheses before metadata", () => {
    expect(metadataFor("photo (edited) (alias: Work) (key: w)")).toEqual({
      alias: "Work",
      key: "w",
    });
  });

  test("parsePath preserves additional comment delimiters", () => {
    const parsed = menu.parsePath("images // (alias: https://example.test/gallery)");

    expect(parsed.comment).toBe("(alias: https://example.test/gallery)");
    expect(parsed.meta).toEqual({ alias: "https://example.test/gallery" });
  });

  test("parsePath counts depth arrows", () => {
    expect(menu.parsePath("a").depth).toBe(0);
    expect(menu.parsePath(">>> deep/dir").depth).toBe(3);
    expect(menu.parsePath(">>> deep/dir").parsedDir).toBe("deep/dir");
  });

  test("parsePath flags invalid paths", () => {
    expect(menu.parsePath("<invalid>").validation.valid).toBe(false);
    expect(menu.parsePath("/absolute").validation.valid).toBe(false);
  });

  test("disabled menu entries suppress their nested subtree", () => {
    const tree = menu.buildTree(["photos // (disabled: true)", ">private", "documents"]);

    expect(tree.errors).toEqual([]);
    expect(tree.items).toHaveLength(1);
    expect(tree.items[0]).toMatchObject({ kind: "path", parsedDir: "documents" });
  });

  test("carries per-destination Save As metadata into the menu tree", () => {
    const tree = menu.buildTree(["photos // (alias: Photos) (dialog: true)"]);

    expect(tree.errors).toEqual([]);
    expect(tree.items[0]).toMatchObject({
      kind: "path",
      title: "Photos",
      prompt: true,
    });
  });
});

const setupMenuCreationMocks = () => {
  configureRoutingPorts({
    getMessage: (key) => global.browser.i18n.getMessage(key),
    recordRuleErrors: (errors) => backgroundRuntime.optionErrors.filenamePatterns.push(...errors),
  });
  detector.features = { tabContextMenus: true };
  Object.assign(options, {
    keyRoot: "q",
    keyLastUsed: "a",
    enableNumberedItems: false,
    tabEnabled: true,
    routeExclusive: false,
    routeHideFolderChoices: false,
    routeSkipUnmatched: false,
    links: true,
    selection: true,
    page: true,
    enableLastLocation: true,
    paths: ".",
  });
  (global.browser as any).contextMenus = {
    create: vi.fn(),
    update: vi.fn(),
    removeAll: vi.fn(() => Promise.resolve()),
    onClicked: { addListener: vi.fn() },
  };
  menu.clearPathMappings();
  backgroundRuntime.optionErrors = { paths: [], filenamePatterns: [] };
};

describe("menu creation", () => {
  beforeEach(() => {
    setupMenuCreationMocks();
  });

  const created = (): Array<Record<string, any>> =>
    (global.browser.contextMenus.create as any).mock.calls.map(
      ([props]: [Record<string, any>]) => props,
    );

  describe("makeSeparator", () => {
    test("creates separators with explicit ids under the given parent", () => {
      menu.makeSeparator(["link"], "first-separator");
      menu.makeSeparator(["link"], "second-separator", "custom-parent");

      const first = created()[0]!;
      const second = created()[1]!;
      expect(first).toMatchObject({
        type: "separator",
        contexts: ["link"],
        parentId: menu.IDS.ROOT,
      });
      expect(second.parentId).toBe("custom-parent");
      expect(first.id).toBe("first-separator");
      expect(second.id).toBe("second-separator");
    });
  });

  describe("setAccesskey", () => {
    test("marks the key in place when the title contains it", () => {
      expect(menu.setAccesskey("cats", "c")).toBe("&cats");
    });

    test("appends the key when the title does not contain it", () => {
      expect(menu.setAccesskey("cats", "x")).toBe("cats (&x)");
    });

    test("prefers the override key", () => {
      expect(menu.setAccesskey("cats", "x", "a")).toBe("c&ats");
    });

    test("leaves the title unchanged when the configured key is empty", () => {
      expect(menu.setAccesskey("cats", "")).toBe("cats");
      expect(menu.setAccesskey("cats", "1", "")).toBe("cats");
    });

    test("uses only single-character access keys", () => {
      expect(menu.setAccesskey("cats", 10)).toBe("cats");
      expect(menu.setAccesskey("cats", "ab")).toBe("cats");
    });

    test("escapes literal ampersands before adding an access key", () => {
      expect(menu.setAccesskey("Cats & Dogs", "d")).toBe("Cats && &Dogs");
      expect(menu.setAccesskey("Cats & Dogs", "x")).toBe("Cats && Dogs (&x)");
    });

    test("matches access keys without changing title case", () => {
      expect(menu.setAccesskey("Cats", "c")).toBe("&Cats");
    });

    // "İ" (U+0130) is the only character in Unicode whose lowercase is longer
    // than itself (i + U+0307), so an offset taken from a lowercased copy runs
    // one unit ahead of the original for every "İ" before the match. Both of
    // these reach the menu on the shipped default keyLastUsed of "e".
    test("locates access keys past a character that lowercases to two units", () => {
      expect(menu.setAccesskey("İzmir Belediyesi", "e")).toBe("İzmir B&elediyesi");
    });

    // Marking the last character overran the string entirely, leaving a lone
    // trailing "&": markup flagging nothing, so the key is lost and the "&"
    // is eaten.
    test("marks a trailing access key instead of dangling an ampersand", () => {
      expect(menu.setAccesskey("İndirme", "e")).toBe("İndirm&e");
    });
  });

  describe("static menu items", () => {
    test("addRoot creates the root item with the root access key", () => {
      menu.addRoot(["link"]);
      menu.addRoot([]);

      const root = created()[0]!;
      expect(root.id).toBe(menu.IDS.ROOT);
      expect(root.contexts).toEqual(["link"]);
      expect(root.title).toContain("(&q)");
      expect(created()[1]!.contexts).toEqual(["all"]);
    });

    test("addRouteExclusive creates the routing item under the root", () => {
      menu.addRouteExclusive(["link"]);

      const item = created()[0]!;
      expect(item.id).toBe(menu.IDS.ROUTE_EXCLUSIVE);
      expect(item.contexts).toEqual(["link"]);
      expect(item.parentId).toBe(menu.IDS.ROOT);
    });

    test("addQuickSave creates the quick save item under the root", () => {
      menu.addQuickSave(["image", "link"]);

      const item = created()[0]!;
      expect(item.id).toBe(menu.IDS.QUICK_SAVE);
      expect(item.parentId).toBe(menu.IDS.ROOT);
      expect(item.contexts).toEqual(["image", "link"]);
      expect(item.title).toContain("Translated<contextMenuQuickSave>");
    });

    test("addQuickSave falls back to an English title when localization is empty", () => {
      vi.mocked(global.browser.i18n.getMessage).mockReturnValueOnce("");
      menu.addQuickSave(["image"]);
      expect(created()[0]!.title).toBe("Quick save");
    });

    // Standing alone, it is the only thing naming the extension in the menu, so
    // it takes the root item's title and access key instead of its own.
    test("addQuickSave standing alone names the extension and has no parent", () => {
      menu.addQuickSave(["image"], { topLevel: true });

      const item = created()[0]!;
      expect(item.parentId).toBeUndefined();
      expect(item.title).toContain("QuickSaveOnly");
      // The "&" is the root access key, which only a standing-alone item takes.
      expect(item.title).toContain("&");
    });

    test("addQuickSave standing alone falls back to an English title that names the extension", () => {
      vi.mocked(global.browser.i18n.getMessage).mockReturnValueOnce("");
      menu.addQuickSave(["image"], { topLevel: true });
      expect(created()[0]!.title).toContain("Quick save (Save In)");
    });

    test("quickSaveDirectoryConfigured reports only a valid non-root directory", () => {
      options.quickSaveDirectory = "Photos";
      expect(menu.quickSaveDirectoryConfigured()).toBe(true);
      options.quickSaveDirectory = "  Photos  ";
      expect(menu.quickSaveDirectoryConfigured()).toBe(true);
      options.quickSaveDirectory = ".";
      expect(menu.quickSaveDirectoryConfigured()).toBe(false);
      options.quickSaveDirectory = "   ";
      expect(menu.quickSaveDirectoryConfigured()).toBe(false);
      options.quickSaveDirectory = "../escape";
      expect(menu.quickSaveDirectoryConfigured()).toBe(false);
    });

    test("addQuickSaveToDirectory creates a checkbox reflecting the toggle", () => {
      options.quickSaveDirectory = "Photos";
      options.quickSaveUseDirectory = true;
      menu.addQuickSaveToDirectory(["image"]);

      const item = created()[0]!;
      expect(item.id).toBe(menu.IDS.QUICK_SAVE_TO_DIRECTORY);
      expect(item.type).toBe("checkbox");
      expect(item.checked).toBe(true);
      expect(item.parentId).toBe(menu.IDS.ROOT);
    });

    test("addQuickSaveToDirectory falls back to an English title when localization is empty", () => {
      options.quickSaveDirectory = "Photos";
      options.quickSaveUseDirectory = false;
      vi.mocked(global.browser.i18n.getMessage).mockReturnValueOnce("");
      menu.addQuickSaveToDirectory(["image"]);
      const item = created()[0]!;
      expect(item.title).toBe("Save to Photos");
      expect(item.checked).toBe(false);
    });

    // A menu title is access-key markup: a lone "&" flags the next character
    // and is eaten, so a literal one in a user-configured folder name has to be
    // doubled. Every other user-controlled title escapes for this reason.
    test("addQuickSaveToDirectory escapes ampersands in the configured directory", () => {
      options.quickSaveDirectory = "Rock & Roll";
      options.quickSaveUseDirectory = true;
      vi.mocked(global.browser.i18n.getMessage).mockReturnValueOnce("");
      menu.addQuickSaveToDirectory(["image"]);
      expect(created()[0]!.title).toBe("Save to Rock && Roll");
    });

    test("addQuickSaveToDirectory escapes an ampersand a localization substituted in", () => {
      options.quickSaveDirectory = "Rock & Roll";
      options.quickSaveUseDirectory = true;
      vi.mocked(global.browser.i18n.getMessage).mockReturnValueOnce("Save to Rock & Roll");
      menu.addQuickSaveToDirectory(["image"]);
      expect(created()[0]!.title).toBe("Save to Rock && Roll");
    });

    test("setQuickSaveUseDirectory updates the bag and persists to storage.local", async () => {
      options.quickSaveUseDirectory = false;
      await menu.setQuickSaveUseDirectory(true);
      expect(options.quickSaveUseDirectory).toBe(true);
      expect(global.browser.storage.local.set).toHaveBeenCalledWith({
        quickSaveUseDirectory: true,
      });
    });

    test("setQuickSaveUseDirectory swallows a storage rejection", async () => {
      vi.mocked(global.browser.storage.local.set).mockRejectedValueOnce(new Error("quota"));
      await expect(menu.setQuickSaveUseDirectory(false)).resolves.toBeUndefined();
      expect(options.quickSaveUseDirectory).toBe(false);
    });

    test("addSelectionType describes media+link, selection and page contexts", () => {
      menu.addSelectionType(["link", "selection", "page"]);

      const ids = created().map((c) => c.id);
      expect(ids).toEqual([
        "download-context-media-link",
        "download-context-selection",
        "download-context-page",
      ]);
      expect(created()[0]!.contexts).toEqual([...MEDIA_TYPES, "link"]);
      expect(created().every((c) => c.enabled === false)).toBe(true);
    });

    test("addSelectionType describes media-only contexts when links are disabled", () => {
      menu.addSelectionType(MEDIA_TYPES);

      const ids = created().map((c) => c.id);
      expect(ids).toEqual(["download-context-media"]);
      expect(created()[0]!.contexts).toEqual(MEDIA_TYPES);
    });

    test("addOptions and addShowDefaultFolder create items under the root", () => {
      menu.addOptions(["link"]);
      menu.addShowDefaultFolder(["link"]);

      const optionsItem = created()[0]!;
      const defaultFolder = created()[1]!;
      expect(optionsItem).toMatchObject({ id: "options", parentId: "save-in-root" });
      expect(defaultFolder).toMatchObject({
        id: "show-default-folder",
        parentId: menu.IDS.ROOT,
      });
    });
  });

  describe("addLastUsed", () => {
    test("invokes the event-page matchMedia method with its host receiver", () => {
      const original = Reflect.get(globalThis, "matchMedia");
      const matchMedia = vi.fn(function (this: typeof globalThis) {
        if (this !== globalThis) throw new TypeError("Illegal invocation");
        return { matches: true };
      });
      Reflect.set(globalThis, "matchMedia", matchMedia);

      try {
        menu.addLastUsed(["link"]);
      } finally {
        if (original === undefined) Reflect.deleteProperty(globalThis, "matchMedia");
        else Reflect.set(globalThis, "matchMedia", original);
      }

      expect(matchMedia).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
      expect(created()[0]!.icons).toEqual({ 16: "icons/ic_update_white_24px.svg" });
    });

    test("creates a disabled placeholder with icons when nothing was used yet", () => {
      menu.addLastUsed(["link"]);

      expect(created()).toHaveLength(1);
      const item = created()[0]!;
      expect(item).toMatchObject({
        id: menu.IDS.LAST_USED,
        enabled: false,
        parentId: menu.IDS.ROOT,
      });
      // keyLastUsed "a" is marked in place within the translated title
      expect(item.title).toBe("Tr&anslated<contextMenuLastUsed>");
      expect(item.icons).toEqual({ 16: "icons/ic_update_black_24px.svg" });
    });

    test("falls back to an icon-less item on browsers that crash on icons", () => {
      vi.mocked(global.browser.contextMenus.create).mockImplementationOnce(() => {
        throw new Error("icons not supported");
      });

      menu.addLastUsed(["link"]);

      expect(created()).toHaveLength(2);
      expect(created()[0]!.icons).toBeDefined();
      expect(created()[1]!.icons).toBeUndefined();
      expect(created()[1]!.id).toBe(menu.IDS.LAST_USED);
    });

    test("restores an aliased last-used title after persistence", async () => {
      await menu.setLastUsed("dir1", {
        comment: "0(alias: Friendly folder)",
        menuIndex: "1",
        title: "Friendly folder",
      });
      expect(global.browser.storage.local.set).toHaveBeenCalledWith({
        lastUsedPath: "dir1",
        lastUsedMeta: {
          comment: "0(alias: Friendly folder)",
          menuIndex: "1",
          title: "Friendly folder",
        },
      });
      menu.restoreLastUsed({
        lastUsedPath: "dir1",
        lastUsedMeta: {
          comment: "0(alias: Friendly folder)",
          menuIndex: "1",
          title: "Friendly folder",
        },
      });

      menu.addLastUsed(["link"]);

      expect(created().at(-1)).toMatchObject({
        id: menu.IDS.LAST_USED,
        title: "Friendly folder (&a)",
        enabled: true,
      });
    });

    test("retains last-used state when persistence is temporarily unavailable", async () => {
      vi.mocked(global.browser.storage.local.set).mockRejectedValueOnce(new Error("quota"));

      await expect(
        menu.setLastUsed("offline", { title: "Offline folder" }),
      ).resolves.toBeUndefined();

      expect(menu.menuState.lastUsedPath).toBe("offline");
      expect(menu.menuState.lastUsedMeta).toEqual({ title: "Offline folder" });
    });
  });

  test("uses readable source-panel copy when localization is unavailable", () => {
    vi.mocked(global.browser.i18n.getMessage).mockReturnValueOnce("");

    menu.addSourcePanel(["page"]);

    expect(created().at(-1)?.title).toBe("Toggle Page Sources");
  });

  describe("addPaths", () => {
    test("creates top-level separators between path sections", () => {
      menu.addPaths(["a", SPECIAL_DIRS.SEPARATOR, "b"], ["link"]);

      const separator = created()[1]!;
      expect(separator).toMatchObject({ type: "separator", parentId: menu.IDS.ROOT });
      expect(created()[0]).toMatchObject({ id: "save-in-0", title: "a" });
      expect(created()[2]).toMatchObject({ id: "save-in-2", title: "b" });
    });

    test("creates nested separators between children under the current parent", () => {
      menu.addPaths(["a", ">b", ">---", ">c"], ["link"]);

      const item = created()[0]!;
      const separator = created()[2]!;
      expect(item.id).toBe("save-in-0");
      expect(separator).toMatchObject({ type: "separator", parentId: "save-in-0" });
    });

    test("reports invalid paths to the options page instead of creating them", () => {
      menu.addPaths(["<invalid>"], ["link"]);

      expect(global.browser.contextMenus.create).not.toHaveBeenCalled();
      expect(menu.pathMappings).toEqual({});
      expect(backgroundRuntime.optionErrors.paths).toEqual([
        {
          sourceIndex: 0,
          message: "Translated<rulePathInvalidCharacter>",
          error: "<invalid>",
          parentId: menu.IDS.ROOT,
        },
      ]);
    });

    test("uses the alias as the menu title", () => {
      menu.addPaths(["dogs/corgi // (alias: Nice Name)"], ["link"]);

      expect(created()[0]!.title).toBe("Nice Name");
      expect(menu.pathMappings["save-in-0"]).toMatchObject({
        parsedDir: "dogs/corgi",
        title: "Nice Name",
      });
    });

    test("keeps the comment (with dash munging) and menu index for routing", () => {
      menu.addPaths(["a // some-comment-x"], ["link"]);

      expect(menu.pathMappings["save-in-0"]!.comment).toBe("0some_comment_x");
      expect(menu.pathMappings["save-in-0"]!.menuIndex).toBe("1");
    });

    test("carries a per-item tab action into the path mapping, omitting it otherwise", () => {
      menu.addPaths(["a // (tab: close)", "b"], ["link"]);

      expect(menu.pathMappings["save-in-0"]!.tabAction).toBe("close");
      expect(Object.hasOwn(menu.pathMappings["save-in-1"]!, "tabAction")).toBe(false);
    });

    test("nests items by depth arrows: deeper, back out, and back to root", () => {
      menu.addPaths(["a", ">b", ">>c", ">d", "e"], ["link"]);

      expect(created().map((c) => c.parentId)).toEqual([
        menu.IDS.ROOT,
        "save-in-0",
        "save-in-1",
        "save-in-0",
        menu.IDS.ROOT,
      ]);

      const menuIndexes = Object.values(menu.pathMappings).map((m: any) => m.menuIndex);
      expect(menuIndexes).toEqual(["1", "1.1", "1.1.1", "1.2", "2"]);
    });

    test("attaches to the deepest open menu when a level is skipped", () => {
      menu.addPaths(["a", ">>b"], ["link"]);

      expect(created().map((c) => c.parentId)).toEqual([menu.IDS.ROOT, "save-in-0"]);
      expect(menu.pathMappings["save-in-1"]).toMatchObject({
        menuIndex: "1.1",
      });
    });

    test("numbers items with consistent access-key titles when enabled", () => {
      options.enableNumberedItems = true;

      menu.addPaths(["dogs", "cats"], ["link"]);

      expect(created().map((c) => c.title)).toEqual(["dogs (&1)", "cats (&2)"]);
    });

    test("does not reuse the first mnemonic for item ten", () => {
      options.enableNumberedItems = true;

      menu.addPaths(
        Array.from({ length: 10 }, (_, index) => `path-${index + 1}`),
        ["link"],
      );

      expect(created()[9]!.title).toBe("path-10");
    });

    test("meta key overrides the numbered access key", () => {
      options.enableNumberedItems = true;

      menu.addPaths(["dogs // (key: g)"], ["link"]);

      expect(created()[0]!.title).toBe("do&gs");
    });

    test("plain titles when enableNumberedItems is off", () => {
      options.enableNumberedItems = false;

      menu.addPaths(["dogs"], ["link"]);

      expect(created()[0]!.title).toBe("dogs");
    });

    test("escapes ampersands in aliases when numbered access keys are off", () => {
      options.enableNumberedItems = false;

      menu.addPaths(["dogs // (alias: Cats & Dogs)"], ["link"]);

      expect(created()[0]!.title).toBe("Cats && Dogs");
    });

    test("drops stale mappings without retaining parallel title state", () => {
      menu.addPaths(["dogs", "cats"], ["link"]);
      menu.clearPathMappings();
      menu.addPaths(["birds"], ["link"]);

      expect(menu.pathMappings).toEqual({
        "save-in-0": {
          parsedDir: "birds",
          comment: "0",
          menuIndex: "1",
          title: "birds",
        },
      });
      expect("titles" in menuBuild.menuState).toBe(false);
    });
  });

  describe("rebuildMenus", () => {
    test("clears stale path mappings when switching to route-exclusive mode", async () => {
      menu.addPaths(["old/path"], ["link"]);
      expect(menu.pathMappings["save-in-0"]?.parsedDir).toBe("old/path");
      vi.mocked(global.browser.contextMenus.create).mockClear();
      options.routeHideFolderChoices = true;

      await rebuildMenus();

      expect(global.browser.contextMenus.removeAll).toHaveBeenCalledOnce();
      expect(menu.pathMappings).toEqual({});
      expect(created().map((item) => item.id)).toContain(menu.IDS.ROUTE_EXCLUSIVE);
      expect(created().map((item) => item.id)).toContain(menu.IDS.ROOT);
      expect(created().map((item) => item.id)).toContain(menu.IDS.TOGGLE_SOURCE_PANEL);
    });

    test("adds quick save items only when enabled, with the toggle gated on a folder", async () => {
      options.quickSaveEnabled = false;
      await rebuildMenus();
      expect(created().map((item) => item.id)).not.toContain(menu.IDS.QUICK_SAVE);

      vi.mocked(global.browser.contextMenus.create).mockClear();
      options.quickSaveEnabled = true;
      options.quickSaveDirectory = ".";
      await rebuildMenus();
      let ids = created().map((item) => item.id);
      expect(ids).toContain(menu.IDS.QUICK_SAVE);
      expect(ids).not.toContain(menu.IDS.QUICK_SAVE_TO_DIRECTORY);

      vi.mocked(global.browser.contextMenus.create).mockClear();
      options.quickSaveDirectory = "Photos";
      await rebuildMenus();
      ids = created().map((item) => item.id);
      expect(ids).toContain(menu.IDS.QUICK_SAVE);
      expect(ids).toContain(menu.IDS.QUICK_SAVE_TO_DIRECTORY);

      options.quickSaveEnabled = false;
      options.quickSaveDirectory = ".";
    });

    test("offers quick save alone, with no root, in quick-save-only mode (#144)", async () => {
      options.quickSaveEnabled = true;
      options.quickSaveOnly = true;
      options.quickSaveDirectory = "Photos";
      vi.mocked(global.browser.contextMenus.create).mockClear();

      await rebuildMenus();

      // The whole point is one page-context item: browsers rebuild the submenu
      // the moment there are two, so a count is the assertion, not a detail.
      const pageItems = created().filter((item) => !item.contexts?.includes("tab"));
      expect(pageItems).toHaveLength(1);
      expect(pageItems[0]!.id).toBe(menu.IDS.QUICK_SAVE);
      expect(pageItems[0]!.parentId).toBeUndefined();
      // Its own directory toggle would be a second item, so it cannot ship here
      // even though a folder is configured.
      expect(pageItems[0]!.id).not.toBe(menu.IDS.QUICK_SAVE_TO_DIRECTORY);

      options.quickSaveOnly = false;
      options.quickSaveEnabled = false;
      options.quickSaveDirectory = ".";
    });

    test("keeps the root submenu when quick-save-only is off or quick save is disabled", async () => {
      options.quickSaveEnabled = true;
      options.quickSaveOnly = false;
      vi.mocked(global.browser.contextMenus.create).mockClear();
      await rebuildMenus();
      expect(created().map((item) => item.id)).toContain(menu.IDS.ROOT);

      // quickSaveOnly alone must not strip the menu: without quick save there
      // would be nothing left to click.
      options.quickSaveEnabled = false;
      options.quickSaveOnly = true;
      vi.mocked(global.browser.contextMenus.create).mockClear();
      await rebuildMenus();
      const ids = created().map((item) => item.id);
      expect(ids).toContain(menu.IDS.ROOT);
      expect(ids).not.toContain(menu.IDS.QUICK_SAVE);

      options.quickSaveOnly = false;
    });

    test("uses deterministic separator ids for every rebuild", async () => {
      await rebuildMenus();
      const firstIds = created()
        .filter((item) => item.type === "separator")
        .map((item) => item.id);
      vi.mocked(global.browser.contextMenus.create).mockClear();

      await rebuildMenus();
      const secondIds = created()
        .filter((item) => item.type === "separator")
        .map((item) => item.id);

      expect(firstIds).toEqual(["save-in-separator-last-used", "save-in-separator-actions"]);
      expect(secondIds).toEqual(firstIds);
    });

    test("serializes overlapping menu rebuilds", async () => {
      let releaseFirst!: () => void;
      const firstRemoval = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      vi.mocked(global.browser.contextMenus.removeAll)
        .mockReturnValueOnce(firstRemoval)
        .mockResolvedValueOnce(undefined);

      const first = rebuildMenus();
      const second = rebuildMenus();
      await vi.waitFor(() => expect(global.browser.contextMenus.removeAll).toHaveBeenCalledOnce());

      releaseFirst();
      await first;
      await second;

      expect(global.browser.contextMenus.removeAll).toHaveBeenCalledTimes(2);
    });

    test("runs a queued rebuild even when the in-flight rebuild fails", async () => {
      let rejectFirst!: (error: Error) => void;
      const firstRemoval = new Promise<void>((_resolve, reject) => {
        rejectFirst = reject;
      });
      vi.mocked(global.browser.contextMenus.removeAll)
        .mockReturnValueOnce(firstRemoval)
        .mockResolvedValueOnce(undefined);

      const first = rebuildMenus();
      const second = rebuildMenus();
      await vi.waitFor(() => expect(global.browser.contextMenus.removeAll).toHaveBeenCalledOnce());

      rejectFirst(new Error("menu host unavailable"));
      await expect(first).resolves.toBeUndefined();
      await expect(second).resolves.toBeUndefined();

      expect(global.browser.contextMenus.removeAll).toHaveBeenCalledTimes(2);
    });

    test("continues the rebuild queue after a failed generation", async () => {
      vi.mocked(global.browser.contextMenus.removeAll)
        .mockRejectedValueOnce(new Error("menu host unavailable"))
        .mockResolvedValueOnce(undefined);

      await expect(rebuildMenus()).rejects.toThrow("menu host unavailable");
      await expect(rebuildMenus()).resolves.toBeUndefined();

      expect(global.browser.contextMenus.removeAll).toHaveBeenCalledTimes(2);
    });
  });

  describe("addTabMenus", () => {
    test("creates nothing when tab menus are disabled", () => {
      options.tabEnabled = false;

      menu.addTabMenus();

      expect(global.browser.contextMenus.create).not.toHaveBeenCalled();
    });

    test("creates the full tabstrip set on tabContextMenus-capable browsers", () => {
      menu.addTabMenus();

      const ids = created().map((c) => c.id);
      expect(ids).toEqual([
        menu.IDS.TABSTRIP.SELECTED_TAB,
        menu.IDS.TABSTRIP.SELECTED_MULTIPLE_TABS,
        menu.IDS.TABSTRIP.OPENED_FROM_TAB,
        menu.IDS.TABSTRIP.TO_RIGHT,
        menu.IDS.TABSTRIP.TO_RIGHT_MATCH,
      ]);
      expect(created().every((item) => item.contexts[0] === "tab")).toBe(true);
    });

    test("creates no tab items when tabContextMenus is unsupported", () => {
      detector.features.tabContextMenus = false;

      menu.addTabMenus();

      expect(created()).toHaveLength(0);
    });
  });

  describe("addTabHighlightListener", () => {
    let highlightListener: (info: { tabIds: number[] }) => void | Promise<void>;

    beforeEach(() => {
      (global.browser as any).tabs = { onHighlighted: { addListener: vi.fn() } };
      menu.addTabHighlightListener();
      [[highlightListener]] = (global.browser.tabs.onHighlighted.addListener as any).mock.calls;
    });

    test("updates the multi-select item title with the highlighted count", () => {
      highlightListener({ tabIds: [4, 8] });

      expect(global.browser.contextMenus.update).toHaveBeenCalledWith(
        menu.IDS.TABSTRIP.SELECTED_MULTIPLE_TABS,
        {
          title: "Translated<tabstripMenuMultipleSelectedTab>",
          contexts: ["tab"],
        },
      );
      expect(global.browser.i18n.getMessage).toHaveBeenCalledWith(
        "tabstripMenuMultipleSelectedTab",
        [2],
      );
    });

    test("waits for cold-start initialization before reading tab settings", async () => {
      let finish!: () => void;
      backgroundRuntime.ready = new Promise<void>((resolve) => {
        finish = resolve;
      });
      options.tabEnabled = false;

      const pending = highlightListener({ tabIds: [4, 8] });
      options.tabEnabled = true;
      expect(global.browser.contextMenus.update).not.toHaveBeenCalled();

      finish();
      await pending;
      expect(global.browser.contextMenus.update).toHaveBeenCalledTimes(1);
    });

    test("contains failed initialization and menu-title updates", async () => {
      backgroundRuntime.ready = Promise.reject(new Error("startup failed"));
      vi.mocked(global.browser.contextMenus.update).mockRejectedValueOnce(new Error("menu gone"));

      await highlightListener({ tabIds: [4, 8] });
      expect(global.browser.contextMenus.update).not.toHaveBeenCalled();

      backgroundRuntime.ready = Promise.resolve();
      await highlightListener({ tabIds: [4, 8] });
      expect(global.browser.contextMenus.update).toHaveBeenCalledOnce();
    });

    test("does nothing when tab menus are disabled", () => {
      options.tabEnabled = false;

      highlightListener({ tabIds: [4, 8] });

      expect(global.browser.contextMenus.update).not.toHaveBeenCalled();
    });

    test("does nothing on browsers without tabContextMenus support", () => {
      detector.features.tabContextMenus = false;

      highlightListener({ tabIds: [4, 8] });

      expect(global.browser.contextMenus.update).not.toHaveBeenCalled();
    });

    test("does nothing before feature detection has run", () => {
      detector.features = undefined;

      highlightListener({ tabIds: [4, 8] });

      expect(global.browser.contextMenus.update).not.toHaveBeenCalled();
    });
  });
});

describe("buildTree", () => {
  beforeEach(() => {
    configureRoutingPorts({ getMessage: (key) => global.browser.i18n.getMessage(key) });
  });
  test("is pure: computes the tree without any browser calls", () => {
    (global.browser as any).contextMenus = { create: vi.fn() };

    const { items, errors } = menu.buildTree(["a", ">b"]);

    expect(global.browser.contextMenus.create).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
    expect(items).toEqual([
      {
        kind: "path",
        sourceIndex: 0,
        id: "save-in-0",
        title: "a",
        number: 1,
        accessKeyOverride: undefined,
        parsedDir: "a",
        comment: "0",
        menuIndex: "1",
        parentId: menu.IDS.ROOT,
        raw: "a",
      },
      {
        kind: "path",
        sourceIndex: 1,
        id: "save-in-1",
        title: "b",
        number: 1,
        accessKeyOverride: undefined,
        parsedDir: "b",
        comment: "1",
        menuIndex: "1.1",
        parentId: "save-in-0",
        raw: ">b",
      },
    ]);
  });

  test("emits separator items between paths at the top level and nested", () => {
    const { items } = menu.buildTree(["a", ">b", ">---", ">c", "---", "d"]);

    expect(items.map((i) => i.kind)).toEqual([
      "path",
      "path",
      "separator",
      "path",
      "separator",
      "path",
    ]);
    expect(items[2]!.parentId).toBe("save-in-0");
    expect(items[4]!.parentId).toBe(menu.IDS.ROOT);
  });

  test("does not count separators as visible numbered positions", () => {
    const { items } = menu.buildTree(["a", ">b", ">---", ">c"]);
    const paths = items.filter((item) => item.kind === "path");

    expect(paths.map((item) => ({ number: item.number, menuIndex: item.menuIndex }))).toEqual([
      { number: 1, menuIndex: "1" },
      { number: 1, menuIndex: "1.1" },
      { number: 2, menuIndex: "1.2" },
    ]);

    const afterRemovedSeparator = menu
      .buildTree([">---", "first"])
      .items.find((item) => item.kind === "path")!;
    expect(afterRemovedSeparator).toMatchObject({ number: 1, menuIndex: "1" });
  });

  test("closes stale branches at separator and invalid rows", () => {
    const separated = menu.buildTree(["a", ">b", ">---", ">>c"]);
    const separatedC = separated.items.find((item) => item.sourceIndex === 3)!;
    expect(separated.items.map((item) => item.kind)).toEqual(["path", "path", "separator", "path"]);
    expect(separatedC).toMatchObject({ parentId: "save-in-0", menuIndex: "1.2" });

    const invalid = menu.buildTree(["a", ">b", "><bad>", ">>c"]);
    const invalidC = invalid.items.find((item) => item.sourceIndex === 3)!;
    expect(invalidC).toMatchObject({ parentId: "save-in-0", menuIndex: "1.2" });
  });

  test("closes the previous submenu at a root separator", () => {
    const { items } = menu.buildTree(["a", ">b", "---", ">c"]);
    const c = items.find((item) => item.sourceIndex === 3)!;

    expect(c).toMatchObject({ parentId: menu.IDS.ROOT, menuIndex: "2" });
  });

  test("removes leading, trailing, consecutive, and separator-only sections", () => {
    const { items } = menu.buildTree(["---", "a", "---", "---", "b", "---"]);

    expect(items.map((item) => item.sourceIndex)).toEqual([1, 2, 4]);
    expect(menu.buildTree(["---", "---"]).items).toEqual([]);
  });

  test("collects invalid paths as errors instead of items", () => {
    const { items, errors } = menu.buildTree(["<invalid>", "ok"]);

    expect(items).toHaveLength(1);
    expect("parsedDir" in items[0]! && items[0]!.parsedDir).toBe("ok");
    expect(errors).toEqual([
      {
        sourceIndex: 0,
        message: "Translated<rulePathInvalidCharacter>",
        error: "<invalid>",
        parentId: menu.IDS.ROOT,
      },
    ]);
  });

  test("reports the exact range of an unknown path variable", () => {
    expect(menu.buildTree(["docs/:year:/:modnthname:"]).errors).toEqual([
      {
        sourceIndex: 0,
        message: "Translated<ruleUnknownDestinationVariable>",
        error: ":modnthname:",
        sourceRange: { start: 12, end: 24 },
        parentId: menu.IDS.ROOT,
      },
    ]);
  });

  test("reports a syntactically missing nested path", () => {
    expect(menu.buildTree([">"]).errors).toEqual([
      expect.objectContaining({ error: ">", message: "Invalid path" }),
    ]);
  });

  test("merges valid items and errors in source order for previews", () => {
    const tree = menu.buildTree(["first", "<invalid>", "second"]);

    expect(menuTree.getMenuTreeEntries(tree).map((entry) => entry.sourceIndex)).toEqual([0, 1, 2]);
  });

  test("carries alias titles and access key overrides", () => {
    const { items } = menu.buildTree(["dogs/corgi // (alias: Nice Name) (key: g)"]);

    expect("title" in items[0]! && items[0]!.title).toBe("Nice Name");
    expect("accessKeyOverride" in items[0]! && items[0]!.accessKeyOverride).toBe("g");
  });

  test("carries an opt-in post-save tab action from metadata", () => {
    const close = menu.buildTree(["dogs // (tab: close)"]).items[0]!;
    const back = menu.buildTree(["dogs // (tab: return)"]).items[0]!;
    const plain = menu.buildTree(["dogs"]).items[0]!;

    expect("tabAction" in close && close.tabAction).toBe("close");
    expect("tabAction" in back && back.tabAction).toBe("return");
    expect(Object.hasOwn(plain, "tabAction")).toBe(false);
  });

  test("numbers items per depth for menuIndex routing", () => {
    const { items } = menu.buildTree(["a", ">b", ">>c", ">d", "e"]);

    expect(items.map((i) => ("menuIndex" in i ? i.menuIndex : undefined))).toEqual([
      "1",
      "1.1",
      "1.1.1",
      "1.2",
      "2",
    ]);
    expect(items.map((i) => i.parentId)).toEqual([
      menu.IDS.ROOT,
      "save-in-0",
      "save-in-1",
      "save-in-0",
      menu.IDS.ROOT,
    ]);
  });
});

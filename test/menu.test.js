const menu = (await import("../src/menu.js")).default;
const constants = (await import("../src/constants.js")).default;

describe("menu parsing", () => {
  beforeAll(async () => {
    global.SPECIAL_DIRS = constants.SPECIAL_DIRS;
    global.PATH_SEGMENT_TYPES = constants.PATH_SEGMENT_TYPES;
    global.Path = (await import("../src/path.js")).default;
  });

  test("parses comments for metadata", () => {
    const input = "(alias: doggo is (cute!)) cats (foo:bar)";
    const actual = menu.parseMeta(input);

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

  test("parseMeta returns an empty object when there are no key-value pairs", () => {
    expect(menu.parseMeta("plain comment (not a pair)")).toEqual({});
    expect(menu.parseMeta("")).toEqual({});
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
});

const setupMenuCreationMocks = () => {
  global.BROWSER_FEATURES = { accessKeys: true, multitab: true };
  global.options = {
    keyRoot: "q",
    keyLastUsed: "a",
    enableNumberedItems: false,
    tabEnabled: true,
  };
  global.browser.contextMenus = {
    create: jest.fn(),
    update: jest.fn(),
    onClicked: { addListener: jest.fn() },
  };
  window.optionErrors = { paths: [], filenamePatterns: [] };
};

describe("menu creation", () => {
  beforeAll(async () => {
    Object.assign(global, constants);
    global.Path = (await import("../src/path.js")).default;
  });

  beforeEach(() => {
    setupMenuCreationMocks();
  });

  const created = () => global.browser.contextMenus.create.mock.calls.map(([props]) => props);

  describe("makeSeparator", () => {
    test("creates separators with an incrementing id under the given parent", () => {
      menu.makeSeparator(["link"]);
      menu.makeSeparator(["link"], "custom-parent");

      const [first, second] = created();
      expect(first).toMatchObject({
        type: "separator",
        contexts: ["link"],
        parentId: menu.IDS.ROOT,
      });
      expect(second.parentId).toBe("custom-parent");

      const firstN = Number(first.id.replace("separator-", ""));
      const secondN = Number(second.id.replace("separator-", ""));
      expect(secondN).toBe(firstN + 1);
    });
  });

  describe("setAccesskey", () => {
    test("passes the title through when access keys are unsupported", () => {
      global.BROWSER_FEATURES = { accessKeys: false };
      expect(menu.setAccesskey("cats", "c")).toBe("cats");
    });

    test("marks the key in place when the title contains it", () => {
      expect(menu.setAccesskey("cats", "c")).toBe("&cats");
    });

    test("appends the key when the title does not contain it", () => {
      expect(menu.setAccesskey("cats", "x")).toBe("cats (&x)");
    });

    test("prefers the override key", () => {
      expect(menu.setAccesskey("cats", "x", "a")).toBe("c&ats");
    });
  });

  describe("static menu items", () => {
    test("addRoot creates the root item with the root access key", () => {
      menu.addRoot(["link"]);

      const [root] = created();
      expect(root.id).toBe(menu.IDS.ROOT);
      expect(root.contexts).toEqual(["link"]);
      expect(root.title).toContain("(&q)");
    });

    test("addRouteExclusive creates a standalone routing item", () => {
      menu.addRouteExclusive(["link"]);

      const [item] = created();
      expect(item.id).toBe(menu.IDS.ROUTE_EXCLUSIVE);
      expect(item.contexts).toEqual(["link"]);
    });

    test("addSelectionType describes media+link, selection and page contexts", () => {
      menu.addSelectionType(["link", "selection", "page"]);

      const ids = created().map((c) => c.id);
      expect(ids).toEqual([
        "download-context-media-link",
        "download-context-selection",
        "download-context-page",
      ]);
      expect(created()[0].contexts).toEqual(global.MEDIA_TYPES.concat("link"));
      expect(created().every((c) => c.enabled === false)).toBe(true);
    });

    test("addSelectionType describes media-only contexts when links are disabled", () => {
      menu.addSelectionType(global.MEDIA_TYPES);

      const ids = created().map((c) => c.id);
      expect(ids).toEqual(["download-context-media"]);
      expect(created()[0].contexts).toEqual(global.MEDIA_TYPES);
    });

    test("addOptions and addShowDefaultFolder create items under the root", () => {
      menu.addOptions(["link"]);
      menu.addShowDefaultFolder(["link"]);

      const [optionsItem, defaultFolder] = created();
      expect(optionsItem).toMatchObject({ id: "options", parentId: "save-in-root" });
      expect(defaultFolder).toMatchObject({
        id: "show-default-folder",
        parentId: menu.IDS.ROOT,
      });
    });
  });

  describe("addLastUsed", () => {
    test("creates a disabled placeholder with icons when nothing was used yet", () => {
      menu.addLastUsed(["link"]);

      expect(created()).toHaveLength(1);
      const [item] = created();
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
      global.browser.contextMenus.create.mockImplementationOnce(() => {
        throw new Error("icons not supported");
      });

      menu.addLastUsed(["link"]);

      expect(created()).toHaveLength(2);
      expect(created()[0].icons).toBeDefined();
      expect(created()[1].icons).toBeUndefined();
      expect(created()[1].id).toBe(menu.IDS.LAST_USED);
    });
  });

  describe("addPaths", () => {
    test("creates top-level separators for ---", () => {
      menu.addPaths([SPECIAL_DIRS.SEPARATOR, "a"], ["link"]);

      const [separator, item] = created();
      expect(separator).toMatchObject({ type: "separator", parentId: menu.IDS.ROOT });
      expect(item).toMatchObject({ id: "save-in-1", title: "a", parentId: menu.IDS.ROOT });
    });

    test("creates nested separators under the current parent", () => {
      menu.addPaths(["a", ">---"], ["link"]);

      const [item, separator] = created();
      expect(item.id).toBe("save-in-0");
      expect(separator).toMatchObject({ type: "separator", parentId: "save-in-0" });
    });

    test("reports invalid paths to the options page instead of creating them", () => {
      menu.addPaths(["<invalid>"], ["link"]);

      expect(global.browser.contextMenus.create).not.toHaveBeenCalled();
      expect(menu.pathMappings).toEqual({});
      expect(window.optionErrors.paths).toEqual([
        {
          message: "Translated<rulePathInvalidCharacter>",
          error: "<invalid>",
        },
      ]);
    });

    test("uses the alias as the menu title", () => {
      menu.addPaths(["dogs/corgi // (alias: Nice Name)"], ["link"]);

      expect(created()[0].title).toBe("Nice Name");
      expect(menu.pathMappings["save-in-0"]).toMatchObject({
        parsedDir: "dogs/corgi",
        title: "Nice Name",
      });
    });

    test("keeps the comment (with dash munging) and menu index for routing", () => {
      menu.addPaths(["a // some-comment-x"], ["link"]);

      expect(menu.pathMappings["save-in-0"].comment).toBe("0some_comment_x");
      expect(menu.pathMappings["save-in-0"].menuIndex).toBe("1");
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

      const menuIndexes = Object.values(menu.pathMappings).map((m) => m.menuIndex);
      expect(menuIndexes).toEqual(["1", "1.1", "1.1.1", "1.2", "2"]);
    });

    test("attaches to the deepest open menu when a level is skipped", () => {
      menu.addPaths(["a", ">>b"], ["link"]);

      expect(created().map((c) => c.parentId)).toEqual([menu.IDS.ROOT, "save-in-0"]);
    });

    test("numbers items with access keys when enableNumberedItems is on", () => {
      global.options.enableNumberedItems = true;

      menu.addPaths(["dogs", "cats"], ["link"]);

      expect(created().map((c) => c.title)).toEqual(["dogs (&1)", "cats (&2)"]);
    });

    test("meta key overrides the numbered access key", () => {
      global.options.enableNumberedItems = true;

      menu.addPaths(["dogs // (key: g)"], ["link"]);

      expect(created()[0].title).toBe("do&gs");
    });

    test("plain titles when enableNumberedItems is off", () => {
      global.options.enableNumberedItems = false;

      menu.addPaths(["dogs"], ["link"]);

      expect(created()[0].title).toBe("dogs");
    });
  });

  describe("addTabMenus", () => {
    test("creates nothing when tab menus are disabled", () => {
      global.options.tabEnabled = false;

      menu.addTabMenus();

      expect(global.browser.contextMenus.create).not.toHaveBeenCalled();
    });

    test("creates the full tabstrip set on multitab-capable browsers", () => {
      menu.addTabMenus();

      const ids = created().map((c) => c.id);
      expect(ids).toEqual([
        menu.IDS.TABSTRIP.SELECTED_TAB,
        menu.IDS.TABSTRIP.SELECTED_MULTIPLE_TABS,
        menu.IDS.TABSTRIP.OPENED_FROM_TAB,
        menu.IDS.TABSTRIP.TO_RIGHT,
        menu.IDS.TABSTRIP.TO_RIGHT_MATCH,
      ]);
      expect(created().every((c) => c.contexts[0] === "tab")).toBe(true);
    });

    test("skips the multi-select item when multitab is unsupported", () => {
      global.BROWSER_FEATURES.multitab = false;

      menu.addTabMenus();

      const ids = created().map((c) => c.id);
      expect(ids).not.toContain(menu.IDS.TABSTRIP.SELECTED_MULTIPLE_TABS);
      expect(ids).toHaveLength(4);
    });
  });

  describe("addTabHighlightListener", () => {
    let highlightListener;

    beforeEach(() => {
      global.browser.tabs = { onHighlighted: { addListener: jest.fn() } };
      menu.addTabHighlightListener();
      [[highlightListener]] = global.browser.tabs.onHighlighted.addListener.mock.calls;
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

    test("does nothing when tab menus are disabled", () => {
      global.options.tabEnabled = false;

      highlightListener({ tabIds: [4, 8] });

      expect(global.browser.contextMenus.update).not.toHaveBeenCalled();
    });

    test("does nothing on browsers without multitab support", () => {
      global.BROWSER_FEATURES.multitab = false;

      highlightListener({ tabIds: [4, 8] });

      expect(global.browser.contextMenus.update).not.toHaveBeenCalled();
    });

    test("does nothing before feature detection has run", () => {
      global.BROWSER_FEATURES = undefined;

      highlightListener({ tabIds: [4, 8] });

      expect(global.browser.contextMenus.update).not.toHaveBeenCalled();
    });
  });
});

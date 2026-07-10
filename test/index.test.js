// Background entry point: synchronous listener registration (MV3
// requirement), async init/menu construction, and current-tab tracking.
// index.js runs entirely on import, so every test re-imports it fresh.

// Microtask flush for promise chains started at import time
const flush = async (times = 10) => {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
};

const setupGlobals = ({ options = {}, storedLocal = {}, tabsQueryResult = [] } = {}) => {
  global.MEDIA_TYPES = ["image", "video", "audio"];

  global.OptionsManagement = { loadOptions: vi.fn(() => Promise.resolve()) };
  global.Notifier = {};
  global.Log = { add: vi.fn() };
  global.Menus = {
    addDownloadListener: vi.fn(),
    addTabMenuListener: vi.fn(),
    addTabHighlightListener: vi.fn(),
    addTabMenus: vi.fn(),
    addRoot: vi.fn(),
    addRouteExclusive: vi.fn(),
    addLastUsed: vi.fn(),
    makeSeparator: vi.fn(),
    addPaths: vi.fn(),
    addSelectionType: vi.fn(),
    addShowDefaultFolder: vi.fn(),
    addOptions: vi.fn(),
    pathMappings: {},
    state: { lastUsedPath: null, lastUsedMeta: null },
    restoreLastUsed: vi.fn(),
  };

  global.options = Object.assign(
    {
      paths: ".\nimages\nimages/cute",
      links: true,
      selection: true,
      page: true,
      routeExclusive: false,
      enableLastLocation: true,
      notifyOnSuccess: true,
      notifyOnFailure: true,
      notifyDuration: 7000,
      promptOnFailure: false,
    },
    options,
  );

  global.browser.storage.local.get = vi.fn(() => Promise.resolve(storedLocal));
  global.browser.contextMenus = { removeAll: vi.fn(() => Promise.resolve()) };
  global.browser.tabs.query = vi.fn(() => Promise.resolve(tabsQueryResult));
  global.browser.tabs.get = vi.fn((id) => Promise.resolve({ id, title: `Tab ${id}` }));
  global.browser.tabs.onActivated = { addListener: vi.fn() };
  global.browser.tabs.onUpdated = { addListener: vi.fn() };

  delete global.window.ready;
  delete global.window.init;
  delete global.window.reset;
  delete global.window.optionErrors;
};

beforeEach(() => {
  jest.resetModules();
});

describe("startup", () => {
  test("registers event listeners synchronously at import (MV3 requirement)", async () => {
    setupGlobals();
    await import("../src/index.js");

    expect(global.Menus.addDownloadListener).toHaveBeenCalledTimes(1);
    expect(global.Menus.addTabMenuListener).toHaveBeenCalledTimes(1);
    expect(global.Menus.addTabHighlightListener).toHaveBeenCalledTimes(1);
    expect(global.browser.tabs.onActivated.addListener).toHaveBeenCalledTimes(1);
    expect(global.browser.tabs.onUpdated.addListener).toHaveBeenCalledTimes(1);

    expect(global.window.init).toEqual(expect.any(Function));
    expect(global.window.reset).toEqual(expect.any(Function));
    expect(global.window.ready).toEqual(expect.any(Promise));
    await global.window.ready;
  });

  test("window.reset re-runs init and replaces window.ready", async () => {
    setupGlobals();
    await import("../src/index.js");
    await global.window.ready;
    expect(global.OptionsManagement.loadOptions).toHaveBeenCalledTimes(1);

    const p = global.window.reset();
    expect(global.window.ready).toBe(p);
    await p;
    expect(global.OptionsManagement.loadOptions).toHaveBeenCalledTimes(2);
  });
});

describe("init", () => {
  test("loads options, then builds the full menu", async () => {
    setupGlobals();
    await import("../src/index.js");
    await global.window.ready;

    expect(global.window.optionErrors).toEqual({ paths: [], filenamePatterns: [] });
    expect(global.OptionsManagement.loadOptions).toHaveBeenCalledTimes(1);
    expect(global.browser.storage.local.get).toHaveBeenCalledWith(["lastUsedPath", "lastUsedMeta"]);
    expect(global.browser.contextMenus.removeAll).toHaveBeenCalledTimes(1);

    const contexts = ["image", "video", "audio", "link", "selection", "page"];
    expect(global.Menus.addTabMenus).toHaveBeenCalledTimes(1);
    expect(global.Menus.addRoot).toHaveBeenCalledWith(contexts);
    expect(global.Menus.addRouteExclusive).not.toHaveBeenCalled();

    expect(global.Menus.addLastUsed).toHaveBeenCalledWith(contexts);
    expect(global.Menus.makeSeparator).toHaveBeenCalledTimes(2);

    expect(global.Menus.addPaths).toHaveBeenCalledWith([".", "images", "images/cute"], contexts);
    expect(global.Menus.addSelectionType).toHaveBeenCalledWith(contexts);
    expect(global.Menus.addShowDefaultFolder).toHaveBeenCalledWith(contexts);
    expect(global.Menus.addOptions).toHaveBeenCalledWith(contexts);
  });

  test("drops blank lines and trims whitespace in the configured paths", async () => {
    setupGlobals({ options: { paths: " . \n\n  \nimages\n" } });
    await import("../src/index.js");
    await global.window.ready;

    expect(global.Menus.addPaths).toHaveBeenCalledWith([".", "images"], expect.any(Array));
  });

  test("restricts contexts to media when links/selection/page are disabled", async () => {
    setupGlobals({ options: { links: false, selection: false, page: false } });
    await import("../src/index.js");
    await global.window.ready;

    expect(global.Menus.addRoot).toHaveBeenCalledWith(["image", "video", "audio"]);
  });

  test("routeExclusive builds only the exclusive item and stops", async () => {
    setupGlobals({ options: { routeExclusive: true } });
    await import("../src/index.js");
    await global.window.ready;

    expect(global.Menus.addTabMenus).toHaveBeenCalledTimes(1);
    expect(global.Menus.addRouteExclusive).toHaveBeenCalledWith([
      "image",
      "video",
      "audio",
      "link",
      "selection",
      "page",
    ]);
    expect(global.Menus.addRoot).not.toHaveBeenCalled();
    expect(global.Menus.addLastUsed).not.toHaveBeenCalled();
    expect(global.Menus.addPaths).not.toHaveBeenCalled();
    expect(global.Menus.addOptions).not.toHaveBeenCalled();
  });

  test("skips the last-used item when enableLastLocation is off", async () => {
    setupGlobals({ options: { enableLastLocation: false } });
    await import("../src/index.js");
    await global.window.ready;

    expect(global.Menus.addLastUsed).not.toHaveBeenCalled();
    // Only the separator after the paths remains
    expect(global.Menus.makeSeparator).toHaveBeenCalledTimes(1);
    expect(global.Menus.addPaths).toHaveBeenCalled();
  });

  test("restores lastUsedPath from storage (MV3 service workers are stateless)", async () => {
    setupGlobals({ storedLocal: { lastUsedPath: "images/cute" } });
    await import("../src/index.js");
    await global.window.ready;

    // the stored local object is handed to Menus.restoreLastUsed (its mapping is
    // covered in menu.test.js)
    expect(global.Menus.restoreLastUsed).toHaveBeenCalledWith({ lastUsedPath: "images/cute" });
  });

  test("restores from an empty storage result", async () => {
    setupGlobals();
    await import("../src/index.js");
    await global.window.ready;

    expect(global.Menus.restoreLastUsed).toHaveBeenCalledWith({});
  });

  test("logs and rethrows when init fails", async () => {
    setupGlobals();
    let rejectLoad;
    global.OptionsManagement.loadOptions = vi.fn(
      () =>
        new Promise((resolve, reject) => {
          rejectLoad = reject;
        }),
    );

    await import("../src/index.js");
    // Attach the handler before rejecting so the rejection is never unhandled
    const readyRejects = expect(global.window.ready).rejects.toThrow("storage broke");
    rejectLoad(new Error("storage broke"));
    await readyRejects;

    expect(global.Log.add).toHaveBeenCalledWith("init failed", "Error: storage broke");
    expect(global.Menus.addRoot).not.toHaveBeenCalled();
  });
});

describe("current tab tracking", () => {
  test("seeds currentTab from the active tab at startup", async () => {
    const tab = { id: 3, title: "Seeded Tab" };
    setupGlobals({ tabsQueryResult: [tab] });
    await import("../src/index.js");
    await global.window.ready;
    await flush();

    expect(global.browser.tabs.query).toHaveBeenCalledWith({
      active: true,
      currentWindow: true,
    });

    // Observable through the onUpdated title-sync branch: a title change on
    // the same tab id mutates the tracked tab object
    const [[onUpdated]] = global.browser.tabs.onUpdated.addListener.mock.calls;
    onUpdated(3, { title: "New Title" });
    expect(tab.title).toBe("New Title");
    expect(global.browser.tabs.get).not.toHaveBeenCalled();
  });

  test("startup query does not clobber a tab set by onActivated first", async () => {
    setupGlobals();
    let resolveQuery;
    global.browser.tabs.query = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveQuery = resolve;
        }),
    );
    const activatedTab = { id: 9, title: "Activated" };
    global.browser.tabs.get = vi.fn(() => Promise.resolve(activatedTab));

    await import("../src/index.js");
    await global.window.ready;

    const [[onActivated]] = global.browser.tabs.onActivated.addListener.mock.calls;
    const [[onUpdated]] = global.browser.tabs.onUpdated.addListener.mock.calls;

    onActivated({ tabId: 9 });
    await flush();
    expect(global.browser.tabs.get).toHaveBeenCalledWith(9);

    resolveQuery([{ id: 1, title: "Startup Tab" }]);
    await flush();

    onUpdated(9, { title: "Still Activated" });
    expect(activatedTab.title).toBe("Still Activated");
  });

  test("survives a failing startup tab query", async () => {
    setupGlobals();
    global.browser.tabs.query = vi.fn(() => Promise.reject(new Error("no window")));

    await import("../src/index.js");
    await global.window.ready;
    await flush();

    // The rejection is swallowed; nothing was tracked
    const [[onUpdated]] = global.browser.tabs.onUpdated.addListener.mock.calls;
    onUpdated(7, { title: "x" });
    expect(global.browser.tabs.get).toHaveBeenCalledWith(7);
  });

  test("onActivated replaces the tracked tab", async () => {
    const startupTab = { id: 1, title: "Startup Tab" };
    setupGlobals({ tabsQueryResult: [startupTab] });
    const activatedTab = { id: 2, title: "Activated Tab" };
    global.browser.tabs.get = vi.fn(() => Promise.resolve(activatedTab));

    await import("../src/index.js");
    await global.window.ready;
    await flush();

    const [[onActivated]] = global.browser.tabs.onActivated.addListener.mock.calls;
    const [[onUpdated]] = global.browser.tabs.onUpdated.addListener.mock.calls;

    onActivated({ tabId: 2 });
    await flush();

    onUpdated(2, { title: "Updated Title" });
    expect(activatedTab.title).toBe("Updated Title");
    expect(startupTab.title).toBe("Startup Tab");
  });

  test("onUpdated fetches the tab when none is tracked yet", async () => {
    setupGlobals({ tabsQueryResult: [] });
    const fetchedTab = { id: 4, title: "Fetched Tab" };
    global.browser.tabs.get = vi.fn(() => Promise.resolve(fetchedTab));

    await import("../src/index.js");
    await global.window.ready;
    await flush();

    const [[onUpdated]] = global.browser.tabs.onUpdated.addListener.mock.calls;
    onUpdated(4, {});
    await flush();
    expect(global.browser.tabs.get).toHaveBeenCalledWith(4);

    // Now tracked: a title-only delta mutates it in place
    onUpdated(4, { title: "Renamed" });
    expect(fetchedTab.title).toBe("Renamed");
  });

  test("onUpdated ignores other tabs and deltas without a title", async () => {
    const tab = { id: 3, title: "Seeded Tab" };
    setupGlobals({ tabsQueryResult: [tab] });
    await import("../src/index.js");
    await global.window.ready;
    await flush();

    const [[onUpdated]] = global.browser.tabs.onUpdated.addListener.mock.calls;

    onUpdated(99, { title: "Other Tab Title" });
    expect(tab.title).toBe("Seeded Tab");
    expect(global.browser.tabs.get).not.toHaveBeenCalled();

    onUpdated(3, { status: "complete" });
    expect(tab.title).toBe("Seeded Tab");
  });
});

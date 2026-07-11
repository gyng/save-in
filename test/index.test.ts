// Background entry point: synchronous listener registration (MV3
// requirement), async init/menu construction, and current-tab tracking.
// index.ts's bootstrap is an exported start() (the entry calls it); every test
// re-imports index fresh and runs start() via importIndex() below.

// menu-click/menu-tabs extend the shared Menus at import; here Menus is a full
// stub, so keep them no-ops rather than letting them clobber the stub methods.
vi.mock("../src/menu-click.ts", () => ({}));
vi.mock("../src/menu-tabs.ts", () => ({}));
vi.mock("../src/download-state.ts", () => ({
  hydrateDownloads: () => Promise.resolve(),
  getDownload: () => Promise.resolve(null),
  mergeDownload: () => Promise.resolve(),
}));

export {};

// index.ts, menu-build.ts, option.ts and log.ts are all real modules, freshly
// re-imported after every jest.resetModules() below (mirroring test/log.test.ts
// and test/option.test.ts): a top-level static import would keep pointing at
// the first module instance, not the fresh one index.ts actually wires up on
// each re-import.
let Menus, options, OptionsManagement, Log;

const setupGlobals = async ({
  options: optionOverrides = {},
  storedLocal = {},
  tabsQueryResult = [],
} = {}) => {
  ({ Menus } = await import("../src/menu-build.ts"));
  ({ OptionsManagement } = await import("../src/option.ts"));
  ({ options } = await import("../src/options-data.ts"));
  ({ Log } = await import("../src/log.ts"));

  // menu-click.ts/menu-tabs.ts are mocked to no-ops above, so the methods
  // they'd normally attach to the shared Menus object are missing; start()
  // calls them synchronously (MV3 requirement), so stub them by hand before
  // importIndex() runs it.
  Menus.addDownloadListener = vi.fn();
  Menus.addTabMenuListener = vi.fn();
  Menus.addTabHighlightListener = vi.fn();
  Menus.addTabMenus = vi.fn();
  vi.spyOn(Menus, "addRoot").mockImplementation(() => {});
  vi.spyOn(Menus, "addRouteExclusive").mockImplementation(() => {});
  vi.spyOn(Menus, "addLastUsed").mockImplementation(() => {});
  vi.spyOn(Menus, "makeSeparator").mockImplementation(() => {});
  vi.spyOn(Menus, "addPaths").mockImplementation(() => {});
  vi.spyOn(Menus, "addSelectionType").mockImplementation(() => {});
  vi.spyOn(Menus, "addShowDefaultFolder").mockImplementation(() => {});
  vi.spyOn(Menus, "addOptions").mockImplementation(() => {});
  vi.spyOn(Menus, "restoreLastUsed").mockImplementation(() => {});

  Object.assign(
    options,
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
    optionOverrides,
  );

  OptionsManagement.loadOptions = vi.fn(() => Promise.resolve());
  Log.add = vi.fn();

  global.browser.storage.local.get = vi.fn(() => Promise.resolve(storedLocal));
  // Mock-boundary casts: these test doubles are partial shapes of the
  // strict @types/firefox-webext-browser interfaces (contextMenus, tabs.*)
  (global.browser as any).contextMenus = { removeAll: vi.fn(() => Promise.resolve()) };
  (global.browser.tabs as any).query = vi.fn(() => Promise.resolve(tabsQueryResult));
  (global.browser.tabs as any).get = vi.fn((id) => Promise.resolve({ id, title: `Tab ${id}` }));
  (global.browser.tabs as any).onActivated = { addListener: vi.fn() };
  (global.browser.tabs as any).onUpdated = { addListener: vi.fn() };

  delete global.window.ready;
  delete global.window.init;
  delete global.window.reset;
  delete global.window.optionErrors;
};

// index.ts's bootstrap is now an exported start() the entry calls synchronously
// at startup (Task #2), rather than an import-time side effect. Re-import fresh
// (after resetModules) and run start() to reproduce the startup sequence.
const importIndex = async () => {
  const { start } = await import("../src/index.ts");
  start();
};

beforeEach(() => {
  jest.resetModules();
});

describe("startup", () => {
  test("registers event listeners synchronously on startup (MV3 requirement)", async () => {
    await setupGlobals();
    await importIndex();

    expect(Menus.addDownloadListener).toHaveBeenCalledTimes(1);
    expect(Menus.addTabMenuListener).toHaveBeenCalledTimes(1);
    expect(Menus.addTabHighlightListener).toHaveBeenCalledTimes(1);
    expect(global.browser.tabs.onActivated.addListener).toHaveBeenCalledTimes(1);
    expect(global.browser.tabs.onUpdated.addListener).toHaveBeenCalledTimes(1);

    expect(global.window.init).toEqual(expect.any(Function));
    expect(global.window.reset).toEqual(expect.any(Function));
    expect(global.window.ready).toEqual(expect.any(Promise));
    await global.window.ready;
  });

  test("window.reset re-runs init and replaces window.ready", async () => {
    await setupGlobals();
    await importIndex();
    await global.window.ready;
    expect(OptionsManagement.loadOptions).toHaveBeenCalledTimes(1);

    const p = global.window.reset();
    expect(global.window.ready).toBe(p);
    await p;
    expect(OptionsManagement.loadOptions).toHaveBeenCalledTimes(2);
  });
});

describe("init", () => {
  test("loads options, then builds the full menu", async () => {
    await setupGlobals();
    await importIndex();
    await global.window.ready;

    expect(global.window.optionErrors).toEqual({ paths: [], filenamePatterns: [] });
    expect(OptionsManagement.loadOptions).toHaveBeenCalledTimes(1);
    expect(global.browser.storage.local.get).toHaveBeenCalledWith(["lastUsedPath", "lastUsedMeta"]);
    expect(global.browser.contextMenus.removeAll).toHaveBeenCalledTimes(1);

    const contexts = ["image", "video", "audio", "link", "selection", "page"];
    expect(Menus.addTabMenus).toHaveBeenCalledTimes(1);
    expect(Menus.addRoot).toHaveBeenCalledWith(contexts);
    expect(Menus.addRouteExclusive).not.toHaveBeenCalled();

    expect(Menus.addLastUsed).toHaveBeenCalledWith(contexts);
    expect(Menus.makeSeparator).toHaveBeenCalledTimes(2);

    expect(Menus.addPaths).toHaveBeenCalledWith([".", "images", "images/cute"], contexts);
    expect(Menus.addSelectionType).toHaveBeenCalledWith(contexts);
    expect(Menus.addShowDefaultFolder).toHaveBeenCalledWith(contexts);
    expect(Menus.addOptions).toHaveBeenCalledWith(contexts);
  });

  test("drops blank lines and trims whitespace in the configured paths", async () => {
    await setupGlobals({ options: { paths: " . \n\n  \nimages\n" } });
    await importIndex();
    await global.window.ready;

    expect(Menus.addPaths).toHaveBeenCalledWith([".", "images"], expect.any(Array));
  });

  test("restricts contexts to media when links/selection/page are disabled", async () => {
    await setupGlobals({ options: { links: false, selection: false, page: false } });
    await importIndex();
    await global.window.ready;

    expect(Menus.addRoot).toHaveBeenCalledWith(["image", "video", "audio"]);
  });

  test("routeExclusive builds only the exclusive item and stops", async () => {
    await setupGlobals({ options: { routeExclusive: true } });
    await importIndex();
    await global.window.ready;

    expect(Menus.addTabMenus).toHaveBeenCalledTimes(1);
    expect(Menus.addRouteExclusive).toHaveBeenCalledWith([
      "image",
      "video",
      "audio",
      "link",
      "selection",
      "page",
    ]);
    expect(Menus.addRoot).not.toHaveBeenCalled();
    expect(Menus.addLastUsed).not.toHaveBeenCalled();
    expect(Menus.addPaths).not.toHaveBeenCalled();
    expect(Menus.addOptions).not.toHaveBeenCalled();
  });

  test("skips the last-used item when enableLastLocation is off", async () => {
    await setupGlobals({ options: { enableLastLocation: false } });
    await importIndex();
    await global.window.ready;

    expect(Menus.addLastUsed).not.toHaveBeenCalled();
    // Only the separator after the paths remains
    expect(Menus.makeSeparator).toHaveBeenCalledTimes(1);
    expect(Menus.addPaths).toHaveBeenCalled();
  });

  test("restores lastUsedPath from storage (MV3 service workers are stateless)", async () => {
    await setupGlobals({ storedLocal: { lastUsedPath: "images/cute" } });
    await importIndex();
    await global.window.ready;

    // the stored local object is handed to Menus.restoreLastUsed (its mapping is
    // covered in menu.test.js)
    expect(Menus.restoreLastUsed).toHaveBeenCalledWith({ lastUsedPath: "images/cute" });
  });

  test("restores from an empty storage result", async () => {
    await setupGlobals();
    await importIndex();
    await global.window.ready;

    expect(Menus.restoreLastUsed).toHaveBeenCalledWith({});
  });

  test("logs and rethrows when init fails", async () => {
    await setupGlobals();
    let rejectLoad;
    OptionsManagement.loadOptions = vi.fn(
      () =>
        new Promise((resolve, reject) => {
          rejectLoad = reject;
        }),
    );

    await importIndex();
    // Attach the handler before rejecting so the rejection is never unhandled
    const readyRejects = expect(global.window.ready).rejects.toThrow("storage broke");
    rejectLoad(new Error("storage broke"));
    await readyRejects;

    expect(Log.add).toHaveBeenCalledWith("init failed", "Error: storage broke");
    expect(Menus.addRoot).not.toHaveBeenCalled();
  });
});

describe("current tab tracking", () => {
  test("seeds currentTab from the active tab at startup", async () => {
    const tab = { id: 3, title: "Seeded Tab" };
    await setupGlobals({ tabsQueryResult: [tab] });
    await importIndex();
    await global.window.ready;

    expect(global.browser.tabs.query).toHaveBeenCalledWith({
      active: true,
      currentWindow: true,
    });

    // Observable through the onUpdated title-sync branch: a title change on
    // the same tab id mutates the tracked tab object
    const [[onUpdated]] = vi.mocked(global.browser.tabs.onUpdated.addListener).mock.calls;
    (onUpdated as any)(3, { title: "New Title" });
    expect(tab.title).toBe("New Title");
    expect(global.browser.tabs.get).not.toHaveBeenCalled();
  });

  test("startup query does not clobber a tab set by onActivated first", async () => {
    await setupGlobals();
    let resolveQuery;
    (global.browser.tabs as any).query = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveQuery = resolve;
        }),
    );
    const activatedTab = { id: 9, title: "Activated" };
    (global.browser.tabs as any).get = vi.fn(() => Promise.resolve(activatedTab));

    await importIndex();

    const [[onActivated]] = vi.mocked(global.browser.tabs.onActivated.addListener).mock.calls;
    const [[onUpdated]] = vi.mocked(global.browser.tabs.onUpdated.addListener).mock.calls;

    await (onActivated as any)({ tabId: 9 });
    expect(global.browser.tabs.get).toHaveBeenCalledWith(9);

    resolveQuery([{ id: 1, title: "Startup Tab" }]);
    await global.window.ready;

    (onUpdated as any)(9, { title: "Still Activated" });
    expect(activatedTab.title).toBe("Still Activated");
  });

  test("survives a failing startup tab query", async () => {
    await setupGlobals();
    global.browser.tabs.query = vi.fn(() => Promise.reject(new Error("no window")));

    await importIndex();
    await global.window.ready;

    // The rejection is swallowed; nothing was tracked
    const [[onUpdated]] = vi.mocked(global.browser.tabs.onUpdated.addListener).mock.calls;
    (onUpdated as any)(7, { title: "x" });
    expect(global.browser.tabs.get).toHaveBeenCalledWith(7);
  });

  test("onActivated replaces the tracked tab", async () => {
    const startupTab = { id: 1, title: "Startup Tab" };
    await setupGlobals({ tabsQueryResult: [startupTab] });
    const activatedTab = { id: 2, title: "Activated Tab" };
    (global.browser.tabs as any).get = vi.fn(() => Promise.resolve(activatedTab));

    await importIndex();
    await global.window.ready;

    const [[onActivated]] = vi.mocked(global.browser.tabs.onActivated.addListener).mock.calls;
    const [[onUpdated]] = vi.mocked(global.browser.tabs.onUpdated.addListener).mock.calls;

    await (onActivated as any)({ tabId: 2 });

    (onUpdated as any)(2, { title: "Updated Title" });
    expect(activatedTab.title).toBe("Updated Title");
    expect(startupTab.title).toBe("Startup Tab");
  });

  test("onUpdated fetches the tab when none is tracked yet", async () => {
    await setupGlobals({ tabsQueryResult: [] });
    const fetchedTab = { id: 4, title: "Fetched Tab" };
    (global.browser.tabs as any).get = vi.fn(() => Promise.resolve(fetchedTab));

    await importIndex();
    await global.window.ready;

    const [[onUpdated]] = vi.mocked(global.browser.tabs.onUpdated.addListener).mock.calls;
    await (onUpdated as any)(4, {});
    expect(global.browser.tabs.get).toHaveBeenCalledWith(4);

    // Now tracked: a title-only delta mutates it in place
    (onUpdated as any)(4, { title: "Renamed" });
    expect(fetchedTab.title).toBe("Renamed");
  });

  test("onUpdated ignores other tabs and deltas without a title", async () => {
    const tab = { id: 3, title: "Seeded Tab" };
    await setupGlobals({ tabsQueryResult: [tab] });
    await importIndex();
    await global.window.ready;

    const [[onUpdated]] = vi.mocked(global.browser.tabs.onUpdated.addListener).mock.calls;

    (onUpdated as any)(99, { title: "Other Tab Title" });
    expect(tab.title).toBe("Seeded Tab");
    expect(global.browser.tabs.get).not.toHaveBeenCalled();

    (onUpdated as any)(3, { status: "complete" });
    expect(tab.title).toBe("Seeded Tab");
  });
});

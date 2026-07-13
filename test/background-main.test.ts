// Background entry point: synchronous listener registration (MV3
// requirement), async init/menu construction, and current-tab tracking.
// background-main.ts exports start(); every test re-imports it fresh and calls
// start() through importMain() below.

vi.mock("../src/background/menu-click.ts", () => ({ addDownloadListener: vi.fn() }));
vi.mock("../src/background/menu-tabs.ts", () => ({
  addTabMenuListener: vi.fn(),
  addTabHighlightListener: vi.fn(),
  addTabMenus: vi.fn(),
}));
const sourcePanelMocks = vi.hoisted(() => ({
  sync: vi.fn(() => Promise.resolve()),
  toggle: vi.fn(() => Promise.resolve()),
}));
vi.mock("../src/background/source-panel-state.ts", () => ({
  syncSourcePanelToTab: sourcePanelMocks.sync,
  toggleSourcePanelForTab: sourcePanelMocks.toggle,
}));
vi.mock("../src/background/menu-build.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/background/menu-build.ts")>();
  return {
    ...actual,
    addRoot: vi.fn(actual.addRoot),
    addRouteExclusive: vi.fn(actual.addRouteExclusive),
    addLastUsed: vi.fn(actual.addLastUsed),
    makeSeparator: vi.fn(actual.makeSeparator),
    addPaths: vi.fn(actual.addPaths),
    addSelectionType: vi.fn(actual.addSelectionType),
    addShowDefaultFolder: vi.fn(actual.addShowDefaultFolder),
    addOptions: vi.fn(actual.addOptions),
    addSourcePanel: vi.fn(actual.addSourcePanel),
    restoreLastUsed: vi.fn(actual.restoreLastUsed),
  };
});
vi.mock("../src/downloads/download-state.ts", () => ({
  hydrateDownloads: () => Promise.resolve(),
  getDownload: () => Promise.resolve(null),
  mergeDownload: () => Promise.resolve(),
}));
const recoveryMocks = vi.hoisted(() => ({ recover: vi.fn(() => Promise.resolve()) }));
vi.mock("../src/downloads/notification-recovery.ts", () => ({
  recoverNotificationState: recoveryMocks.recover,
}));

import type { CurrentTab } from "../src/platform/current-tab.ts";
import type { SaveInOptions } from "../src/config/option-schema.ts";

// background-main.ts, menu-build.ts, option.ts and log.ts are all real modules, freshly
// re-imported after every jest.resetModules() below (mirroring test/log.test.ts
// and test/option.test.ts): a top-level static import would keep pointing at
// the first module instance, not the fresh one background-main.ts actually wires up on
// each re-import.
let Menus: Record<string, any>;
let options: typeof import("../src/config/options-data.ts").options;
let OptionsManagement: typeof import("../src/config/option.ts").OptionsManagement;
let Log: typeof import("../src/background/log.ts").Log;
let Runtime: typeof import("../src/background/runtime.ts").backgroundRuntime;

type SetupOptions = {
  options?: Partial<SaveInOptions>;
  storedLocal?: Record<string, any>;
  tabsQueryResult?: CurrentTab[];
};

const setupGlobals = async ({
  options: optionOverrides = {},
  storedLocal = {},
  tabsQueryResult = [],
}: SetupOptions = {}) => {
  Menus = {
    ...(await import("../src/background/menu-build.ts")),
    ...(await import("../src/background/menu-click.ts")),
    ...(await import("../src/background/menu-tabs.ts")),
  };
  ({ OptionsManagement } = await import("../src/config/option.ts"));
  ({ options } = await import("../src/config/options-data.ts"));
  ({ Log } = await import("../src/background/log.ts"));
  ({ backgroundRuntime: Runtime } = await import("../src/background/runtime.ts"));

  for (const name of [
    "addRoot",
    "addRouteExclusive",
    "addLastUsed",
    "makeSeparator",
    "addPaths",
    "addSelectionType",
    "addShowDefaultFolder",
    "addOptions",
    "addSourcePanel",
    "restoreLastUsed",
  ]) {
    Menus[name].mockImplementation(() => {});
  }

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

  OptionsManagement.loadOptions = vi.fn(() => Promise.resolve(options));
  Log.add = vi.fn();

  global.browser.storage.local.get = vi.fn(() => Promise.resolve(storedLocal));
  // Mock-boundary casts: these test doubles are partial shapes of the
  // strict @types/firefox-webext-browser interfaces (contextMenus, tabs.*)
  (global.browser as any).contextMenus = { removeAll: vi.fn(() => Promise.resolve()) };
  (global.browser.tabs as any).query = vi.fn(() => Promise.resolve(tabsQueryResult));
  (global.browser.tabs as any).get = vi.fn((id) => Promise.resolve({ id, title: `Tab ${id}` }));
  (global.browser.tabs as any).onActivated = { addListener: vi.fn() };
  (global.browser.tabs as any).onUpdated = { addListener: vi.fn() };
};

// background-main.ts's bootstrap is an exported start() the entry calls synchronously
// at startup (Task #2), rather than an import-time side effect. Re-import fresh
// (after resetModules) and run start() to reproduce the startup sequence.
const importIndex = async () => {
  const { start } = await import("../src/background/main.ts");
  start();
};

beforeEach(() => {
  vi.clearAllMocks();
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

    expect(Runtime.init).toEqual(expect.any(Function));
    expect(Runtime.reset).toEqual(expect.any(Function));
    expect(Runtime.ready).toEqual(expect.any(Promise));
    await Runtime.ready;
  });

  test("runtime.reset re-runs init and replaces runtime.ready", async () => {
    await setupGlobals();
    await importIndex();
    await Runtime.ready;
    expect(OptionsManagement.loadOptions).toHaveBeenCalledTimes(1);

    const p = Runtime.reset();
    expect(Runtime.ready).toBe(p);
    await p;
    expect(OptionsManagement.loadOptions).toHaveBeenCalledTimes(2);
  });
});

describe("init", () => {
  test("loads options, then builds the full menu", async () => {
    await setupGlobals();
    await importIndex();
    await Runtime.ready;

    expect(Runtime.optionErrors).toEqual({ paths: [], filenamePatterns: [] });
    expect(OptionsManagement.loadOptions).toHaveBeenCalledTimes(1);
    expect(global.browser.storage.local.get).toHaveBeenCalledWith(["lastUsedPath", "lastUsedMeta"]);
    expect(global.browser.contextMenus.removeAll).toHaveBeenCalledTimes(1);
    expect(recoveryMocks.recover).toHaveBeenCalledTimes(1);

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

  test("applies the loaded debug option at the background composition boundary", async () => {
    await setupGlobals({ options: { debug: true } });
    await importIndex();
    await Runtime.ready;

    expect(Runtime.debug).toBe(true);
  });

  test("drops blank lines and trims whitespace in the configured paths", async () => {
    await setupGlobals({ options: { paths: " . \n\n  \nimages\n" } });
    await importIndex();
    await Runtime.ready;

    expect(Menus.addPaths).toHaveBeenCalledWith([".", "images"], expect.any(Array));
  });

  test("restricts contexts to media when links/selection/page are disabled", async () => {
    await setupGlobals({ options: { links: false, selection: false, page: false } });
    await importIndex();
    await Runtime.ready;

    expect(Menus.addRoot).toHaveBeenCalledWith(["image", "video", "audio"]);
  });

  test("routeExclusive builds only the exclusive item and stops", async () => {
    await setupGlobals({ options: { routeExclusive: true } });
    await importIndex();
    await Runtime.ready;

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
    await Runtime.ready;

    expect(Menus.addLastUsed).not.toHaveBeenCalled();
    // Only the separator after the paths remains
    expect(Menus.makeSeparator).toHaveBeenCalledTimes(1);
    expect(Menus.addPaths).toHaveBeenCalled();
  });

  test("restores lastUsedPath from storage (MV3 service workers are stateless)", async () => {
    await setupGlobals({ storedLocal: { lastUsedPath: "images/cute" } });
    await importIndex();
    await Runtime.ready;

    // the stored local object is handed to Menus.restoreLastUsed (its mapping is
    // covered in menu.test.js)
    expect(Menus.restoreLastUsed).toHaveBeenCalledWith({ lastUsedPath: "images/cute" });
  });

  test("restores from an empty storage result", async () => {
    await setupGlobals();
    await importIndex();
    await Runtime.ready;

    expect(Menus.restoreLastUsed).toHaveBeenCalledWith({});
  });

  test("logs and rethrows when init fails", async () => {
    await setupGlobals();
    let rejectLoad: (reason?: unknown) => void = () => {
      throw new Error("load rejection was not captured");
    };
    OptionsManagement.loadOptions = vi.fn(
      () =>
        new Promise<SaveInOptions>((resolve, reject) => {
          rejectLoad = reject;
        }),
    );

    await importIndex();
    // Attach the handler before rejecting so the rejection is never unhandled
    const readyRejects = expect(Runtime.ready).rejects.toThrow("storage broke");
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
    await Runtime.ready;

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
    let resolveQuery: (tabs: CurrentTab[]) => void = () => {
      throw new Error("tab query resolver was not captured");
    };
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
    await Runtime.ready;

    (onUpdated as any)(9, { title: "Still Activated" });
    expect(activatedTab.title).toBe("Still Activated");
  });

  test("survives a failing startup tab query", async () => {
    await setupGlobals();
    global.browser.tabs.query = vi.fn(() => Promise.reject(new Error("no window")));

    await importIndex();
    await Runtime.ready;

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
    await Runtime.ready;

    const [[onActivated]] = vi.mocked(global.browser.tabs.onActivated.addListener).mock.calls;
    const [[onUpdated]] = vi.mocked(global.browser.tabs.onUpdated.addListener).mock.calls;

    await (onActivated as any)({ tabId: 2 });

    (onUpdated as any)(2, { title: "Updated Title" });
    expect(activatedTab.title).toBe("Updated Title");
    expect(startupTab.title).toBe("Startup Tab");
  });

  test("contains and logs rejected work from a browser event listener", async () => {
    await setupGlobals();
    (global.browser.tabs as any).get = vi.fn(() => Promise.reject(new Error("tab closed")));

    await importIndex();
    await Runtime.ready;

    const [[onActivated]] = vi.mocked(global.browser.tabs.onActivated.addListener).mock.calls;
    await expect((onActivated as any)({ tabId: 9 })).resolves.toBeUndefined();
    expect(Log.add).toHaveBeenCalledWith("tab activation failed", "Error: tab closed");
  });

  test("onUpdated fetches the tab when none is tracked yet", async () => {
    await setupGlobals({ tabsQueryResult: [] });
    const fetchedTab = { id: 4, title: "Fetched Tab" };
    (global.browser.tabs as any).get = vi.fn(() => Promise.resolve(fetchedTab));

    await importIndex();
    await Runtime.ready;

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
    await Runtime.ready;

    const [[onUpdated]] = vi.mocked(global.browser.tabs.onUpdated.addListener).mock.calls;

    (onUpdated as any)(99, { title: "Other Tab Title" });
    expect(tab.title).toBe("Seeded Tab");
    expect(global.browser.tabs.get).not.toHaveBeenCalled();

    (onUpdated as any)(3, { status: "complete" });
    expect(tab.title).toBe("Seeded Tab");
  });

  test("restores the shared Page Sources state when any tab finishes loading", async () => {
    const tab = { id: 3, title: "Seeded Tab", active: false };
    await setupGlobals({ tabsQueryResult: [tab] });
    await importIndex();
    await Runtime.ready;

    const [[onUpdated]] = vi.mocked(global.browser.tabs.onUpdated.addListener).mock.calls;
    await (onUpdated as any)(3, { status: "complete" }, tab);

    expect(sourcePanelMocks.sync).toHaveBeenCalledWith(3);
  });

  test("an inactive tab update cannot win the cold-start active-tab race", async () => {
    let resolveQuery: (tabs: CurrentTab[]) => void = () => {
      throw new Error("tab query resolver was not captured");
    };
    await setupGlobals();
    (global.browser.tabs as any).query = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveQuery = resolve;
        }),
    );
    await importIndex();

    const [[onUpdated]] = vi.mocked(global.browser.tabs.onUpdated.addListener).mock.calls;
    await (onUpdated as any)(7, { title: "Background tab" }, { id: 7, active: false });
    expect(global.browser.tabs.get).not.toHaveBeenCalled();

    const activeTab = { id: 3, title: "Active tab" };
    resolveQuery([activeTab]);
    await Runtime.ready;

    await (onUpdated as any)(3, { title: "Updated active title" }, activeTab);
    expect(activeTab.title).toBe("Updated active title");
  });
});

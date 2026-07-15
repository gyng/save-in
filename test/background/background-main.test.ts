// Background entry point: synchronous listener registration (MV3
// requirement), async init/menu construction, and current-tab tracking.
// background-main.ts exports start(); each test resets the owner-controlled
// runtime/tab state and calls start() through importIndex() below.

vi.mock("../../src/background/menu-click.ts", () => ({ addDownloadListener: vi.fn() }));
vi.mock("../../src/menus/menu-tree.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/menus/menu-tree.ts")>();
  return { ...actual, buildTree: vi.fn(actual.buildTree) };
});
vi.mock("../../src/background/menu-tabs.ts", () => ({
  addTabMenuListener: vi.fn(),
  addTabHighlightListener: vi.fn(),
  addTabMenus: vi.fn(),
}));
const sourcePanelMocks = vi.hoisted(() => ({
  sync: vi.fn(() => Promise.resolve()),
  toggle: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../src/background/source-panel-state.ts", () => ({
  syncSourcePanelToTab: sourcePanelMocks.sync,
  toggleSourcePanelForTab: sourcePanelMocks.toggle,
}));
vi.mock("../../src/background/menu-build.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/background/menu-build.ts")>();
  return {
    ...actual,
    addRoot: vi.fn(actual.addRoot),
    addRouteExclusive: vi.fn(actual.addRouteExclusive),
    addLastUsed: vi.fn(actual.addLastUsed),
    makeSeparator: vi.fn(actual.makeSeparator),
    renderPathTree: vi.fn(actual.renderPathTree),
    addSelectionType: vi.fn(actual.addSelectionType),
    addShowDefaultFolder: vi.fn(actual.addShowDefaultFolder),
    addOptions: vi.fn(actual.addOptions),
    addSourcePanel: vi.fn(actual.addSourcePanel),
    restoreLastUsed: vi.fn(actual.restoreLastUsed),
  };
});
const downloadStateMocks = vi.hoisted(() => ({ hydrate: vi.fn(() => Promise.resolve()) }));
vi.mock("../../src/downloads/download-state.ts", () => ({
  hydrateDownloads: downloadStateMocks.hydrate,
  getDownload: () => Promise.resolve(null),
  mergeDownload: () => Promise.resolve(),
}));
const recoveryMocks = vi.hoisted(() => ({ recover: vi.fn(() => Promise.resolve()) }));
vi.mock("../../src/downloads/notification-recovery.ts", () => ({
  recoverNotificationState: recoveryMocks.recover,
}));
const activeTransferMocks = vi.hoisted(() => ({ recover: vi.fn(() => Promise.resolve({})) }));
vi.mock("../../src/downloads/active-transfers.ts", () => ({
  ActiveTransfers: { recover: activeTransferMocks.recover },
}));

import type { CurrentTab } from "../../src/platform/current-tab.ts";
import type { SaveInOptions } from "../../src/config/option-schema.ts";
import { WELCOME_PENDING_STORAGE_KEY, WELCOME_VERSION } from "../../src/shared/storage-keys.ts";
import { browserTab, installHostProperty } from "../support/webextension-host.fixture.ts";

// background-main.ts, menu-build.ts, option.ts and log.ts are real modules.
// They are loaded lazily so the host fakes exist first, then reused while each
// test resets the mutable owners explicitly.
type MenusFixture = typeof import("../../src/background/menu-build.ts") &
  typeof import("../../src/background/menu-click.ts") &
  typeof import("../../src/background/menu-tabs.ts") &
  typeof import("../../src/menus/menu-tree.ts");
let Menus: MenusFixture;
let options: typeof import("../../src/config/options-data.ts").options;
let OptionsManagement: typeof import("../../src/config/option.ts").OptionsManagement;
let Log: typeof import("../../src/background/log.ts").Log;
let Runtime: typeof import("../../src/background/runtime.ts").backgroundRuntime;

type SetupOptions = {
  options?: Partial<SaveInOptions>;
  storedLocal?: Record<string, unknown>;
  tabsQueryResult?: CurrentTab[];
};

const setupGlobals = async ({
  options: optionOverrides = {},
  storedLocal = {},
  tabsQueryResult = [],
}: SetupOptions = {}) => {
  Menus = {
    ...(await import("../../src/background/menu-build.ts")),
    ...(await import("../../src/background/menu-click.ts")),
    ...(await import("../../src/background/menu-tabs.ts")),
    ...(await import("../../src/menus/menu-tree.ts")),
  };
  ({ OptionsManagement } = await import("../../src/config/option.ts"));
  ({ options } = await import("../../src/config/options-data.ts"));
  ({ Log } = await import("../../src/background/log.ts"));
  ({ backgroundRuntime: Runtime } = await import("../../src/background/runtime.ts"));
  const { setCurrentTab } = await import("../../src/platform/current-tab.ts");
  setCurrentTab(null);
  delete Runtime.ready;
  Runtime.debug = false;
  Runtime.optionErrors = { paths: [], filenamePatterns: [] };

  vi.mocked(Menus.addRoot).mockImplementation(() => undefined);
  vi.mocked(Menus.addRouteExclusive).mockImplementation(() => undefined);
  vi.mocked(Menus.addLastUsed).mockImplementation(() => undefined);
  vi.mocked(Menus.makeSeparator).mockImplementation(() => undefined);
  vi.mocked(Menus.renderPathTree).mockImplementation(() => undefined);
  vi.mocked(Menus.addSelectionType).mockImplementation(() => undefined);
  vi.mocked(Menus.addShowDefaultFolder).mockImplementation(() => undefined);
  vi.mocked(Menus.addOptions).mockImplementation(() => undefined);
  vi.mocked(Menus.addSourcePanel).mockImplementation(() => undefined);
  vi.mocked(Menus.restoreLastUsed).mockImplementation(() => undefined);

  Object.assign(
    options,
    {
      paths: ".\nimages\nimages/cute",
      links: true,
      selection: true,
      page: true,
      routeExclusive: false,
      routeHideFolderChoices: false,
      routeSkipUnmatched: false,
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
  installHostProperty(global.browser, "contextMenus", {
    removeAll: vi.fn(() => Promise.resolve()),
  });
  installHostProperty(
    global.browser.tabs,
    "query",
    vi.fn(() => Promise.resolve(tabsQueryResult)),
  );
  installHostProperty(
    global.browser.tabs,
    "get",
    vi.fn((id: number) => Promise.resolve({ id, title: `Tab ${id}` })),
  );
  installHostProperty(global.browser.tabs, "onActivated", { addListener: vi.fn() });
  installHostProperty(global.browser.tabs, "onUpdated", { addListener: vi.fn() });
  installHostProperty(global.browser, "action", { onClicked: { addListener: vi.fn() } });
  installHostProperty(global.browser, "commands", { onCommand: { addListener: vi.fn() } });
};

type OnActivated = (
  ...args: Parameters<Parameters<typeof browser.tabs.onActivated.addListener>[0]>
) => void | Promise<void>;
type OnUpdated = (
  tabId: number,
  changeInfo: Parameters<Parameters<typeof browser.tabs.onUpdated.addListener>[0]>[1],
  tab?: browser.tabs.Tab,
) => void | Promise<void>;
type OnInstalled = (
  details: Parameters<Parameters<typeof browser.runtime.onInstalled.addListener>[0]>[0],
) => void | Promise<void>;

const capturedOnActivated = (): OnActivated => {
  const listener = vi.mocked(global.browser.tabs.onActivated.addListener).mock.calls[0]?.[0];
  if (!listener) throw new Error("onActivated listener was not registered");
  return listener;
};

const capturedOnUpdated = (): OnUpdated => {
  const listener = vi.mocked(global.browser.tabs.onUpdated.addListener).mock.calls[0]?.[0];
  if (!listener) throw new Error("onUpdated listener was not registered");
  return (tabId, changeInfo, tab) =>
    Reflect.apply(
      listener,
      undefined,
      tab === undefined ? [tabId, changeInfo] : [tabId, changeInfo, tab],
    );
};

const capturedOnInstalled = (): OnInstalled => {
  const listener = vi.mocked(global.browser.runtime.onInstalled.addListener).mock.calls[0]?.[0];
  if (!listener) throw new Error("runtime install listener was not registered");
  return listener;
};

const capturedActionClick = () => {
  const listener = vi.mocked(global.browser.action.onClicked.addListener).mock.calls[0]?.[0];
  if (!listener) throw new Error("action listener was not registered");
  return listener;
};

const capturedCommand = () => {
  const listener = vi.mocked(global.browser.commands.onCommand.addListener).mock.calls[0]?.[0];
  if (!listener) throw new Error("command listener was not registered");
  return listener;
};

const mockTab = browserTab;

// The entry calls start() synchronously; call it explicitly to reproduce the
// startup sequence against each test's fresh browser listeners.
const importIndex = async () => {
  const { start } = await import("../../src/background/main.ts");
  start();
};

beforeEach(() => {
  vi.clearAllMocks();
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
    expect(global.browser.action.onClicked.addListener).toHaveBeenCalledTimes(1);
    expect(global.browser.commands.onCommand.addListener).toHaveBeenCalledTimes(1);
    expect(global.browser.runtime.onInstalled.addListener).toHaveBeenCalledTimes(1);

    expect(Runtime.init).toEqual(expect.any(Function));
    expect(Runtime.reset).toEqual(expect.any(Function));
    expect(Runtime.ready).toEqual(expect.any(Promise));
    await Runtime.ready;
  });

  test("opens setup with pending welcome state only on first install", async () => {
    await setupGlobals();
    await importIndex();
    const installed = capturedOnInstalled();

    await installed({ reason: "update", previousVersion: "3.9.0", temporary: false });
    await installed({ reason: "update", temporary: false });
    await installed({ reason: "browser_update", temporary: false });
    expect(global.browser.runtime.openOptionsPage).not.toHaveBeenCalled();
    expect(global.browser.storage.local.set).not.toHaveBeenCalled();

    await installed({ reason: "install", temporary: false });
    expect(global.browser.storage.local.set).toHaveBeenCalledWith({
      [WELCOME_PENDING_STORAGE_KEY]: WELCOME_VERSION,
    });
    expect(global.browser.runtime.openOptionsPage).toHaveBeenCalledOnce();

    vi.mocked(global.browser.storage.local.set).mockRejectedValueOnce(new Error("storage failed"));
    await installed({ reason: "install", temporary: false });
    expect(global.browser.runtime.openOptionsPage).toHaveBeenCalledTimes(2);
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

  test("configuration resets do not repeat cold-start recovery", async () => {
    await setupGlobals();
    await importIndex();
    await Runtime.ready;

    expect(downloadStateMocks.hydrate).toHaveBeenCalledTimes(1);
    expect(recoveryMocks.recover).toHaveBeenCalledTimes(1);
    expect(activeTransferMocks.recover).toHaveBeenCalledTimes(1);

    await Runtime.reset();

    expect(downloadStateMocks.hydrate).toHaveBeenCalledTimes(1);
    expect(recoveryMocks.recover).toHaveBeenCalledTimes(1);
    expect(activeTransferMocks.recover).toHaveBeenCalledTimes(1);
    expect(global.browser.contextMenus.removeAll).toHaveBeenCalledTimes(2);
  });

  test("runtime.reset initializes safely before start", async () => {
    await setupGlobals();
    await import("../../src/background/main.ts");

    await expect(Runtime.reset()).resolves.toBeUndefined();
    expect(OptionsManagement.loadOptions).toHaveBeenCalledTimes(1);
  });

  test("runtime.reset recovers after an earlier ready promise rejected", async () => {
    await setupGlobals();
    await import("../../src/background/main.ts");
    Runtime.ready = Promise.reject(new Error("previous init"));

    await expect(Runtime.reset()).resolves.toBeUndefined();
    expect(OptionsManagement.loadOptions).toHaveBeenCalledTimes(1);
  });

  test("action and command listeners toggle Page Sources when a tab is available", async () => {
    await setupGlobals({ tabsQueryResult: [mockTab({ id: 6 })] });
    await importIndex();
    await Runtime.ready;

    const actionClick = capturedActionClick();
    await actionClick(mockTab({ id: 7 }));
    expect(sourcePanelMocks.toggle).toHaveBeenCalledWith(7);
    expect(actionClick(mockTab({ id: undefined }))).toBeUndefined();

    const command = capturedCommand();
    expect(command("unrelated", mockTab())).toBeUndefined();
    await command(Menus.MENU_IDS.TOGGLE_SOURCE_PANEL, mockTab());
    expect(sourcePanelMocks.toggle).toHaveBeenCalledWith(6);

    vi.mocked(global.browser.tabs.query).mockResolvedValueOnce([]);
    await command(Menus.MENU_IDS.TOGGLE_SOURCE_PANEL, mockTab());
    expect(sourcePanelMocks.toggle).toHaveBeenCalledTimes(2);
  });
});

describe("init", () => {
  test("cleans interrupted transfers and contains stale-resource cleanup failures", async () => {
    await setupGlobals();
    const { OffscreenClient } = await import("../../src/platform/offscreen-client.ts");
    const { RefererRules } = await import("../../src/downloads/referer-rules.ts");
    const { SaveHistory } = await import("../../src/background/history.ts");
    vi.spyOn(RefererRules, "cleanupStaleRule").mockRejectedValueOnce(new Error("stale rule"));
    vi.spyOn(OffscreenClient, "canUse").mockReturnValueOnce(true).mockReturnValueOnce(false);
    const cancelOffscreen = vi
      .spyOn(OffscreenClient, "cancel")
      .mockRejectedValueOnce(new Error("gone"));
    const cancelDownload = vi
      .mocked(global.browser.downloads.cancel)
      .mockRejectedValueOnce(new Error("gone"));
    const setStatus = vi.spyOn(SaveHistory, "setStatus").mockResolvedValue(undefined);
    activeTransferMocks.recover.mockResolvedValueOnce({
      first: { requestId: "request-1", downloadId: 7 },
      second: { requestId: "request-2", downloadId: null },
      third: {},
    });

    await importIndex();
    await Runtime.ready;

    expect(Log.add).toHaveBeenCalledWith(
      "Referer session rule cleanup failed",
      "Error: stale rule",
    );
    expect(cancelOffscreen).toHaveBeenCalledWith("request-1");
    expect(cancelDownload).toHaveBeenCalledWith(7);
    expect(setStatus).toHaveBeenCalledTimes(3);
    expect(setStatus).toHaveBeenCalledWith("first", "DOWNLOAD_PREPARATION_INTERRUPTED", 7);
  });

  test("loads options, then builds the full menu", async () => {
    await setupGlobals();
    await importIndex();
    await Runtime.ready;

    expect(Runtime.optionErrors).toEqual({ paths: [], filenamePatterns: [] });
    expect(OptionsManagement.loadOptions).toHaveBeenCalledTimes(1);
    expect(global.browser.storage.local.get).toHaveBeenCalledWith([
      "lastUsedPath",
      "lastUsedMeta",
      "recentDestinations",
    ]);
    expect(global.browser.contextMenus.removeAll).toHaveBeenCalledTimes(1);
    expect(recoveryMocks.recover).toHaveBeenCalledTimes(1);

    const contexts = ["image", "video", "audio", "link", "selection", "page"];
    expect(Menus.addTabMenus).toHaveBeenCalledTimes(1);
    expect(Menus.addRoot).toHaveBeenCalledWith(contexts);
    expect(Menus.addRouteExclusive).not.toHaveBeenCalled();

    expect(Menus.addLastUsed).toHaveBeenCalledWith(contexts);
    expect(Menus.makeSeparator).toHaveBeenCalledTimes(2);

    expect(Menus.buildTree).toHaveBeenCalledWith([".", "images", "images/cute"]);
    expect(Menus.renderPathTree).toHaveBeenCalledWith(
      expect.objectContaining({ items: expect.any(Array), errors: [] }),
      contexts,
    );
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

    expect(Menus.buildTree).toHaveBeenCalledWith([".", "images"]);
  });

  test("restricts contexts to media when links/selection/page are disabled", async () => {
    await setupGlobals({ options: { links: false, selection: false, page: false } });
    await importIndex();
    await Runtime.ready;

    expect(Menus.addRoot).toHaveBeenCalledWith(["image", "video", "audio", "page"]);
    expect(Menus.addSourcePanel).toHaveBeenCalledWith(["image", "video", "audio", "page"]);
    expect(Menus.renderPathTree).toHaveBeenCalledWith(expect.any(Object), [
      "image",
      "video",
      "audio",
    ]);
    expect(Menus.addOptions).toHaveBeenCalledWith(["image", "video", "audio"]);
    expect(Menus.addShowDefaultFolder).toHaveBeenCalledWith(["image", "video", "audio"]);
  });

  test("hiding folder choices keeps Page Sources available under the root", async () => {
    await setupGlobals({ options: { routeHideFolderChoices: true } });
    await importIndex();
    await Runtime.ready;

    expect(Menus.addTabMenus).toHaveBeenCalledTimes(1);
    const contexts = ["image", "video", "audio", "link", "selection", "page"];
    expect(Menus.addRouteExclusive).toHaveBeenCalledWith(contexts);
    expect(Menus.addRoot).toHaveBeenCalledWith(contexts);
    expect(Menus.makeSeparator).toHaveBeenCalledWith(contexts, Menus.MENU_IDS.SEPARATOR.ACTIONS);
    expect(Menus.addLastUsed).not.toHaveBeenCalled();
    expect(Menus.renderPathTree).not.toHaveBeenCalled();
    expect(Menus.addOptions).not.toHaveBeenCalled();
    expect(Menus.addSourcePanel).toHaveBeenCalledWith(contexts);
  });

  test("skips the last-used item when enableLastLocation is off", async () => {
    await setupGlobals({ options: { enableLastLocation: false } });
    await importIndex();
    await Runtime.ready;

    expect(Menus.addLastUsed).not.toHaveBeenCalled();
    // Only the separator after the paths remains
    expect(Menus.makeSeparator).toHaveBeenCalledTimes(1);
    expect(Menus.renderPathTree).toHaveBeenCalled();
  });

  test.each(["", "<invalid>", "---"])(
    "uses one separator between Last Used and actions when paths are %j",
    async (paths) => {
      await setupGlobals({ options: { paths } });
      await importIndex();
      await Runtime.ready;

      expect(Menus.makeSeparator).toHaveBeenCalledTimes(1);
      expect(Menus.makeSeparator).toHaveBeenCalledWith(
        expect.any(Array),
        Menus.MENU_IDS.SEPARATOR.ACTIONS,
      );
    },
  );

  test.each(["", "<invalid>", "---"])(
    "does not lead actions with a separator when Last Used is off and paths are %j",
    async (paths) => {
      await setupGlobals({ options: { paths, enableLastLocation: false } });
      await importIndex();
      await Runtime.ready;

      expect(Menus.makeSeparator).not.toHaveBeenCalled();
    },
  );

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
        new Promise<SaveInOptions>((_resolve, reject) => {
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
    const tab = mockTab({ id: 3, title: "Seeded Tab" });
    await setupGlobals({ tabsQueryResult: [tab] });
    await importIndex();
    await Runtime.ready;

    expect(global.browser.tabs.query).toHaveBeenCalledWith({
      active: true,
      currentWindow: true,
    });

    // Observable through the onUpdated title-sync branch: a title change on
    // the same tab id mutates the tracked tab object
    const onUpdated = capturedOnUpdated();
    onUpdated(3, { title: "New Title" }, tab);
    expect(tab.title).toBe("New Title");
    expect(global.browser.tabs.get).not.toHaveBeenCalled();
  });

  test("startup query does not clobber a tab set by onActivated first", async () => {
    await setupGlobals();
    let resolveQuery: (tabs: CurrentTab[]) => void = () => {
      throw new Error("tab query resolver was not captured");
    };
    Reflect.set(
      global.browser.tabs,
      "query",
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveQuery = resolve;
          }),
      ),
    );
    const activatedTab = mockTab({ id: 9, title: "Activated" });
    Reflect.set(
      global.browser.tabs,
      "get",
      vi.fn(() => Promise.resolve(activatedTab)),
    );

    await importIndex();

    const onActivated = capturedOnActivated();
    const onUpdated = capturedOnUpdated();

    await onActivated({ tabId: 9, windowId: 1 });
    expect(global.browser.tabs.get).toHaveBeenCalledWith(9);

    resolveQuery([mockTab({ id: 1, title: "Startup Tab" })]);
    await Runtime.ready;

    await onUpdated(9, { title: "Still Activated" }, activatedTab);
    expect(activatedTab.title).toBe("Still Activated");
  });

  test("survives a failing startup tab query", async () => {
    await setupGlobals();
    global.browser.tabs.query = vi.fn(() => Promise.reject(new Error("no window")));

    await importIndex();
    await Runtime.ready;

    // The rejection is swallowed; nothing was tracked
    const onUpdated = capturedOnUpdated();
    await onUpdated(7, { title: "x" });
    expect(global.browser.tabs.get).toHaveBeenCalledWith(7);
  });

  test("onActivated replaces the tracked tab", async () => {
    const startupTab = mockTab({ id: 1, title: "Startup Tab" });
    await setupGlobals({ tabsQueryResult: [startupTab] });
    const activatedTab = mockTab({ id: 2, title: "Activated Tab" });
    Reflect.set(
      global.browser.tabs,
      "get",
      vi.fn(() => Promise.resolve(activatedTab)),
    );

    await importIndex();
    await Runtime.ready;

    const onActivated = capturedOnActivated();
    const onUpdated = capturedOnUpdated();

    await onActivated({ tabId: 2, windowId: 1 });

    await onUpdated(2, { title: "Updated Title" }, activatedTab);
    expect(activatedTab.title).toBe("Updated Title");
    expect(startupTab.title).toBe("Startup Tab");
  });

  test("contains and logs rejected work from a browser event listener", async () => {
    await setupGlobals();
    Reflect.set(
      global.browser.tabs,
      "get",
      vi.fn(() => Promise.reject(new Error("tab closed"))),
    );

    await importIndex();
    await Runtime.ready;

    const onActivated = capturedOnActivated();
    await expect(onActivated({ tabId: 9, windowId: 1 })).resolves.toBeUndefined();
    expect(Log.add).toHaveBeenCalledWith("tab activation failed", "Error: tab closed");
  });

  test("onUpdated fetches the tab when none is tracked yet", async () => {
    await setupGlobals({ tabsQueryResult: [] });
    const fetchedTab = mockTab({ id: 4, title: "Fetched Tab" });
    Reflect.set(
      global.browser.tabs,
      "get",
      vi.fn(() => Promise.resolve(fetchedTab)),
    );

    await importIndex();
    await Runtime.ready;

    const onUpdated = capturedOnUpdated();
    await onUpdated(4, {});
    expect(global.browser.tabs.get).toHaveBeenCalledWith(4);

    // Now tracked: a title-only delta mutates it in place
    await onUpdated(4, { title: "Renamed" }, fetchedTab);
    expect(fetchedTab.title).toBe("Renamed");
  });

  test("onUpdated ignores other tabs and deltas without a title", async () => {
    const tab = mockTab({ id: 3, title: "Seeded Tab" });
    await setupGlobals({ tabsQueryResult: [tab] });
    await importIndex();
    await Runtime.ready;

    const onUpdated = capturedOnUpdated();

    await onUpdated(99, { title: "Other Tab Title" }, mockTab({ id: 99 }));
    expect(tab.title).toBe("Seeded Tab");
    expect(global.browser.tabs.get).not.toHaveBeenCalled();

    await onUpdated(3, { status: "complete" }, tab);
    expect(tab.title).toBe("Seeded Tab");
  });

  test("restores the shared Page Sources state when any tab finishes loading", async () => {
    const tab = mockTab({ id: 3, title: "Seeded Tab", active: false });
    await setupGlobals({ tabsQueryResult: [tab] });
    await importIndex();
    await Runtime.ready;

    const onUpdated = capturedOnUpdated();
    await onUpdated(3, { status: "complete" }, tab);

    expect(sourcePanelMocks.sync).toHaveBeenCalledWith(3);
  });

  test("an inactive tab update cannot win the cold-start active-tab race", async () => {
    let resolveQuery: (tabs: CurrentTab[]) => void = () => {
      throw new Error("tab query resolver was not captured");
    };
    await setupGlobals();
    Reflect.set(
      global.browser.tabs,
      "query",
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveQuery = resolve;
          }),
      ),
    );
    await importIndex();

    const onUpdated = capturedOnUpdated();
    await onUpdated(7, { title: "Background tab" }, mockTab({ id: 7, active: false }));
    expect(global.browser.tabs.get).not.toHaveBeenCalled();

    const activeTab = mockTab({ id: 3, title: "Active tab" });
    resolveQuery([activeTab]);
    await Runtime.ready;

    await onUpdated(3, { title: "Updated active title" }, activeTab);
    expect(activeTab.title).toBe("Updated active title");
  });
});

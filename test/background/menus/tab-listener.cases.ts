import {
  DOWNLOAD_TYPES,
  options,
  Download,
  makeShortcut,
  suggestShortcutFilename,
  Runtime,
  setupBrowserMocks,
  importMenus,
  type MenusFixture,
  type TestMenuListener,
} from "./listeners.fixture.ts";
import type { DownloadPipelineState } from "../../../src/downloads/download-types.ts";

describe("addTabMenuListener", () => {
  test("registers a synchronous listener that ignores non-tabstrip items", async () => {
    vi.restoreAllMocks();
    setupBrowserMocks();
    (global.browser as any).tabs = { query: vi.fn(() => Promise.resolve([])) };
    const Menus = await importMenus();
    Runtime.ready = Promise.resolve();
    Menus.addTabMenuListener();
    // The click payloads below are partial OnClickData fixtures; keep the
    // captured handler loosely typed so the tests can pass them.
    const [[listener]] = vi.mocked(global.browser.contextMenus.onClicked.addListener).mock
      .calls as any[];

    await listener({ menuItemId: "save-in-0" }, { windowId: 1 });
    expect(global.browser.tabs.query).not.toHaveBeenCalled();

    await listener(
      { menuItemId: Menus.IDS.TABSTRIP.SELECTED_TAB },
      { windowId: 1, id: 5, index: 0 },
    );
    expect(global.browser.tabs.query).toHaveBeenCalled();
  });
});

describe("addTabMenuListener tabstrip downloads", () => {
  let Menus: MenusFixture;
  let listener: TestMenuListener;

  // Tab 3 must be skipped: privileged pages cannot be saved
  const tabFixtures = () => [
    { id: 1, index: 0, url: "https://a.test/one", title: "One" },
    { id: 2, index: 1, url: "https://b.test/two", title: "Two" },
    { id: 3, index: 2, url: "about:config", title: "Prefs" },
  ];

  const fromTab = { id: 2, index: 1, windowId: 7 };

  beforeEach(async () => {
    vi.restoreAllMocks();
    setupBrowserMocks();
    (global.browser as any).tabs = {
      query: vi.fn(() => Promise.resolve(tabFixtures())),
      remove: vi.fn(),
    };
    vi.useFakeTimers();

    Menus = await importMenus();
    Runtime.ready = Promise.resolve();
    Menus.addTabMenuListener();
    [listener] = vi.mocked(global.browser.contextMenus.onClicked.addListener).mock.calls[0]!;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const downloads = () =>
    vi.mocked(Download.launchDownload).mock.calls.map(([state]: [any]) => state);

  test("SELECTED_TAB downloads only the clicked tab", async () => {
    await listener({ menuItemId: Menus.IDS.TABSTRIP.SELECTED_TAB }, fromTab);
    await vi.advanceTimersByTimeAsync(2000);

    expect(global.browser.tabs.query).toHaveBeenCalledWith({
      windowId: 7,
      windowType: "normal",
    });

    expect(downloads()).toHaveLength(1);
    const [state] = downloads();
    expect(state.info.currentTab.id).toBe(2);
    expect(state.info.url).toBe("https://b.test/two");
    expect(state.info.context).toBe(DOWNLOAD_TYPES.TAB);
    expect(state.info.suggestedFilename).toBeNull();
    expect(state.needRouteMatch).toBe(false);
    expect(state.path.raw).toBe(".");
  });

  test("preserves modifier metadata from tab-strip clicks", async () => {
    await listener({ menuItemId: Menus.IDS.TABSTRIP.SELECTED_TAB, modifiers: ["Shift"] }, fromTab);

    expect(downloads()[0]!.info.modifiers).toEqual(["Shift"]);
  });

  test("filters malformed modifier metadata from tab-strip clicks", async () => {
    await listener(
      { menuItemId: Menus.IDS.TABSTRIP.SELECTED_TAB, modifiers: ["Shift", 7, "Ctrl"] },
      fromTab,
    );

    expect(downloads()[0]!.info.modifiers).toEqual(["Shift", "Ctrl"]);
  });

  test("SELECTED_TAB includes an explicitly selected pinned tab", async () => {
    (global.browser.tabs as any).query = vi.fn((query: { pinned?: boolean }) =>
      Promise.resolve(
        query.pinned === false
          ? []
          : [{ id: 8, index: 0, pinned: true, url: "https://pinned.test/", title: "Pinned" }],
      ),
    );

    await listener(
      { menuItemId: Menus.IDS.TABSTRIP.SELECTED_TAB },
      { id: 8, index: 0, windowId: 7, pinned: true },
    );

    expect(downloads()).toHaveLength(1);
    expect(downloads()[0]!.info.currentTab.id).toBe(8);
  });

  test("SELECTED_MULTIPLE_TABS queues every highlighted tab without background timers", async () => {
    await listener({ menuItemId: Menus.IDS.TABSTRIP.SELECTED_MULTIPLE_TABS }, fromTab);

    expect(global.browser.tabs.query).toHaveBeenCalledWith(
      expect.objectContaining({ highlighted: true }),
    );

    expect(downloads()).toHaveLength(2);
    expect(downloads().map((s: any) => s.info.currentTab.id)).toEqual([1, 2]);
  });

  test("TO_RIGHT downloads tabs at and after the clicked index", async () => {
    await listener({ menuItemId: Menus.IDS.TABSTRIP.TO_RIGHT }, { id: 1, index: 1, windowId: 7 });
    await vi.advanceTimersByTimeAsync(2000);

    expect(downloads()).toHaveLength(1);
    expect(downloads()[0]!.info.currentTab.id).toBe(2);
    expect(downloads()[0]!.needRouteMatch).toBe(false);
  });

  test("TO_LEFT downloads tabs at and before the clicked index", async () => {
    await listener({ menuItemId: Menus.IDS.TABSTRIP.TO_LEFT }, { id: 2, index: 1, windowId: 7 });
    await vi.advanceTimersByTimeAsync(2000);

    expect(downloads().map((state: any) => state.info.currentTab.id)).toEqual([1, 2]);
    expect(downloads().every((state: any) => state.needRouteMatch === false)).toBe(true);
  });

  test("TO_LEFT_MATCH additionally requires a routing match", async () => {
    await listener(
      { menuItemId: Menus.IDS.TABSTRIP.TO_LEFT_MATCH },
      { id: 2, index: 1, windowId: 7 },
    );
    await vi.advanceTimersByTimeAsync(2000);

    expect(downloads().map((state: any) => state.info.currentTab.id)).toEqual([1, 2]);
    expect(downloads().every((state: any) => state.needRouteMatch === true)).toBe(true);
  });

  test("TO_RIGHT_MATCH additionally requires a routing match", async () => {
    await listener(
      { menuItemId: Menus.IDS.TABSTRIP.TO_RIGHT_MATCH },
      { id: 1, index: 0, windowId: 7 },
    );
    await vi.advanceTimersByTimeAsync(2000);

    expect(downloads()).toHaveLength(2);
    expect(downloads().every((s: any) => s.needRouteMatch === true)).toBe(true);
  });

  test("OPENED_FROM_TAB queries for children of the clicked tab", async () => {
    await listener({ menuItemId: Menus.IDS.TABSTRIP.OPENED_FROM_TAB }, fromTab);
    await vi.advanceTimersByTimeAsync(2000);

    expect(global.browser.tabs.query).toHaveBeenCalledWith(
      expect.objectContaining({ openerTabId: 2 }),
    );
    expect(downloads()).toHaveLength(2);
  });

  test("shortcutTab saves tabs as shortcut files", async () => {
    options.shortcutTab = true;

    await listener({ menuItemId: Menus.IDS.TABSTRIP.SELECTED_TAB }, fromTab);
    await vi.advanceTimersByTimeAsync(2000);

    expect(vi.mocked(makeShortcut)).toHaveBeenCalledWith(
      "HTML_REDIRECT",
      "https://b.test/two",
      "Two",
    );
    expect(vi.mocked(suggestShortcutFilename)).toHaveBeenCalledWith(
      "HTML_REDIRECT",
      DOWNLOAD_TYPES.TAB,
      expect.objectContaining({ menuItemId: Menus.IDS.TABSTRIP.SELECTED_TAB }),
      "Two",
      240,
    );
    expect(downloads()[0]!.info.url).toBe("blob:mock-shortcut");
    expect(downloads()[0]!.info.suggestedFilename).toBe("shortcut.url");
  });

  test("handles tabstrip clicks when init already completed (no pending Runtime.ready)", async () => {
    delete Runtime.ready;

    await listener({ menuItemId: Menus.IDS.TABSTRIP.SELECTED_TAB }, fromTab);
    await vi.advanceTimersByTimeAsync(2000);

    expect(downloads()).toHaveLength(1);
  });

  test("shortcutTab falls back to the url for tabs without a title", async () => {
    options.shortcutTab = true;
    (global.browser.tabs as any).query = vi.fn(() =>
      Promise.resolve([{ id: 9, index: 0, url: "https://c.test/nine" }]),
    );

    await listener(
      { menuItemId: Menus.IDS.TABSTRIP.SELECTED_TAB },
      { id: 9, index: 0, windowId: 7 },
    );
    await vi.advanceTimersByTimeAsync(2000);

    expect(vi.mocked(makeShortcut)).toHaveBeenCalledWith(
      "HTML_REDIRECT",
      "https://c.test/nine",
      "https://c.test/nine",
    );
    expect(vi.mocked(suggestShortcutFilename)).toHaveBeenCalledWith(
      "HTML_REDIRECT",
      DOWNLOAD_TYPES.TAB,
      expect.anything(),
      undefined,
      240,
    );
  });

  test("closeTabOnSave removes each tab only after its save is accepted", async () => {
    options.closeTabOnSave = true;

    await listener({ menuItemId: Menus.IDS.TABSTRIP.SELECTED_TAB }, fromTab);

    expect(downloads()).toHaveLength(1);
    expect(global.browser.tabs.remove).toHaveBeenCalledWith(2);
  });

  test("a matched rule can close a saved tab without the global option", async () => {
    options.closeTabOnSave = false;
    vi.mocked(Download.launchDownload).mockImplementationOnce(
      async (state: DownloadPipelineState) => {
        state.scratch.routeTabAction = "close";
        return { status: "started", downloadId: 1 };
      },
    );

    await listener({ menuItemId: Menus.IDS.TABSTRIP.SELECTED_TAB }, fromTab);

    expect(global.browser.tabs.remove).toHaveBeenCalledOnce();
    expect(global.browser.tabs.remove).toHaveBeenCalledWith(2);
  });

  test("closeTabOnSave keeps a tab whose save is skipped", async () => {
    options.closeTabOnSave = true;
    vi.mocked(Download.launchDownload).mockResolvedValueOnce({ status: "skipped" });

    await listener({ menuItemId: Menus.IDS.TABSTRIP.SELECTED_TAB }, fromTab);

    expect(global.browser.tabs.remove).not.toHaveBeenCalled();
  });

  test("closeTabOnSave skips a host tab without an id", async () => {
    options.closeTabOnSave = true;
    (global.browser.tabs as any).query = vi.fn(() =>
      Promise.resolve([{ index: 0, url: "https://no-id.test/", title: "No id" }]),
    );

    await listener({ menuItemId: Menus.IDS.TABSTRIP.SELECTED_MULTIPLE_TABS }, fromTab);

    expect(downloads()).toHaveLength(1);
    expect(global.browser.tabs.remove).not.toHaveBeenCalled();
  });

  test("a tab-close failure does not abort the remaining batch", async () => {
    options.closeTabOnSave = true;
    vi.mocked(global.browser.tabs.remove).mockRejectedValueOnce(new Error("tab already closed"));

    await listener({ menuItemId: Menus.IDS.TABSTRIP.SELECTED_MULTIPLE_TABS }, fromTab);

    expect(downloads().map((s: any) => s.info.currentTab.id)).toEqual([1, 2]);
    expect(global.browser.tabs.remove).toHaveBeenCalledTimes(2);
  });

  test("contains a tab query failure", async () => {
    vi.mocked(global.browser.tabs.query).mockRejectedValueOnce(new Error("window closed"));

    await expect(
      listener({ menuItemId: Menus.IDS.TABSTRIP.SELECTED_TAB }, fromTab),
    ).resolves.toBeUndefined();
    expect(downloads()).toHaveLength(0);
  });
});

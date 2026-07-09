// Context menu click handling: listeners are registered synchronously at
// service worker startup and must wait for async init before acting

const constants = (await import("../src/constants.js")).default;

Object.assign(global, constants);
global.Path = (await import("../src/path.js")).default;

global.BROWSER_FEATURES = { accessKeys: false, multitab: false };

const setupBrowserMocks = () => {
  global.currentTab = null;
  // Declared by notification.js in the browser's shared global scope;
  // src files are strict mode under vitest's ESM transform
  global.requestedDownloadFlag = 0;
  global.browser.contextMenus = {
    create: jest.fn(),
    update: jest.fn(),
    removeAll: jest.fn(() => Promise.resolve()),
    onClicked: { addListener: jest.fn() },
  };
  global.browser.runtime.openOptionsPage = jest.fn();
  global.browser.downloads.showDefaultFolder = jest.fn();
  global.browser.storage.local.set = jest.fn(() => Promise.resolve());
  global.Download = {
    renameAndDownload: jest.fn(),
    makeObjectUrl: jest.fn(() => "data:text/plain;base64,eA=="),
  };
  global.Notification = { createExtensionNotification: jest.fn() };
  global.options = {
    links: true,
    selection: true,
    page: true,
    enableLastLocation: true,
    enableNumberedItems: false,
    truncateLength: 240,
    preferLinks: false,
    preferLinksFilterEnabled: false,
    shortcutMedia: false,
    shortcutLink: false,
    shortcutPage: false,
  };
};

describe("addDownloadListener", () => {
  let Menus;
  let listener;

  beforeEach(async () => {
    jest.resetModules();
    setupBrowserMocks();
    window.ready = Promise.resolve();
    delete window.lastDownloadState;

    Menus = (await import("../src/menu.js")).default;
    Menus.addDownloadListener();
    [[listener]] = global.browser.contextMenus.onClicked.addListener.mock.calls;
  });

  test("registers the listener synchronously (MV3 requirement)", () => {
    expect(
      global.browser.contextMenus.onClicked.addListener
    ).toHaveBeenCalledTimes(1);
  });

  test("opens the options page for the options item", async () => {
    await listener({ menuItemId: "options" });
    expect(global.browser.runtime.openOptionsPage).toHaveBeenCalled();
    expect(global.Download.renameAndDownload).not.toHaveBeenCalled();
  });

  test("shows the default folder for show-default-folder", async () => {
    await listener({ menuItemId: "show-default-folder" });
    expect(global.browser.downloads.showDefaultFolder).toHaveBeenCalled();
  });

  test("ignores tabstrip menu items", async () => {
    await listener({ menuItemId: Menus.IDS.TABSTRIP.SELECTED_TAB });
    expect(global.Download.renameAndDownload).not.toHaveBeenCalled();
  });

  test("waits for init (window.ready) before handling a download click", async () => {
    let resolveReady;
    window.ready = new Promise((res) => {
      resolveReady = res;
    });

    Menus.addPaths(["dir1"], ["link"]);
    const pending = listener({
      menuItemId: "save-in-0",
      linkUrl: "https://example.com/f.png",
      pageUrl: "https://example.com/",
    });

    await Promise.resolve();
    expect(global.Download.renameAndDownload).not.toHaveBeenCalled();

    resolveReady();
    await pending;
    expect(global.Download.renameAndDownload).toHaveBeenCalledTimes(1);
  });

  test("path click downloads and persists lastUsedPath", async () => {
    Menus.addPaths(["dir1"], ["link"]);

    await listener({
      menuItemId: "save-in-0",
      linkUrl: "https://example.com/f.png",
      pageUrl: "https://example.com/",
    });

    expect(global.Download.renameAndDownload).toHaveBeenCalledTimes(1);
    const state = global.Download.renameAndDownload.mock.calls[0][0];
    expect(state.info.url).toBe("https://example.com/f.png");

    expect(global.browser.storage.local.set).toHaveBeenCalledWith({
      lastUsedPath: "dir1",
    });
  });

  test("uses the clicked tab for page title, not the stale global (#172/#188)", async () => {
    // The global can point at another window's tab (or be mutated later)
    global.currentTab = { id: 99, title: "Some Other Tab" };

    Menus.addPaths(["dir1"], ["link"]);
    await listener(
      {
        menuItemId: "save-in-0",
        linkUrl: "https://example.com/f.png",
        pageUrl: "https://example.com/",
      },
      { id: 5, title: "Clicked Tab" }
    );

    const state = global.Download.renameAndDownload.mock.calls[0][0];
    expect(state.info.currentTab.title).toBe("Clicked Tab");
  });

  test("falls back to the tracked tab when the event has no tab", async () => {
    global.currentTab = { id: 99, title: "Tracked Tab" };

    Menus.addPaths(["dir1"], ["link"]);
    await listener({
      menuItemId: "save-in-0",
      linkUrl: "https://example.com/f.png",
      pageUrl: "https://example.com/",
    });

    const state = global.Download.renameAndDownload.mock.calls[0][0];
    expect(state.info.currentTab.title).toBe("Tracked Tab");
  });

  test("last-used click survives a missing lastDownloadState (SW restart)", async () => {
    Menus.addPaths(["dir1"], ["link"]);
    await listener({
      menuItemId: "save-in-0",
      linkUrl: "https://example.com/f.png",
      pageUrl: "https://example.com/",
    });

    // window.lastDownloadState is gone after a service worker restart
    await expect(
      listener({
        menuItemId: Menus.IDS.LAST_USED,
        linkUrl: "https://example.com/g.png",
        pageUrl: "https://example.com/",
      })
    ).resolves.not.toThrow();

    expect(global.Download.renameAndDownload).toHaveBeenCalledTimes(2);
  });
});

describe("addTabMenuListener", () => {
  test("registers a synchronous listener that ignores non-tabstrip items", async () => {
    jest.resetModules();
    setupBrowserMocks();
    global.browser.tabs = { query: jest.fn(() => Promise.resolve([])) };
    window.ready = Promise.resolve();

    const Menus = (await import("../src/menu.js")).default;
    Menus.addTabMenuListener();
    const [[listener]] =
      global.browser.contextMenus.onClicked.addListener.mock.calls;

    await listener({ menuItemId: "save-in-0" }, { windowId: 1 });
    expect(global.browser.tabs.query).not.toHaveBeenCalled();

    await listener(
      { menuItemId: Menus.IDS.TABSTRIP.SELECTED_TAB },
      { windowId: 1, id: 5, index: 0 }
    );
    expect(global.browser.tabs.query).toHaveBeenCalled();
  });
});

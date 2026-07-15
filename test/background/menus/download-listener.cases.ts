import {
  DOWNLOAD_TYPES,
  options,
  Download,
  Notifier,
  Shortcut,
  setCurrentTab,
  Runtime,
  setupBrowserMocks,
  importMenus,
  type MenusFixture,
  type TestMenuListener,
} from "./listeners.fixture.ts";

describe("addDownloadListener", () => {
  let Menus: MenusFixture;
  let listener: TestMenuListener;

  beforeEach(async () => {
    vi.restoreAllMocks();
    setupBrowserMocks();
    Menus = await importMenus();
    Runtime.ready = Promise.resolve();
    delete Runtime.lastDownloadState;
    Menus.addDownloadListener();
    [listener] = vi.mocked(global.browser.contextMenus.onClicked.addListener).mock.calls[0]!;
  });

  test("registers the listener synchronously (MV3 requirement)", () => {
    expect(global.browser.contextMenus.onClicked.addListener).toHaveBeenCalledTimes(1);
  });

  test("opens the options page for the options item", async () => {
    await listener({ menuItemId: Menus.IDS.OPTIONS });
    expect(global.browser.runtime.openOptionsPage).toHaveBeenCalled();
    expect(Download.renameAndDownload).not.toHaveBeenCalled();
  });

  test("shows the default folder for show-default-folder", async () => {
    await listener({ menuItemId: Menus.IDS.SHOW_DEFAULT_FOLDER });
    expect(global.browser.downloads.showDefaultFolder).toHaveBeenCalled();
  });

  test("keeps the Page Sources toggle alive until its tab message completes", async () => {
    let finishSend!: () => void;
    const send = new Promise<void>((resolve) => {
      finishSend = resolve;
    });
    (global.browser.tabs as any).sendMessage = vi.fn(() => send);

    const pending = Promise.resolve(
      listener({ menuItemId: Menus.IDS.TOGGLE_SOURCE_PANEL }, { id: 17 }),
    );
    const settled = vi.fn();
    void pending.then(settled);
    await Promise.resolve();
    await Promise.resolve();
    const settledBeforeSend = settled.mock.calls.length > 0;

    finishSend();
    await pending;

    expect(settledBeforeSend).toBe(false);
    expect(global.browser.tabs.sendMessage).toHaveBeenCalledWith(17, {
      type: "TOGGLE_SOURCE_PANEL",
      body: { force: true },
    });
  });

  test("ignores a Page Sources toggle without a usable tab id", async () => {
    vi.mocked(global.browser.tabs.sendMessage).mockClear();
    await listener({ menuItemId: Menus.IDS.TOGGLE_SOURCE_PANEL }, {});
    expect(global.browser.tabs.sendMessage).not.toHaveBeenCalled();
  });

  test("ignores tabstrip menu items", async () => {
    await listener({ menuItemId: Menus.IDS.TABSTRIP.SELECTED_TAB });
    expect(Download.renameAndDownload).not.toHaveBeenCalled();
  });

  test("ignores stale path menu identifiers", async () => {
    await listener({
      menuItemId: "save-in-999",
      linkUrl: "https://example.com/stale.png",
      pageUrl: "https://example.com/",
    });
    expect(Download.renameAndDownload).not.toHaveBeenCalled();
  });

  test("carries a destination Save As preference into the download plan", async () => {
    Menus.addPaths(["images // (dialog: true)"], ["image"]);

    await listener({
      menuItemId: "save-in-0",
      mediaType: "image",
      srcUrl: "https://example.com/cat.png",
      pageUrl: "https://example.com/",
    });

    expect(Download.renameAndDownload).toHaveBeenCalledWith(
      expect.objectContaining({ info: expect.objectContaining({ forcePrompt: true }) }),
    );
  });

  test("starts a source-link sidecar after a media download", async () => {
    options.saveSourceSidecar = true;
    Menus.addPaths(["images"], ["image"]);

    await listener({
      menuItemId: "save-in-0",
      mediaType: "image",
      srcUrl: "https://example.com/cat.png",
      pageUrl: "https://example.com/",
    });

    expect(Download.renameAndDownload).toHaveBeenCalledTimes(2);
    expect(Download.renameAndDownload).toHaveBeenLastCalledWith(
      expect.objectContaining({
        info: expect.objectContaining({
          context: DOWNLOAD_TYPES.SIDECAR,
          sourceUrl: "https://example.com/cat.png",
          routingDisabled: true,
          suppressPrompt: true,
        }),
      }),
    );
  });

  test("never writes a source sidecar for a private media save", async () => {
    options.saveSourceSidecar = true;
    Menus.addPaths(["images"], ["image"]);

    await listener(
      {
        menuItemId: "save-in-0",
        mediaType: "image",
        srcUrl: "https://example.com/private-cat.png",
        pageUrl: "https://private.example/gallery/",
      },
      { id: 8, title: "Private gallery", incognito: true },
    );

    expect(Download.renameAndDownload).toHaveBeenCalledOnce();
    expect(Download.renameAndDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        info: expect.objectContaining({ context: DOWNLOAD_TYPES.MEDIA }),
      }),
    );
  });

  test("contains source-link sidecar preparation failures", async () => {
    options.saveSourceSidecar = true;
    Menus.addPaths(["images"], ["image"]);
    vi.spyOn(Shortcut, "sourceSidecarPath").mockImplementation(() => {
      throw new Error("cannot prepare sidecar");
    });

    await expect(
      listener({
        menuItemId: "save-in-0",
        mediaType: "image",
        srcUrl: "https://example.com/cat.png",
        pageUrl: "https://example.com/",
      }),
    ).resolves.toBeUndefined();
  });

  test("waits for init (Runtime.ready) before handling a download click", async () => {
    let resolveReady!: (value?: unknown) => void;
    Runtime.ready = new Promise((res) => {
      resolveReady = res;
    });

    Menus.addPaths(["dir1"], ["link"]);
    const pending = listener({
      menuItemId: "save-in-0",
      linkUrl: "https://example.com/f.png",
      pageUrl: "https://example.com/",
    });

    await Promise.resolve();
    expect(Download.renameAndDownload).not.toHaveBeenCalled();

    resolveReady();
    await pending;
    expect(Download.renameAndDownload).toHaveBeenCalledTimes(1);
  });

  test("path click downloads and persists lastUsedPath", async () => {
    Menus.addPaths(["dir1"], ["link"]);

    await listener({
      menuItemId: "save-in-0",
      linkUrl: "https://example.com/f.png",
      pageUrl: "https://example.com/",
    });

    expect(Download.renameAndDownload).toHaveBeenCalledTimes(1);
    const state = Download.renameAndDownload.mock.calls[0]![0]!;
    expect(state.info.url).toBe("https://example.com/f.png");

    expect(global.browser.storage.local.set).toHaveBeenCalledWith({
      lastUsedPath: "dir1",
      lastUsedMeta: { comment: expect.anything(), menuIndex: expect.anything(), title: "dir1" },
    });
  });

  test.each([
    { recentDestinationCount: 0, rebuilds: false },
    { recentDestinationCount: 3, rebuilds: true },
  ])(
    "rebuilds menus after a save only when recent destinations are visible ($recentDestinationCount)",
    async ({ recentDestinationCount, rebuilds }) => {
      options.recentDestinationCount = recentDestinationCount;
      Menus.addPaths(["dir1"], ["link"]);

      await listener({
        menuItemId: "save-in-0",
        linkUrl: "https://example.com/f.png",
        pageUrl: "https://example.com/",
      });

      expect(global.browser.contextMenus.removeAll).toHaveBeenCalledTimes(rebuilds ? 1 : 0);
    },
  );

  test("does not rebuild menus when saving to the unchanged most-recent destination", async () => {
    options.recentDestinationCount = 3;
    options.paths = "dir1";
    Menus.addPaths(["dir1"], ["link"]);
    const click = {
      menuItemId: "save-in-0",
      linkUrl: "https://example.com/f.png",
      pageUrl: "https://example.com/",
    };

    await listener(click);
    await listener(click);

    expect(global.browser.contextMenus.removeAll).toHaveBeenCalledTimes(1);
  });

  test("a private path click does not publish last-used state or menu UI", async () => {
    Menus.addPaths(["private/path"], ["link"]);

    await listener(
      {
        menuItemId: "save-in-0",
        linkUrl: "https://example.com/private.png",
        pageUrl: "https://example.com/",
      },
      { id: 8, incognito: true },
    );

    expect(Menus.state.lastUsedPath).toBeNull();
    expect(global.browser.storage.local.set).not.toHaveBeenCalled();
    expect(global.browser.contextMenus.update).not.toHaveBeenCalled();
  });

  test("keeps the event handler alive until last-used persistence completes", async () => {
    let finishWrite!: () => void;
    vi.mocked(global.browser.storage.local.set).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishWrite = resolve;
      }) as any,
    );
    Menus.addPaths(["dir1"], ["link"]);
    let handled = false;

    const pending = (
      listener({
        menuItemId: "save-in-0",
        linkUrl: "https://example.com/f.png",
        pageUrl: "https://example.com/",
      }) as unknown as Promise<void>
    ).then(() => {
      handled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(handled).toBe(false);

    finishWrite();
    await pending;
    expect(handled).toBe(true);
  });

  test("uses the clicked tab for page title, not the stale global (#172/#188)", async () => {
    // The global can point at another window's tab (or be mutated later)
    setCurrentTab({ id: 99, title: "Some Other Tab" });

    Menus.addPaths(["dir1"], ["link"]);
    await listener(
      {
        menuItemId: "save-in-0",
        linkUrl: "https://example.com/f.png",
        pageUrl: "https://example.com/",
      },
      { id: 5, title: "Clicked Tab" },
    );

    const state = Download.renameAndDownload.mock.calls[0]![0]!;
    expect(state.info.currentTab.title).toBe("Clicked Tab");
  });

  test("falls back to the tracked tab when the event has no tab", async () => {
    setCurrentTab({ id: 99, title: "Tracked Tab" });

    Menus.addPaths(["dir1"], ["link"]);
    await listener({
      menuItemId: "save-in-0",
      linkUrl: "https://example.com/f.png",
      pageUrl: "https://example.com/",
    });

    const state = Download.renameAndDownload.mock.calls[0]![0]!;
    expect(state.info.currentTab.title).toBe("Tracked Tab");
  });

  test("last-used click survives a missing lastDownloadState (SW restart)", async () => {
    Menus.addPaths(["dir1"], ["link"]);
    await listener({
      menuItemId: "save-in-0",
      linkUrl: "https://example.com/f.png",
      pageUrl: "https://example.com/",
    });

    // Runtime.lastDownloadState is gone after a service worker restart
    await expect(
      listener({
        menuItemId: Menus.IDS.LAST_USED,
        linkUrl: "https://example.com/g.png",
        pageUrl: "https://example.com/",
      }),
    ).resolves.not.toThrow();

    expect(Download.renameAndDownload).toHaveBeenCalledTimes(2);
  });

  const lastState = () => vi.mocked(Download.renameAndDownload).mock.calls.at(-1)![0];

  const mediaClick = {
    menuItemId: "save-in-0",
    mediaType: "image",
    srcUrl: "https://example.com/i.png",
    linkUrl: "https://example.com/gallery.html",
    pageUrl: "https://example.com/page",
    frameUrl: "https://example.com/frame",
  };

  test("preserves context-menu fields used by media and frame matchers", async () => {
    Menus.addPaths(["dir1"], ["image"]);

    await listener(mediaClick, { id: 5, title: "Gallery" });

    expect(lastState().info).toMatchObject({
      mediaType: "image",
      frameUrl: "https://example.com/frame",
      sourceUrl: "https://example.com/i.png",
    });
  });

  test("handles a click when init already completed (no pending Runtime.ready)", async () => {
    delete Runtime.ready;

    Menus.addPaths(["dir1"], ["link"]);
    await listener({
      menuItemId: "save-in-0",
      linkUrl: "https://example.com/f.png",
      pageUrl: "https://example.com/",
    });

    expect(Download.renameAndDownload).toHaveBeenCalledTimes(1);
  });

  test("ignores clicks on ids without a path mapping (separators)", async () => {
    Menus.addPaths(["dir1"], ["link"]);
    await listener({ menuItemId: "separator-0", pageUrl: "https://example.com/" });
    expect(Download.renameAndDownload).not.toHaveBeenCalled();
  });

  test("turns selection targets into object URLs before delegating", async () => {
    Menus.addPaths(["dir1"], ["selection"]);
    await listener(
      {
        menuItemId: "save-in-0",
        selectionText: "hello world",
        pageUrl: "https://example.com/",
      },
      { id: 5, title: "Page Title" },
    );

    expect(Download.makeObjectUrl).toHaveBeenCalledWith("hello world");
    expect(lastState().info).toMatchObject({
      url: "data:text/plain;base64,eA==",
      context: DOWNLOAD_TYPES.SELECTION,
      suggestedFilename: "Page Title.selection.txt",
    });
  });

  test("reports an invalid prefer-links filter without blocking media saves", async () => {
    options.preferLinksFilterEnabled = true;
    options.preferLinksFilter = "[";
    Menus.addPaths(["dir1"], ["image"]);

    await listener(mediaClick);

    expect(Notifier.createExtensionNotification).toHaveBeenCalledWith(
      "Translated<notificationBadPreferLinksPattern>",
      expect.stringContaining("Invalid regular expression"),
      undefined,
      "prefer-links-pattern-error",
    );
    expect(lastState().info).toMatchObject({
      url: "https://example.com/i.png",
      context: DOWNLOAD_TYPES.MEDIA,
    });
  });

  test("reports a preferred link and normalizes optional context-menu metadata", async () => {
    options.preferLinks = true;
    options.notifyOnLinkPreferred = true;
    Menus.addPaths(["dir1"], ["image"]);

    await listener({
      ...mediaClick,
      linkText: "Gallery link",
      modifiers: ["Shift", 7, "Ctrl"],
    });

    expect(Notifier.createExtensionNotification).toHaveBeenCalledWith(
      "Translated<notificationLinkPreferred>",
      "https://example.com/gallery.html",
      undefined,
      "link-preferred",
    );
    expect(lastState().info).toMatchObject({
      linkText: "Gallery link",
      modifiers: ["Shift", "Ctrl"],
    });
  });

  test("contains a media menu event whose source URL disappeared", async () => {
    Menus.addPaths(["dir1"], ["image"]);
    await listener({ menuItemId: "save-in-0", mediaType: "image" });
    expect(Download.renameAndDownload).not.toHaveBeenCalled();
  });

  test("bails out when the click has nothing downloadable", async () => {
    options.selection = false;
    options.page = false;

    Menus.addPaths(["dir1"], ["page"]);
    await listener({ menuItemId: "save-in-0", pageUrl: "https://example.com/" });

    expect(Download.renameAndDownload).not.toHaveBeenCalled();
  });

  test("closeTabOnSave removes the tab only after the browser accepts a page save", async () => {
    options.closeTabOnSave = true;
    (global.browser as any).tabs = { remove: vi.fn() };

    Menus.addPaths(["dir1"], ["page"]);
    await listener(
      { menuItemId: "save-in-0", pageUrl: "https://example.com/" },
      { id: 42, title: "Title" },
    );

    expect(global.browser.tabs.remove).toHaveBeenCalledWith(42);
  });

  test("a page-save tab-close race does not reject the menu handler", async () => {
    options.closeTabOnSave = true;
    (global.browser as any).tabs = {
      remove: vi.fn(() => Promise.reject(new Error("tab already closed"))),
    };
    Menus.addPaths(["dir1"], ["page"]);

    await expect(
      listener(
        { menuItemId: "save-in-0", pageUrl: "https://example.com/" },
        { id: 42, title: "Title" },
      ),
    ).resolves.toBeUndefined();
  });

  test("closeTabOnSave keeps the tab when a page save fails", async () => {
    options.closeTabOnSave = true;
    (global.browser as any).tabs = { remove: vi.fn() };
    vi.mocked(Download.renameAndDownload).mockResolvedValueOnce({ status: "failed" });
    Menus.addPaths(["dir1"], ["page"]);

    await listener(
      { menuItemId: "save-in-0", pageUrl: "https://example.com/" },
      { id: 42, title: "Title" },
    );

    expect(global.browser.tabs.remove).not.toHaveBeenCalled();
  });

  test("a failed save does not replace the last-used location", async () => {
    vi.mocked(Download.renameAndDownload).mockResolvedValueOnce({ status: "failed" });
    Menus.addPaths(["dir1"], ["link"]);

    await listener({
      menuItemId: "save-in-0",
      linkUrl: "https://example.com/f.png",
      pageUrl: "https://example.com/",
    });

    expect(Menus.state.lastUsedPath).toBeNull();
    expect(global.browser.storage.local.set).not.toHaveBeenCalled();
    expect(global.browser.contextMenus.update).not.toHaveBeenCalled();
  });

  test("does not close the tab for a non-page save even with closeTabOnSave", async () => {
    vi.useFakeTimers();
    try {
      options.closeTabOnSave = true;
      (global.browser as any).tabs = { remove: vi.fn() };

      Menus.addPaths(["dir1"], ["link"]);
      await listener(
        {
          menuItemId: "save-in-0",
          linkUrl: "https://example.com/f.png",
          pageUrl: "https://example.com/",
        },
        { id: 42, title: "Title" },
      );

      await vi.advanceTimersByTimeAsync(1000);
      expect(global.browser.tabs.remove).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test("route-exclusive clicks download into the routing root", async () => {
    await listener({
      menuItemId: Menus.IDS.ROUTE_EXCLUSIVE,
      linkUrl: "https://example.com/f.png",
      pageUrl: "https://example.com/",
    });

    expect(lastState().path.raw).toBe(".");
    expect(lastState().info.url).toBe("https://example.com/f.png");
    expect(lastState().needRouteMatch).toBe(true);
    // Route-exclusive clicks do not update the last used path
    expect(global.browser.storage.local.set).not.toHaveBeenCalled();
  });

  test("last-used clicks reuse the previous path, comment and menu index", async () => {
    Menus.addPaths(["dir1 // route-comment"], ["link"]);
    await listener({
      menuItemId: "save-in-0",
      linkUrl: "https://example.com/f.png",
      pageUrl: "https://example.com/",
    });

    // A restart-survivor fixture: only the fields the handler reads are set,
    // so cast past the full DownloadState shape.
    Runtime.lastDownloadState = { info: { comment: "0route_comment", menuIndex: "1" } } as any;

    await listener({
      menuItemId: Menus.IDS.LAST_USED,
      linkUrl: "https://example.com/g.png",
      pageUrl: "https://example.com/",
    });

    expect(lastState().path.raw).toBe("dir1");
    expect(lastState().info.comment).toBe("0route_comment");
    expect(lastState().info.menuIndex).toBe("1");
  });

  test("last-used metadata stays paired with its path after an unrelated download", async () => {
    Menus.setLastUsed("kept/path", { comment: "kept-comment", menuIndex: "2.1" });
    Runtime.lastDownloadState = {
      path: {},
      scratch: {},
      info: { comment: "unrelated-comment", menuIndex: "9" },
    } as any;

    await listener({
      menuItemId: Menus.IDS.LAST_USED,
      linkUrl: "https://example.com/file.png",
      pageUrl: "https://example.com/",
    });

    expect(lastState().path.raw).toBe("kept/path");
    expect(lastState().info.comment).toBe("kept-comment");
    expect(lastState().info.menuIndex).toBe("2.1");
  });

  test("last-used clicks tolerate legacy state without paired metadata", async () => {
    Menus.state.lastUsedPath = "legacy/path";
    Menus.state.lastUsedMeta = null;
    await listener({
      menuItemId: Menus.IDS.LAST_USED,
      linkUrl: "https://example.com/file.png",
      pageUrl: "https://example.com/",
    });

    expect(lastState().path.raw).toBe("legacy/path");
    expect(lastState().info.menuIndex).toBeUndefined();
  });

  test("ignores a stale Last used click when no path was restored", async () => {
    await listener({
      menuItemId: Menus.IDS.LAST_USED,
      linkUrl: "https://example.com/file.png",
      pageUrl: "https://example.com/",
    });
    expect(Download.renameAndDownload).not.toHaveBeenCalled();
  });

  describe("last used menu bookkeeping", () => {
    const pathClick = {
      menuItemId: "save-in-0",
      linkUrl: "https://example.com/f.png",
      pageUrl: "https://example.com/",
    };

    test("path clicks refresh the last-used item title", async () => {
      Menus.addPaths(["dir1"], ["link"]);
      await listener(pathClick);

      expect(global.browser.contextMenus.update).toHaveBeenCalledWith(Menus.IDS.LAST_USED, {
        title: "dir1",
        enabled: true,
      });
    });

    test("the last-used title gets an access key where supported", async () => {
      options.keyLastUsed = "x";

      Menus.addPaths(["dir1"], ["link"]);
      await listener(pathClick);

      expect(global.browser.contextMenus.update).toHaveBeenCalledWith(Menus.IDS.LAST_USED, {
        title: "dir1 (&x)",
        enabled: true,
      });
    });

    test("falls back to the path when the clicked item has an empty alias", async () => {
      Menus.addPaths(["dir1 // (alias: )"], ["link"]);
      Menus.pathMappings["save-in-0"]!.title = "";
      await listener(pathClick);

      expect(global.browser.contextMenus.update).toHaveBeenCalledWith(Menus.IDS.LAST_USED, {
        title: "dir1",
        enabled: true,
      });
    });

    test("no last-used refresh when the feature is disabled", async () => {
      options.enableLastLocation = false;

      Menus.addPaths(["dir1"], ["link"]);
      await listener(pathClick);

      expect(global.browser.contextMenus.update).not.toHaveBeenCalled();
    });

    test("addLastUsed creates an enabled item once a path has been used", async () => {
      Menus.addPaths(["dir1"], ["link"]);
      await listener(pathClick);
      vi.mocked(global.browser.contextMenus.create).mockClear();

      Menus.addLastUsed(["link"]);

      expect(global.browser.contextMenus.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: Menus.IDS.LAST_USED,
          title: "dir1",
          enabled: true,
        }),
      );
    });

    test("preserves an aliased last-used title across persistence and rebuild", async () => {
      Menus.addPaths(["dir1 // (alias: Friendly folder)"], ["link"]);
      await listener(pathClick);
      vi.mocked(global.browser.contextMenus.create).mockClear();

      Menus.restoreLastUsed({
        lastUsedPath: "dir1",
        lastUsedMeta: {
          comment: "0(alias: Friendly folder)",
          menuIndex: "1",
          title: "Friendly folder",
        },
      });
      Menus.addLastUsed(["link"]);

      expect(global.browser.contextMenus.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: Menus.IDS.LAST_USED,
          title: "Friendly folder",
          enabled: true,
        }),
      );
    });
  });

  describe("shortcut downloads", () => {
    test("media clicks can save shortcuts instead of the media", async () => {
      options.shortcutMedia = true;

      Menus.addPaths(["dir1"], ["image"]);
      await listener(mediaClick);

      expect(Shortcut.makeShortcut).toHaveBeenCalledWith(
        "HTML_REDIRECT",
        "https://example.com/i.png",
      );
      expect(Shortcut.suggestShortcutFilename).toHaveBeenCalledWith(
        "HTML_REDIRECT",
        DOWNLOAD_TYPES.MEDIA,
        mediaClick,
        null,
        240,
      );
      expect(lastState().info.url).toBe("blob:mock-shortcut");
      expect(lastState().info.suggestedFilename).toBe("shortcut.url");
    });

    test("link clicks can save shortcuts", async () => {
      options.shortcutLink = true;

      Menus.addPaths(["dir1"], ["link"]);
      await listener({
        menuItemId: "save-in-0",
        linkUrl: "https://example.com/f.png",
        pageUrl: "https://example.com/",
      });

      expect(Shortcut.makeShortcut).toHaveBeenCalledWith(
        "HTML_REDIRECT",
        "https://example.com/f.png",
      );
      expect(lastState().info.url).toBe("blob:mock-shortcut");
    });

    test("page clicks can save shortcuts", async () => {
      options.shortcutPage = true;

      Menus.addPaths(["dir1"], ["page"]);
      await listener(
        { menuItemId: "save-in-0", pageUrl: "https://example.com/" },
        { id: 5, title: "Title" },
      );

      expect(Shortcut.makeShortcut).toHaveBeenCalledWith("HTML_REDIRECT", "https://example.com/");
      expect(lastState().info.url).toBe("blob:mock-shortcut");
      expect(lastState().info.suggestedFilename).toBe("shortcut.url");
    });
  });
});

// The click handler's tangled "what does this click save?" decision, extracted
// as a pure function so its branches are testable without driving a browser.

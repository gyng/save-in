import {
  DOWNLOAD_TYPES,
  options,
  Download,
  Notifier,
  makeShortcut,
  suggestShortcutFilename,
  sourceSidecarPath,
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
    expect(Download.launchDownload).not.toHaveBeenCalled();
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
    expect(Download.launchDownload).not.toHaveBeenCalled();
  });

  test("ignores stale path menu identifiers", async () => {
    await listener({
      menuItemId: "save-in-999",
      linkUrl: "https://example.com/stale.png",
      pageUrl: "https://example.com/",
    });
    expect(Download.launchDownload).not.toHaveBeenCalled();
  });

  test("carries a destination Save As preference into the download plan", async () => {
    Menus.addPaths(["images // (dialog: true)"], ["image"]);

    await listener({
      menuItemId: "save-in-0",
      mediaType: "image",
      srcUrl: "https://example.com/cat.png",
      pageUrl: "https://example.com/",
    });

    expect(Download.launchDownload).toHaveBeenCalledWith(
      expect.objectContaining({ info: expect.objectContaining({ forcePrompt: true }) }),
    );
  });

  test("attaches a deferred source-link sidecar to a media download", async () => {
    options.saveSourceSidecar = true;
    Menus.addPaths(["images"], ["image"]);

    await listener({
      menuItemId: "save-in-0",
      mediaType: "image",
      srcUrl: "https://example.com/cat.png",
      pageUrl: "https://example.com/",
    });

    expect(Download.launchDownload).toHaveBeenCalledOnce();
    expect(Download.launchDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        scratch: expect.objectContaining({
          sourceSidecar: expect.objectContaining({
            pageUrl: "https://example.com/",
            sourceUrl: "https://example.com/cat.png",
          }),
        }),
        info: expect.objectContaining({
          context: DOWNLOAD_TYPES.MEDIA,
          sourceUrl: "https://example.com/cat.png",
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

    expect(Download.launchDownload).toHaveBeenCalledOnce();
    expect(Download.launchDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        info: expect.objectContaining({ context: DOWNLOAD_TYPES.MEDIA }),
      }),
    );
  });

  test("does not prepare the source-link sidecar before the primary completes", async () => {
    options.saveSourceSidecar = true;
    Menus.addPaths(["images"], ["image"]);
    await expect(
      listener({
        menuItemId: "save-in-0",
        mediaType: "image",
        srcUrl: "https://example.com/cat.png",
        pageUrl: "https://example.com/",
      }),
    ).resolves.toBeUndefined();
    expect(vi.mocked(sourceSidecarPath)).not.toHaveBeenCalled();
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
    expect(Download.launchDownload).not.toHaveBeenCalled();

    resolveReady();
    await pending;
    expect(Download.launchDownload).toHaveBeenCalledTimes(1);
  });

  test("path click downloads and persists lastUsedPath", async () => {
    Menus.addPaths(["dir1"], ["link"]);

    await listener({
      menuItemId: "save-in-0",
      linkUrl: "https://example.com/f.png",
      pageUrl: "https://example.com/",
    });

    expect(Download.launchDownload).toHaveBeenCalledTimes(1);
    const state = Download.launchDownload.mock.calls[0]![0]!;
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

  test("a private path click remembers Last used without publishing it", async () => {
    Menus.addPaths(["private/path"], ["link"]);

    await listener(
      {
        menuItemId: "save-in-0",
        linkUrl: "https://example.com/private.png",
        pageUrl: "https://example.com/",
        editable: false,
        modifiers: [],
      },
      {
        id: 8,
        index: 0,
        highlighted: false,
        active: true,
        pinned: false,
        incognito: true,
      },
    );

    expect(Menus.state.lastUsedPath).toBeNull();
    expect(Menus.state.privateLastUsedPath).toBe("private/path");
    expect(global.browser.storage.local.set).not.toHaveBeenCalled();
    expect(global.browser.contextMenus.update).not.toHaveBeenCalled();

    await listener(
      {
        menuItemId: Menus.IDS.LAST_USED,
        linkUrl: "https://example.com/again.png",
        pageUrl: "https://example.com/",
      },
      {
        id: 8,
        index: 0,
        highlighted: false,
        active: true,
        pinned: false,
        incognito: true,
      },
    );

    expect(Download.launchDownload).toHaveBeenCalledTimes(2);
    expect(Download.launchDownload.mock.calls[1]![0]!.path.raw).toBe("private/path");
  });

  test("publishes private Last used and Recent locations only after opt-in", async () => {
    options.persistPrivateActivity = true;
    Menus.addPaths(["private/persisted"], ["link"]);

    await listener(
      {
        menuItemId: "save-in-0",
        linkUrl: "https://example.com/private.png",
        pageUrl: "https://example.com/",
      },
      {
        id: 8,
        index: 0,
        highlighted: false,
        active: true,
        pinned: false,
        incognito: true,
      },
    );

    expect(Menus.state.lastUsedPath).toBe("private/persisted");
    expect(Menus.state.privateLastUsedPath).toBeNull();
    expect(Menus.state.recentDestinations.map(({ path }) => path)).toEqual(["private/persisted"]);
    expect(global.browser.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ lastUsedPath: "private/persisted" }),
    );
    expect(global.browser.storage.local.set).toHaveBeenCalledWith({
      recentDestinations: [expect.objectContaining({ path: "private/persisted" })],
    });
  });

  test("private Last used state is unavailable to a regular click", async () => {
    await Menus.setLastUsed("private/path", { title: "Private folder" }, true);

    await listener({
      menuItemId: Menus.IDS.LAST_USED,
      linkUrl: "https://example.com/file.png",
      pageUrl: "https://example.com/",
    });

    expect(Download.launchDownload).not.toHaveBeenCalled();
  });

  test("enables a generic private Last used item when dynamic menus are unavailable", async () => {
    Reflect.deleteProperty(global.browser.contextMenus, "onShown");
    Reflect.deleteProperty(global.browser.contextMenus, "onHidden");
    Reflect.deleteProperty(global.browser.contextMenus, "refresh");
    Menus.addDownloadListener();
    const fallbackListener = vi
      .mocked(global.browser.contextMenus.onClicked.addListener)
      .mock.calls.at(-1)![0];
    Menus.addPaths(["private/path"], ["link"]);
    vi.mocked(global.browser.contextMenus.update).mockClear();

    await fallbackListener(
      {
        menuItemId: "save-in-0",
        linkUrl: "https://example.com/private.png",
        pageUrl: "https://example.com/",
        editable: false,
        modifiers: [],
      },
      {
        id: 8,
        index: 0,
        highlighted: false,
        active: true,
        pinned: false,
        incognito: true,
      },
    );

    expect(global.browser.contextMenus.update).toHaveBeenCalledWith(Menus.IDS.LAST_USED, {
      title: expect.any(String),
      enabled: true,
    });
    expect(global.browser.storage.local.set).not.toHaveBeenCalled();
  });

  test("falls back when a dynamic menu event has no listener registrar", async () => {
    Object.defineProperty(global.browser.contextMenus, "onShown", {
      configurable: true,
      value: { addListener: null },
    });
    Menus.addDownloadListener();
    const fallbackListener = vi
      .mocked(global.browser.contextMenus.onClicked.addListener)
      .mock.calls.at(-1)![0];
    Menus.addPaths(["private/path"], ["link"]);
    vi.mocked(global.browser.contextMenus.update).mockClear();

    await fallbackListener(
      {
        menuItemId: "save-in-0",
        linkUrl: "https://example.com/private.png",
        pageUrl: "https://example.com/",
        editable: false,
        modifiers: [],
      },
      {
        id: 8,
        index: 0,
        highlighted: false,
        active: true,
        pinned: false,
        incognito: true,
      },
    );

    expect(global.browser.contextMenus.update).toHaveBeenCalledWith(Menus.IDS.LAST_USED, {
      title: expect.any(String),
      enabled: true,
    });
  });

  test("clears private Last used state after the final private window closes", async () => {
    await Menus.setLastUsed("private/path", { title: "Private folder" }, true);
    const removed = vi.mocked(global.browser.windows.onRemoved.addListener).mock.calls[0]![0];
    vi.mocked(global.browser.storage.session.remove).mockClear();
    delete Runtime.ready;

    await removed(7);

    expect(Menus.state.privateLastUsedPath).toBeNull();
    expect(global.browser.storage.session.remove).toHaveBeenCalledWith("siPrivateLastUsed");
  });

  test("skips window enumeration when no private Last used state exists", async () => {
    const removed = vi.mocked(global.browser.windows.onRemoved.addListener).mock.calls[0]![0];

    await removed(7);

    expect(global.browser.windows.getAll).not.toHaveBeenCalled();
    expect(global.browser.storage.session.remove).not.toHaveBeenCalled();
  });

  test("does not recreate private Last used after its final window closes", async () => {
    let finishDownload!: (result: { status: "started"; downloadId: number }) => void;
    vi.mocked(Download.launchDownload).mockReturnValueOnce(
      new Promise((resolve) => {
        finishDownload = resolve;
      }),
    );
    Menus.addPaths(["private/path"], ["link"]);
    const saving = Promise.resolve(
      listener(
        {
          menuItemId: "save-in-0",
          linkUrl: "https://example.com/private.png",
          pageUrl: "https://example.com/",
        },
        { id: 8, windowId: 7, incognito: true },
      ),
    );
    await vi.waitFor(() => expect(Download.launchDownload).toHaveBeenCalledOnce());
    const removed = vi.mocked(global.browser.windows.onRemoved.addListener).mock.calls[0]![0];

    await removed(7);
    finishDownload({ status: "started", downloadId: 1 });
    await saving;

    expect(Menus.state.privateLastUsedPath).toBeNull();
    expect(global.browser.storage.session.set).not.toHaveBeenCalled();
  });

  test("does not remember a private click whose window closes during cold start", async () => {
    let finishReady!: () => void;
    Runtime.ready = new Promise<void>((resolve) => {
      finishReady = resolve;
    });
    Menus.addPaths(["private/path"], ["link"]);
    const saving = Promise.resolve(
      listener(
        {
          menuItemId: "save-in-0",
          linkUrl: "https://example.com/private.png",
          pageUrl: "https://example.com/",
        },
        { id: 8, windowId: 7, incognito: true },
      ),
    );
    const removed = vi.mocked(global.browser.windows.onRemoved.addListener).mock.calls[0]![0];
    const closing = removed(7);

    finishReady();
    await Promise.all([saving, closing]);

    expect(Download.launchDownload).toHaveBeenCalledOnce();
    expect(Menus.state.privateLastUsedPath).toBeNull();
    expect(global.browser.storage.session.set).not.toHaveBeenCalled();
  });

  test("keeps a completing private save when another private window remains", async () => {
    let finishDownload!: (result: { status: "started"; downloadId: number }) => void;
    vi.mocked(Download.launchDownload).mockReturnValueOnce(
      new Promise((resolve) => {
        finishDownload = resolve;
      }),
    );
    Menus.addPaths(["private/path"], ["link"]);
    const saving = Promise.resolve(
      listener(
        {
          menuItemId: "save-in-0",
          linkUrl: "https://example.com/private.png",
          pageUrl: "https://example.com/",
        },
        { id: 8, windowId: 8, incognito: true },
      ),
    );
    await vi.waitFor(() => expect(Download.launchDownload).toHaveBeenCalledOnce());
    vi.mocked(global.browser.windows.getAll).mockResolvedValue([
      { id: 9, incognito: true } as browser.windows.Window,
    ]);
    const removed = vi.mocked(global.browser.windows.onRemoved.addListener).mock.calls[0]![0];

    await removed(7);
    finishDownload({ status: "started", downloadId: 1 });
    await saving;

    expect(Menus.state.privateLastUsedPath).toBe("private/path");
    expect(global.browser.storage.session.set).toHaveBeenCalledOnce();
  });

  test("keeps private Last used state while another private window is open", async () => {
    await Menus.setLastUsed("private/path", { title: "Private folder" }, true);
    vi.mocked(global.browser.windows.getAll).mockResolvedValueOnce([
      { id: 9, incognito: true } as browser.windows.Window,
    ]);
    const removed = vi.mocked(global.browser.windows.onRemoved.addListener).mock.calls[0]![0];
    vi.mocked(global.browser.storage.session.remove).mockClear();

    await removed(7);

    expect(Menus.state.privateLastUsedPath).toBe("private/path");
    expect(global.browser.storage.session.remove).not.toHaveBeenCalled();
  });

  test("recovers private cleanup serialization after a window query fails", async () => {
    await Menus.setLastUsed("private/path", { title: "Private folder" }, true);
    vi.mocked(global.browser.windows.getAll)
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce([]);
    const removed = vi.mocked(global.browser.windows.onRemoved.addListener).mock.calls[0]![0];

    await removed(7);
    await removed(8);

    expect(Menus.state.privateLastUsedPath).toBeNull();
    expect(global.browser.storage.session.remove).toHaveBeenCalledWith("siPrivateLastUsed");
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

    const state = Download.launchDownload.mock.calls[0]![0]!;
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

    const state = Download.launchDownload.mock.calls[0]![0]!;
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

    expect(Download.launchDownload).toHaveBeenCalledTimes(2);
  });

  const lastState = () => vi.mocked(Download.launchDownload).mock.calls.at(-1)![0];

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

    expect(Download.launchDownload).toHaveBeenCalledTimes(1);
  });

  test("ignores clicks on ids without a path mapping (separators)", async () => {
    Menus.addPaths(["dir1"], ["link"]);
    await listener({ menuItemId: "separator-0", pageUrl: "https://example.com/" });
    expect(Download.launchDownload).not.toHaveBeenCalled();
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
    expect(Download.launchDownload).not.toHaveBeenCalled();
  });

  test("bails out when the click has nothing downloadable", async () => {
    options.selection = false;
    options.page = false;

    Menus.addPaths(["dir1"], ["page"]);
    await listener({ menuItemId: "save-in-0", pageUrl: "https://example.com/" });

    expect(Download.launchDownload).not.toHaveBeenCalled();
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
    vi.mocked(Download.launchDownload).mockResolvedValueOnce({ status: "failed" });
    Menus.addPaths(["dir1"], ["page"]);

    await listener(
      { menuItemId: "save-in-0", pageUrl: "https://example.com/" },
      { id: 42, title: "Title" },
    );

    expect(global.browser.tabs.remove).not.toHaveBeenCalled();
  });

  test("a failed save does not replace the last-used location", async () => {
    vi.mocked(Download.launchDownload).mockResolvedValueOnce({ status: "failed" });
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
    // Route-exclusive clicks do not update the last used path
    expect(global.browser.storage.local.set).not.toHaveBeenCalled();
  });

  // Hiding the folder choices is a menu-shape setting; whether an unmatched
  // file is saved belongs to routeSkipUnmatched, which download-plan already
  // reads for every save path. Forcing needRouteMatch here made the routing
  // options unable to answer for the one menu item this mode offers.
  test("route-exclusive clicks leave the no-match decision to the routing options", async () => {
    options.routeSkipUnmatched = false;

    await listener({
      menuItemId: Menus.IDS.ROUTE_EXCLUSIVE,
      linkUrl: "https://example.com/f.png",
      pageUrl: "https://example.com/",
    });

    expect(lastState().needRouteMatch).toBeFalsy();
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
    expect(Download.launchDownload).not.toHaveBeenCalled();
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

    test("refreshes Last used for the private menu and restores the regular title", async () => {
      await Menus.setLastUsed("regular/path", { title: "Regular folder" });
      await Menus.setLastUsed("private/path", { title: "Private folder" }, true);
      const shown = vi.mocked(global.browser.contextMenus.onShown.addListener).mock.calls[0]![0];
      const hidden = vi.mocked(global.browser.contextMenus.onHidden.addListener).mock.calls[0]![0];
      vi.mocked(global.browser.contextMenus.update).mockClear();
      delete Runtime.ready;

      await shown(
        { menuIds: [], contexts: [], editable: false },
        { index: 0, highlighted: false, active: true, pinned: false, incognito: true },
      );

      expect(global.browser.contextMenus.update).toHaveBeenLastCalledWith(Menus.IDS.LAST_USED, {
        title: "Private folder",
        enabled: true,
      });
      expect(global.browser.contextMenus.refresh).toHaveBeenCalledOnce();

      await hidden();

      expect(global.browser.contextMenus.update).toHaveBeenLastCalledWith(Menus.IDS.LAST_USED, {
        title: "Regular folder",
        enabled: true,
      });
    });

    test("uses the shared persisted title in private menus after opt-in", async () => {
      options.persistPrivateActivity = true;
      await Menus.setLastUsed("regular/path", { title: "Remembered folder" });
      await Menus.setLastUsed("private/path", { title: "Isolated folder" }, true);
      await Menus.updateLastUsedMenu();
      const shown = vi.mocked(global.browser.contextMenus.onShown.addListener).mock.calls[0]![0];
      vi.mocked(global.browser.contextMenus.update).mockClear();

      await shown(
        { menuIds: [], contexts: [], editable: false },
        { index: 0, highlighted: false, active: true, pinned: false, incognito: true },
      );

      expect(global.browser.contextMenus.update).not.toHaveBeenCalled();
      expect(global.browser.contextMenus.refresh).not.toHaveBeenCalled();
    });

    test("does no menu update work for ordinary context-menu openings", async () => {
      const shown = vi.mocked(global.browser.contextMenus.onShown.addListener).mock.calls[0]![0];
      const hidden = vi.mocked(global.browser.contextMenus.onHidden.addListener).mock.calls[0]![0];

      await shown(
        { menuIds: [], contexts: [], editable: false },
        { index: 0, highlighted: false, active: true, pinned: false, incognito: false },
      );
      await hidden();

      expect(global.browser.contextMenus.update).not.toHaveBeenCalled();
      expect(global.browser.contextMenus.refresh).not.toHaveBeenCalled();
    });

    test("serializes a private menu refresh with its immediate reset", async () => {
      await Menus.setLastUsed("regular/path", { title: "Regular folder" });
      await Menus.setLastUsed("private/path", { title: "Private folder" }, true);
      let finishReady!: () => void;
      Runtime.ready = new Promise<void>((resolve) => {
        finishReady = resolve;
      });
      const shown = vi.mocked(global.browser.contextMenus.onShown.addListener).mock.calls[0]![0];
      const hidden = vi.mocked(global.browser.contextMenus.onHidden.addListener).mock.calls[0]![0];
      vi.mocked(global.browser.contextMenus.update).mockClear();

      const showing = shown(
        { menuIds: [], contexts: [], editable: false },
        { index: 0, highlighted: false, active: true, pinned: false, incognito: true },
      );
      const hiding = hidden();
      finishReady();
      await Promise.all([showing, hiding]);

      expect(global.browser.contextMenus.update).toHaveBeenNthCalledWith(1, Menus.IDS.LAST_USED, {
        title: "Private folder",
        enabled: true,
      });
      expect(global.browser.contextMenus.update).toHaveBeenNthCalledWith(2, Menus.IDS.LAST_USED, {
        title: "Regular folder",
        enabled: true,
      });
    });

    test("repairs a failed private-title reset before showing a regular menu", async () => {
      await Menus.setLastUsed("regular/path", { title: "Regular folder" });
      await Menus.setLastUsed("private/path", { title: "Private folder" }, true);
      const shown = vi.mocked(global.browser.contextMenus.onShown.addListener).mock.calls[0]![0];
      const hidden = vi.mocked(global.browser.contextMenus.onHidden.addListener).mock.calls[0]![0];
      vi.mocked(global.browser.contextMenus.update).mockClear();

      await shown(
        { menuIds: [], contexts: [], editable: false },
        { index: 0, highlighted: false, active: true, pinned: false, incognito: true },
      );
      vi.mocked(global.browser.contextMenus.update).mockRejectedValueOnce(new Error("unavailable"));
      await hidden();
      await shown(
        { menuIds: [], contexts: [], editable: false },
        { index: 0, highlighted: false, active: true, pinned: false, incognito: false },
      );

      expect(global.browser.contextMenus.update).toHaveBeenLastCalledWith(Menus.IDS.LAST_USED, {
        title: "Regular folder",
        enabled: true,
      });
      expect(global.browser.contextMenus.refresh).toHaveBeenCalledTimes(2);
    });

    test.each([
      ["the setting is disabled", { enableLastLocation: false }],
      ["folder choices are hidden", { routeHideFolderChoices: true }],
      ["Quick save is the only page item", { quickSaveEnabled: true, quickSaveOnly: true }],
    ])("does not refresh Last used when %s", async (_label, overrides) => {
      Object.assign(options, overrides);
      const shown = vi.mocked(global.browser.contextMenus.onShown.addListener).mock.calls[0]![0];
      const hidden = vi.mocked(global.browser.contextMenus.onHidden.addListener).mock.calls[0]![0];

      await shown(
        { menuIds: [], contexts: [], editable: false },
        { index: 0, highlighted: false, active: true, pinned: false, incognito: true },
      );
      await hidden();

      expect(global.browser.contextMenus.update).not.toHaveBeenCalled();
      expect(global.browser.contextMenus.refresh).not.toHaveBeenCalled();
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

      expect(vi.mocked(makeShortcut)).toHaveBeenCalledWith(
        "HTML_REDIRECT",
        "https://example.com/i.png",
        undefined,
      );
      expect(vi.mocked(suggestShortcutFilename)).toHaveBeenCalledWith(
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

      expect(vi.mocked(makeShortcut)).toHaveBeenCalledWith(
        "HTML_REDIRECT",
        "https://example.com/f.png",
        undefined,
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

      expect(vi.mocked(makeShortcut)).toHaveBeenCalledWith(
        "HTML_REDIRECT",
        "https://example.com/",
        "Title",
      );
      expect(lastState().info.url).toBe("blob:mock-shortcut");
      expect(lastState().info.suggestedFilename).toBe("shortcut.url");
    });

    // The tracked global can lag behind or belong to another window, and its
    // title is mutated by later tab updates (#172, #188) — the shortcut's
    // contents must name the tab the click came from, like its filename does.
    test("a shortcut is titled from the clicked tab, not the tracked one", async () => {
      options.shortcutPage = true;
      setCurrentTab({ id: 9, title: "Other window tab", url: "https://other.test/" });

      Menus.addPaths(["dir1"], ["page"]);
      await listener(
        { menuItemId: "save-in-0", pageUrl: "https://b.test/page" },
        { id: 5, title: "Clicked tab" },
      );

      expect(vi.mocked(makeShortcut)).toHaveBeenCalledWith(
        "HTML_REDIRECT",
        "https://b.test/page",
        "Clicked tab",
      );
    });
  });

  describe("quick save", () => {
    beforeEach(() => {
      options.quickSaveEnabled = true;
      options.quickSaveDirectory = ".";
      options.quickSaveUseDirectory = false;
    });

    test("reuses the ordinary pipeline, saving to the Downloads root without routing exclusivity", async () => {
      await listener(
        { menuItemId: Menus.IDS.QUICK_SAVE, pageUrl: "https://example.com/" },
        { id: 3, title: "Title" },
      );

      expect(Download.launchDownload).toHaveBeenCalledOnce();
      expect(lastState().path.raw).toBe(".");
      expect(lastState().needRouteMatch).toBeFalsy();
      expect(lastState().info.url).toBe("https://example.com/");
      expect(lastState().info.menuItemTitle).toBe("Quick save");
      // Quick save is not a folder pick, so it leaves Last used untouched.
      expect(global.browser.storage.local.set).not.toHaveBeenCalled();
      expect(global.browser.contextMenus.update).not.toHaveBeenCalled();
    });

    test("routes to the configured folder when the directory toggle is on", async () => {
      options.quickSaveDirectory = "Photos/cats";
      options.quickSaveUseDirectory = true;

      await listener(
        { menuItemId: Menus.IDS.QUICK_SAVE, pageUrl: "https://example.com/" },
        { id: 3, title: "Title" },
      );

      expect(lastState().path.raw).toBe("Photos/cats");
    });

    test("the directory checkbox persists the toggle without starting a save", async () => {
      await listener({ menuItemId: Menus.IDS.QUICK_SAVE_TO_DIRECTORY, checked: true });

      expect(options.quickSaveUseDirectory).toBe(true);
      expect(global.browser.storage.local.set).toHaveBeenCalledWith({
        quickSaveUseDirectory: true,
      });
      expect(Download.launchDownload).not.toHaveBeenCalled();

      await listener({ menuItemId: Menus.IDS.QUICK_SAVE_TO_DIRECTORY, checked: false });
      expect(options.quickSaveUseDirectory).toBe(false);
    });

    test("the directory checkbox waits for cold-start option hydration", async () => {
      let finishReady!: () => void;
      Runtime.ready = new Promise<void>((resolve) => {
        finishReady = resolve;
      });

      const pending = Promise.resolve(
        listener({ menuItemId: Menus.IDS.QUICK_SAVE_TO_DIRECTORY, checked: true }),
      );
      await Promise.resolve();
      expect(global.browser.storage.local.set).not.toHaveBeenCalled();

      finishReady();
      await pending;
      expect(options.quickSaveUseDirectory).toBe(true);
      expect(global.browser.storage.local.set).toHaveBeenCalledWith({
        quickSaveUseDirectory: true,
      });
    });

    test("the keyboard command quick-saves the active tab's page", async () => {
      (global.browser as any).tabs = {
        query: vi.fn(() =>
          Promise.resolve([{ id: 9, url: "https://example.com/page", title: "P" }]),
        ),
      };

      await Menus.quickSaveActiveTab();

      expect(Download.launchDownload).toHaveBeenCalledOnce();
      expect(lastState().info.url).toBe("https://example.com/page");
      expect(lastState().info.menuItemTitle).toBe("Quick save");
    });

    test("the keyboard command respects the opt-in and a missing tab or url", async () => {
      options.quickSaveEnabled = false;
      // A cold start can wake the worker for the command before init assigns
      // the ready promise; the guard must tolerate its absence.
      Reflect.deleteProperty(Runtime, "ready");
      (global.browser as any).tabs = {
        query: vi.fn(() => Promise.resolve([{ id: 9, url: "https://example.com/page" }])),
      };
      await Menus.quickSaveActiveTab();
      expect(Download.launchDownload).not.toHaveBeenCalled();

      options.quickSaveEnabled = true;
      (global.browser as any).tabs = { query: vi.fn(() => Promise.resolve([])) };
      await Menus.quickSaveActiveTab();
      expect(Download.launchDownload).not.toHaveBeenCalled();

      (global.browser as any).tabs = {
        query: vi.fn(() => Promise.resolve([{ id: 9, title: "no url" }])),
      };
      await Menus.quickSaveActiveTab();
      expect(Download.launchDownload).not.toHaveBeenCalled();
    });
  });

  describe("per-menu-item post-save tab action", () => {
    beforeEach(() => {
      (global.browser as any).tabs = { remove: vi.fn(), update: vi.fn() };
    });

    const pageClick = (tab: Record<string, unknown>) =>
      listener({ menuItemId: "save-in-0", pageUrl: "https://example.com/" }, tab);

    test("closes the source tab after a successful save when the item opts in", async () => {
      Menus.addPaths(["dir1 // (tab: close)"], ["page"]);
      await pageClick({ id: 42, title: "Title" });

      expect(global.browser.tabs.remove).toHaveBeenCalledWith(42);
      expect(global.browser.tabs.update).not.toHaveBeenCalled();
    });

    test("re-activates the source tab for the return action", async () => {
      Menus.addPaths(["dir1 // (tab: return)"], ["page"]);
      await pageClick({ id: 42, title: "Title" });

      expect(global.browser.tabs.update).toHaveBeenCalledWith(42, { active: true });
      expect(global.browser.tabs.remove).not.toHaveBeenCalled();
    });

    test("does nothing for an item without the opt-in", async () => {
      Menus.addPaths(["dir1"], ["page"]);
      await pageClick({ id: 42, title: "Title" });

      expect(global.browser.tabs.remove).not.toHaveBeenCalled();
      expect(global.browser.tabs.update).not.toHaveBeenCalled();
    });

    test("does not act when the save did not start", async () => {
      vi.mocked(Download.launchDownload).mockResolvedValueOnce({ status: "failed" });
      Menus.addPaths(["dir1 // (tab: close)"], ["page"]);
      await pageClick({ id: 42, title: "Title" });

      expect(global.browser.tabs.remove).not.toHaveBeenCalled();
    });

    test("still acts on the already-known tab id in a private context", async () => {
      Menus.addPaths(["dir1 // (tab: close)"], ["page"]);
      await pageClick({ id: 42, title: "Title", incognito: true });

      expect(global.browser.tabs.remove).toHaveBeenCalledWith(42);
    });

    test("contains a rejected tabs API call without failing the handler", async () => {
      (global.browser as any).tabs = {
        remove: vi.fn(() => Promise.reject(new Error("tab already closed"))),
        update: vi.fn(),
      };
      Menus.addPaths(["dir1 // (tab: close)"], ["page"]);

      await expect(pageClick({ id: 42, title: "Title" })).resolves.toBeUndefined();
    });
  });
});

// The click handler's tangled "what does this click save?" decision, extracted
// as a pure function so its branches are testable without driving a browser.

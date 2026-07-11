// Context menu click handling: listeners are registered synchronously at
// service worker startup and must wait for async init before acting.
//
// menu-build/menu-click/menu-tabs and their deps are imported for real. Each
// test resets the module registry (fresh Menus state per case), so the deps are
// re-imported inside importMenus after the reset — they resolve to the same
// fresh instances the menu modules just loaded, so Object.assign (options,
// WEB_EXTENSION_CAPABILITIES) and vi.spyOn (Download/Notifier/Shortcut) reach the live
// click handlers. Path stays untouched (the handlers build real Path objects).

import { DOWNLOAD_TYPES } from "../src/constants.ts";
import type { CurrentTab } from "../src/current-tab.ts";

type MenusFixture = typeof import("../src/menu-build.ts").Menus;
// Browser listener mocks intentionally accept partial event payloads: each test
// supplies only the host fields relevant to the branch it exercises.
type TestMenuListener = (info: any, tab?: any) => void;

// Reassigned each module reset (in importMenus) to the fresh dep instances; the
// setup fn and the describe-scoped helpers below read them.
let options: any;
let Download: any;
let Notifier: any;
let Shortcut: any;
let WEB_EXTENSION_CAPABILITIES: any;
let setCurrentTab: (tab: CurrentTab | null) => void;

const setupBrowserMocks = () => {
  (global.browser as any).contextMenus = {
    create: jest.fn(),
    update: jest.fn(),
    removeAll: jest.fn(() => Promise.resolve()),
    onClicked: { addListener: jest.fn() },
  };
  (global.browser.runtime as any).openOptionsPage = jest.fn();
  (global.browser.downloads as any).showDefaultFolder = jest.fn();
  global.browser.storage.local.set = jest.fn(() => Promise.resolve());
};

// Seed the freshly-imported deps: spy the click-handler collaborators, mutate
// the real options bag and the WEB_EXTENSION_CAPABILITIES live-binding object in place.
// Download.launch stays real (it just calls the spied renameAndDownload, then
// swallows rejections — its logging/reportFailure path is covered in
// download-flow.test).
const seedDeps = () => {
  setCurrentTab(null);
  Object.assign(options, {
    links: true,
    selection: true,
    page: true,
    enableLastLocation: true,
    enableNumberedItems: false,
    truncateLength: 240,
    // The original stubbed bag omitted replacementChar, so filename
    // sanitisation stripped forbidden chars (empty replacement) rather than
    // substituting the real default "_".
    replacementChar: undefined,
    preferLinks: false,
    preferLinksFilterEnabled: false,
    notifyOnLinkPreferred: false,
    shortcutMedia: false,
    shortcutLink: false,
    shortcutPage: false,
    shortcutTab: false,
    shortcutType: "HTML_REDIRECT",
    closeTabOnSave: false,
    tabEnabled: true,
  });
  Object.assign(WEB_EXTENSION_CAPABILITIES, { accessKeys: false, tabContextMenus: false });
  vi.spyOn(Download, "renameAndDownload").mockResolvedValue(undefined);
  vi.spyOn(Download, "makeObjectUrl").mockReturnValue("data:text/plain;base64,eA==");
  vi.spyOn(Notifier, "createExtensionNotification").mockImplementation(() => {});
  vi.spyOn(Notifier, "expectDownload").mockImplementation(() => {});
  vi.spyOn(Shortcut, "makeShortcut").mockReturnValue("blob:mock-shortcut");
  vi.spyOn(Shortcut, "suggestShortcutFilename").mockReturnValue("shortcut.url");
};

// menu-click.ts/menu-tabs.ts augment the Menus object from menu-build.ts through
// the same imported binding, so importing them extends Menus. After each reset
// the deps are re-imported here (same fresh instances the menu modules hold) and
// seeded, so spies/Object.assign land on the live click handlers.
const importMenus = async () => {
  const { Menus } = await import("../src/menu-build.ts");
  await import("../src/menu-click.ts");
  await import("../src/menu-tabs.ts");
  ({ options } = await import("../src/options-data.ts"));
  ({ Download } = await import("../src/download.ts"));
  ({ Notifier } = await import("../src/notification.ts"));
  ({ Shortcut } = await import("../src/shortcut.ts"));
  ({ WEB_EXTENSION_CAPABILITIES } = await import("../src/chrome-detector.ts"));
  ({ setCurrentTab } = await import("../src/current-tab.ts"));
  seedDeps();
  return Menus;
};

describe("Menus last-used state", () => {
  let Menus: MenusFixture;

  beforeEach(async () => {
    jest.resetModules();
    setupBrowserMocks();
    Menus = await importMenus();
  });

  test("restoreLastUsed maps a stored object into state, defaulting to null", () => {
    Menus.restoreLastUsed({
      lastUsedPath: "a/b",
      lastUsedMeta: { comment: "c" },
    } as unknown as Parameters<MenusFixture["restoreLastUsed"]>[0]);
    expect(Menus.state.lastUsedPath).toBe("a/b");
    expect(Menus.state.lastUsedMeta).toEqual({ comment: "c" });

    Menus.restoreLastUsed(undefined as unknown as Parameters<MenusFixture["restoreLastUsed"]>[0]);
    expect(Menus.state.lastUsedPath).toBeNull();
    expect(Menus.state.lastUsedMeta).toBeNull();
  });

  test("setLastUsed mutates state and persists to storage.local", () => {
    Menus.setLastUsed("dir/x", { comment: "cm", menuIndex: "2" });
    expect(Menus.state.lastUsedPath).toBe("dir/x");
    expect(Menus.state.lastUsedMeta).toEqual({ comment: "cm", menuIndex: "2" });
    expect(global.browser.storage.local.set).toHaveBeenCalledWith({
      lastUsedPath: "dir/x",
      lastUsedMeta: { comment: "cm", menuIndex: "2" },
    });
  });
});

describe("addDownloadListener", () => {
  let Menus: MenusFixture;
  let listener: TestMenuListener;

  beforeEach(async () => {
    jest.resetModules();
    setupBrowserMocks();
    window.ready = Promise.resolve();
    delete window.lastDownloadState;

    Menus = await importMenus();
    Menus.addDownloadListener();
    [[listener]] = vi.mocked(global.browser.contextMenus.onClicked.addListener).mock.calls;
  });

  test("registers the listener synchronously (MV3 requirement)", () => {
    expect(global.browser.contextMenus.onClicked.addListener).toHaveBeenCalledTimes(1);
  });

  test("opens the options page for the options item", async () => {
    await listener({ menuItemId: "options" });
    expect(global.browser.runtime.openOptionsPage).toHaveBeenCalled();
    expect(Download.renameAndDownload).not.toHaveBeenCalled();
  });

  test("shows the default folder for show-default-folder", async () => {
    await listener({ menuItemId: "show-default-folder" });
    expect(global.browser.downloads.showDefaultFolder).toHaveBeenCalled();
  });

  test("ignores tabstrip menu items", async () => {
    await listener({ menuItemId: Menus.IDS.TABSTRIP.SELECTED_TAB });
    expect(Download.renameAndDownload).not.toHaveBeenCalled();
  });

  test("waits for init (window.ready) before handling a download click", async () => {
    let resolveReady!: (value?: unknown) => void;
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
    const state = Download.renameAndDownload.mock.calls[0][0];
    expect(state.info.url).toBe("https://example.com/f.png");

    expect(global.browser.storage.local.set).toHaveBeenCalledWith({
      lastUsedPath: "dir1",
      lastUsedMeta: { comment: expect.anything(), menuIndex: expect.anything() },
    });
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

    const state = Download.renameAndDownload.mock.calls[0][0];
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

    const state = Download.renameAndDownload.mock.calls[0][0];
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
  };

  test("handles a click when init already completed (no pending window.ready)", async () => {
    delete window.ready;

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

  describe("media clicks", () => {
    beforeEach(() => {
      Menus.addPaths(["dir1"], ["image"]);
    });

    test("downloads the media source", async () => {
      await listener(Object.assign({}, mediaClick, { linkUrl: undefined }));

      expect(lastState().info.url).toBe("https://example.com/i.png");
      expect(lastState().info.context).toBe(DOWNLOAD_TYPES.MEDIA);
    });

    test("keeps the media source for media wrapped in a link by default", async () => {
      await listener(mediaClick);

      expect(lastState().info.url).toBe("https://example.com/i.png");
      expect(lastState().info.context).toBe(DOWNLOAD_TYPES.MEDIA);
      expect(Notifier.createExtensionNotification).not.toHaveBeenCalled();
    });

    test("preferLinks downloads the wrapping link and notifies", async () => {
      options.preferLinks = true;
      options.notifyOnLinkPreferred = true;

      await listener(mediaClick);

      expect(lastState().info.url).toBe("https://example.com/gallery.html");
      expect(lastState().info.context).toBe(DOWNLOAD_TYPES.LINK);
      expect(Notifier.createExtensionNotification).toHaveBeenCalledWith(
        "Translated<notificationLinkPreferred>",
        "https://example.com/gallery.html",
      );
    });

    test("preferLinks stays quiet without notifyOnLinkPreferred", async () => {
      options.preferLinks = true;

      await listener(mediaClick);

      expect(lastState().info.url).toBe("https://example.com/gallery.html");
      expect(Notifier.createExtensionNotification).not.toHaveBeenCalled();
    });

    test("preferLinksFilter overrides to the link on matching pages", async () => {
      options.preferLinksFilterEnabled = true;
      options.preferLinksFilter = "example\\.com";
      options.notifyOnLinkPreferred = true;

      await listener(mediaClick);

      expect(lastState().info.url).toBe("https://example.com/gallery.html");
      expect(lastState().info.context).toBe(DOWNLOAD_TYPES.LINK);
      expect(Notifier.createExtensionNotification).toHaveBeenCalledWith(
        "Translated<notificationLinkPreferred>",
        "https://example.com/gallery.html",
      );
    });

    test("preferLinksFilter override stays quiet without notifyOnLinkPreferred", async () => {
      options.preferLinksFilterEnabled = true;
      options.preferLinksFilter = "example\\.com";

      await listener(mediaClick);

      expect(lastState().info.url).toBe("https://example.com/gallery.html");
      expect(Notifier.createExtensionNotification).not.toHaveBeenCalled();
    });

    test("preferLinksFilter keeps the media source on non-matching pages", async () => {
      options.preferLinksFilterEnabled = true;
      options.preferLinksFilter = "other\\.site";

      await listener(mediaClick);

      expect(lastState().info.url).toBe("https://example.com/i.png");
      expect(lastState().info.context).toBe(DOWNLOAD_TYPES.MEDIA);
    });

    test("a trailing empty filter line does not force-match every page", async () => {
      options.preferLinksFilterEnabled = true;
      // The empty lines used to compile to `new RegExp("")` (matches everything)
      // and wrongly override to the link; splitLines drops them
      options.preferLinksFilter = "other\\.site\n\n  \n";

      await listener(mediaClick);

      expect(lastState().info.url).toBe("https://example.com/i.png");
      expect(lastState().info.context).toBe(DOWNLOAD_TYPES.MEDIA);
    });

    test("an invalid filter pattern notifies and keeps the media source", async () => {
      options.preferLinksFilterEnabled = true;
      options.preferLinksFilter = "[";

      await listener(mediaClick);

      expect(Notifier.createExtensionNotification).toHaveBeenCalledWith(
        "Translated<notificationBadPreferLinksPattern>",
        expect.any(SyntaxError),
      );
      expect(lastState().info.url).toBe("https://example.com/i.png");
      expect(lastState().info.context).toBe(DOWNLOAD_TYPES.MEDIA);
    });
  });

  describe("selection clicks", () => {
    beforeEach(() => {
      Menus.addPaths(["dir1"], ["selection"]);
    });

    test("downloads the selection as a text object url named after the tab", async () => {
      await listener(
        {
          menuItemId: "save-in-0",
          selectionText: "hello world",
          pageUrl: "https://example.com/",
        },
        { id: 5, title: "Page Title" },
      );

      expect(Download.makeObjectUrl).toHaveBeenCalledWith("hello world");
      expect(lastState().info.url).toBe("data:text/plain;base64,eA==");
      expect(lastState().info.context).toBe(DOWNLOAD_TYPES.SELECTION);
      expect(lastState().info.suggestedFilename).toBe("Page Title.selection.txt");
    });

    test("falls back to the selection text when there is no tab title", async () => {
      await listener({
        menuItemId: "save-in-0",
        selectionText: "hello world",
        pageUrl: "https://example.com/",
      });

      expect(lastState().info.suggestedFilename).toBe("hello world.selection.txt");
    });

    test("truncates long titles so the suffix still fits truncateLength", async () => {
      await listener(
        {
          menuItemId: "save-in-0",
          selectionText: "hello world",
          pageUrl: "https://example.com/",
        },
        { id: 5, title: "x".repeat(500) },
      );

      // truncateLength (240) - ".selection.txt".length (14) = 226 title chars
      expect(lastState().info.suggestedFilename).toBe(`${"x".repeat(226)}.selection.txt`);
    });
  });

  describe("page clicks", () => {
    beforeEach(() => {
      Menus.addPaths(["dir1"], ["page"]);
    });

    test("downloads the page named after the clicked tab title, sanitized", async () => {
      await listener(
        { menuItemId: "save-in-0", pageUrl: "https://example.com/" },
        { id: 5, title: "T:i|tle" },
      );

      expect(lastState().info.url).toBe("https://example.com/");
      expect(lastState().info.context).toBe(DOWNLOAD_TYPES.PAGE);
      // ":" and "|" are stripped by filename sanitisation
      expect(lastState().info.suggestedFilename).toBe("Title");
    });

    test("falls back to the page url when no tab title is known", async () => {
      await listener({ menuItemId: "save-in-0", pageUrl: "https://example.com/" });

      expect(lastState().info.suggestedFilename).toBe("httpsexample.com");
    });
  });

  test("bails out when the click has nothing downloadable", async () => {
    options.selection = false;
    options.page = false;

    Menus.addPaths(["dir1"], ["page"]);
    await listener({ menuItemId: "save-in-0", pageUrl: "https://example.com/" });

    expect(Download.renameAndDownload).not.toHaveBeenCalled();
  });

  test("closeTabOnSave removes the tab shortly after a page save", async () => {
    jest.useFakeTimers();
    try {
      options.closeTabOnSave = true;
      (global.browser as any).tabs = { remove: jest.fn() };

      Menus.addPaths(["dir1"], ["page"]);
      await listener(
        { menuItemId: "save-in-0", pageUrl: "https://example.com/" },
        { id: 42, title: "Title" },
      );

      expect(global.browser.tabs.remove).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(500);
      expect(global.browser.tabs.remove).toHaveBeenCalledWith(42);
    } finally {
      jest.useRealTimers();
    }
  });

  test("does not close the tab for a non-page save even with closeTabOnSave", async () => {
    jest.useFakeTimers();
    try {
      options.closeTabOnSave = true;
      (global.browser as any).tabs = { remove: jest.fn() };

      Menus.addPaths(["dir1"], ["link"]);
      await listener(
        {
          menuItemId: "save-in-0",
          linkUrl: "https://example.com/f.png",
          pageUrl: "https://example.com/",
        },
        { id: 42, title: "Title" },
      );

      await jest.advanceTimersByTimeAsync(1000);
      expect(global.browser.tabs.remove).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
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

  test("last-used clicks reuse the previous path, comment and menu index", async () => {
    Menus.addPaths(["dir1 // route-comment"], ["link"]);
    await listener({
      menuItemId: "save-in-0",
      linkUrl: "https://example.com/f.png",
      pageUrl: "https://example.com/",
    });

    // A restart-survivor fixture: only the fields the handler reads are set,
    // so cast past the full DownloadState shape.
    window.lastDownloadState = { info: { comment: "0route_comment", menuIndex: "1" } } as any;

    await listener({
      menuItemId: Menus.IDS.LAST_USED,
      linkUrl: "https://example.com/g.png",
      pageUrl: "https://example.com/",
    });

    expect(lastState().path.raw).toBe("dir1");
    expect(lastState().info.comment).toBe("0route_comment");
    expect(lastState().info.menuIndex).toBe("1");
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
      WEB_EXTENSION_CAPABILITIES.accessKeys = true;

      Menus.addPaths(["dir1"], ["link"]);
      await listener(pathClick);

      expect(global.browser.contextMenus.update).toHaveBeenCalledWith(Menus.IDS.LAST_USED, {
        title: "dir1 (&a)",
        enabled: true,
      });
    });

    test("falls back to the path when the clicked item has an empty alias", async () => {
      Menus.addPaths(["dir1 // (alias: )"], ["link"]);
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
describe("resolveClickTarget (pure decision)", () => {
  let Menus: MenusFixture;
  const opts = (over: Record<string, unknown> = {}) => ({
    links: true,
    selection: true,
    page: true,
    truncateLength: 240,
    preferLinks: false,
    preferLinksFilterEnabled: false,
    preferLinksFilter: "",
    ...over,
  });

  beforeEach(async () => {
    jest.resetModules();
    setupBrowserMocks();
    Menus = await importMenus();
  });

  test("a media click saves the media source", () => {
    const t = Menus.resolveClickTarget(
      { mediaType: "image", srcUrl: "https://x/i.png" },
      opts(),
      null,
    );
    expect(t).toMatchObject({
      downloadType: "MEDIA",
      url: "https://x/i.png",
      notifyLinkPreferred: false,
    });
  });

  test("media wrapped in a link keeps the source by default", () => {
    const t = Menus.resolveClickTarget(
      { mediaType: "image", srcUrl: "https://x/i.png", linkUrl: "https://x/page" },
      opts(),
      null,
    );
    expect(t).toMatchObject({ downloadType: "MEDIA", url: "https://x/i.png" });
  });

  test("preferLinks switches to the wrapping link and flags a notification", () => {
    const t = Menus.resolveClickTarget(
      { mediaType: "image", srcUrl: "https://x/i.png", linkUrl: "https://x/page" },
      opts({ preferLinks: true }),
      null,
    );
    expect(t).toMatchObject({
      downloadType: "LINK",
      url: "https://x/page",
      notifyLinkPreferred: true,
    });
  });

  test("preferLinksFilter overrides to the link on a matching page", () => {
    const t = Menus.resolveClickTarget(
      {
        mediaType: "image",
        srcUrl: "https://x/i.png",
        linkUrl: "https://x/page",
        pageUrl: "https://match.example/a",
      },
      opts({ preferLinksFilterEnabled: true, preferLinksFilter: "match\\.example" }),
      null,
    );
    expect(t).toMatchObject({
      downloadType: "LINK",
      url: "https://x/page",
      notifyLinkPreferred: true,
    });
  });

  test("preferLinksFilter keeps the source on a non-matching page", () => {
    const t = Menus.resolveClickTarget(
      {
        mediaType: "image",
        srcUrl: "https://x/i.png",
        linkUrl: "https://x/page",
        pageUrl: "https://other.example/a",
      },
      opts({ preferLinksFilterEnabled: true, preferLinksFilter: "match\\.example" }),
      null,
    );
    expect(t).toMatchObject({ downloadType: "MEDIA", notifyLinkPreferred: false });
  });

  test("a trailing empty filter line does not match every page", () => {
    const t = Menus.resolveClickTarget(
      {
        mediaType: "image",
        srcUrl: "https://x/i.png",
        linkUrl: "https://x/page",
        pageUrl: "https://any.example/a",
      },
      opts({ preferLinksFilterEnabled: true, preferLinksFilter: "match\\.example\n" }),
      null,
    );
    expect(t.downloadType).toBe("MEDIA");
  });

  test("an invalid filter pattern reports the error and keeps the source", () => {
    const t = Menus.resolveClickTarget(
      {
        mediaType: "image",
        srcUrl: "https://x/i.png",
        linkUrl: "https://x/page",
        pageUrl: "https://any/a",
      },
      opts({ preferLinksFilterEnabled: true, preferLinksFilter: "(" }),
      null,
    );
    expect(t.downloadType).toBe("MEDIA");
    expect(t.badPatternError).toBeInstanceOf(Error);
  });

  test("a plain link (no media) saves the link", () => {
    const t = Menus.resolveClickTarget({ linkUrl: "https://x/page" }, opts(), null);
    expect(t).toMatchObject({ downloadType: "LINK", url: "https://x/page" });
  });

  test("with links disabled a link-only click falls through to the page", () => {
    const t = Menus.resolveClickTarget(
      { linkUrl: "https://x/page", pageUrl: "https://p" },
      opts({ links: false }),
      null,
    );
    expect(t.downloadType).toBe("PAGE");
  });

  test("a text selection reports its text and a .selection.txt name", () => {
    const t = Menus.resolveClickTarget({ selectionText: "hello world" }, opts(), {
      title: "My Tab",
    });
    expect(t).toMatchObject({
      downloadType: "SELECTION",
      selectionText: "hello world",
      url: undefined,
    });
    expect(t.suggestedFilename).toBe("My Tab.selection.txt");
  });

  test("a long selection title is truncated so the suffix still fits", () => {
    const t = Menus.resolveClickTarget({ selectionText: "x" }, opts({ truncateLength: 30 }), {
      title: "a".repeat(80),
    });
    expect(t.suggestedFilename.endsWith(".selection.txt")).toBe(true);
    expect(t.suggestedFilename.length).toBeLessThanOrEqual(30);
  });

  test("a page click saves the page url named after the tab title", () => {
    const t = Menus.resolveClickTarget({ pageUrl: "https://x/page" }, opts(), { title: "Title" });
    expect(t).toMatchObject({
      downloadType: "PAGE",
      url: "https://x/page",
      suggestedFilename: "Title",
    });
  });

  test("a page click falls back to the url when no tab title is known", () => {
    const t = Menus.resolveClickTarget({ pageUrl: "https://x/page" }, opts(), null);
    expect(t.suggestedFilename).toBe("https://x/page");
  });

  test("returns null when there is nothing downloadable", () => {
    expect(Menus.resolveClickTarget({}, opts({ page: false, selection: false }), null)).toBeNull();
  });
});

describe("addTabMenuListener", () => {
  test("registers a synchronous listener that ignores non-tabstrip items", async () => {
    jest.resetModules();
    setupBrowserMocks();
    (global.browser as any).tabs = { query: jest.fn(() => Promise.resolve([])) };
    window.ready = Promise.resolve();

    const Menus = await importMenus();
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
    jest.resetModules();
    setupBrowserMocks();
    (global.browser as any).tabs = {
      query: jest.fn(() => Promise.resolve(tabFixtures())),
      remove: jest.fn(),
    };
    window.ready = Promise.resolve();
    jest.useFakeTimers();

    Menus = await importMenus();
    Menus.addTabMenuListener();
    [[listener]] = vi.mocked(global.browser.contextMenus.onClicked.addListener).mock.calls;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const downloads = () =>
    vi.mocked(Download.renameAndDownload).mock.calls.map(([state]: [any]) => state);

  test("SELECTED_TAB downloads only the clicked tab", async () => {
    await listener({ menuItemId: Menus.IDS.TABSTRIP.SELECTED_TAB }, fromTab);
    await jest.advanceTimersByTimeAsync(2000);

    expect(global.browser.tabs.query).toHaveBeenCalledWith({
      pinned: false,
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
    expect(Notifier.expectDownload).toHaveBeenCalled();
  });

  test("SELECTED_MULTIPLE_TABS staggers downloads of the highlighted tabs", async () => {
    await listener({ menuItemId: Menus.IDS.TABSTRIP.SELECTED_MULTIPLE_TABS }, fromTab);

    expect(global.browser.tabs.query).toHaveBeenCalledWith(
      expect.objectContaining({ highlighted: true }),
    );

    // Downloads are staggered 500ms apart to avoid notification bugs
    await jest.advanceTimersByTimeAsync(0);
    expect(downloads()).toHaveLength(1);

    await jest.advanceTimersByTimeAsync(499);
    expect(downloads()).toHaveLength(1);

    await jest.advanceTimersByTimeAsync(1);
    expect(downloads()).toHaveLength(2);

    // The about: tab is filtered out, so no third download
    await jest.advanceTimersByTimeAsync(2000);
    expect(downloads()).toHaveLength(2);
    expect(downloads().map((s: any) => s.info.currentTab.id)).toEqual([1, 2]);
  });

  test("TO_RIGHT downloads tabs at and after the clicked index", async () => {
    await listener({ menuItemId: Menus.IDS.TABSTRIP.TO_RIGHT }, { id: 1, index: 1, windowId: 7 });
    await jest.advanceTimersByTimeAsync(2000);

    expect(downloads()).toHaveLength(1);
    expect(downloads()[0].info.currentTab.id).toBe(2);
    expect(downloads()[0].needRouteMatch).toBe(false);
  });

  test("TO_RIGHT_MATCH additionally requires a routing match", async () => {
    await listener(
      { menuItemId: Menus.IDS.TABSTRIP.TO_RIGHT_MATCH },
      { id: 1, index: 0, windowId: 7 },
    );
    await jest.advanceTimersByTimeAsync(2000);

    expect(downloads()).toHaveLength(2);
    expect(downloads().every((s: any) => s.needRouteMatch === true)).toBe(true);
  });

  test("OPENED_FROM_TAB queries for children of the clicked tab", async () => {
    await listener({ menuItemId: Menus.IDS.TABSTRIP.OPENED_FROM_TAB }, fromTab);
    await jest.advanceTimersByTimeAsync(2000);

    expect(global.browser.tabs.query).toHaveBeenCalledWith(
      expect.objectContaining({ openerTabId: 2 }),
    );
    expect(downloads()).toHaveLength(2);
  });

  test("shortcutTab saves tabs as shortcut files", async () => {
    options.shortcutTab = true;

    await listener({ menuItemId: Menus.IDS.TABSTRIP.SELECTED_TAB }, fromTab);
    await jest.advanceTimersByTimeAsync(2000);

    expect(Shortcut.makeShortcut).toHaveBeenCalledWith(
      "HTML_REDIRECT",
      "https://b.test/two",
      "Two",
    );
    expect(Shortcut.suggestShortcutFilename).toHaveBeenCalledWith(
      "HTML_REDIRECT",
      DOWNLOAD_TYPES.TAB,
      expect.objectContaining({ menuItemId: Menus.IDS.TABSTRIP.SELECTED_TAB }),
      "Two",
      240,
    );
    expect(downloads()[0].info.url).toBe("blob:mock-shortcut");
    expect(downloads()[0].info.suggestedFilename).toBe("shortcut.url");
  });

  test("handles tabstrip clicks when init already completed (no pending window.ready)", async () => {
    delete window.ready;

    await listener({ menuItemId: Menus.IDS.TABSTRIP.SELECTED_TAB }, fromTab);
    await jest.advanceTimersByTimeAsync(2000);

    expect(downloads()).toHaveLength(1);
  });

  test("shortcutTab falls back to the url for tabs without a title", async () => {
    options.shortcutTab = true;
    (global.browser.tabs as any).query = jest.fn(() =>
      Promise.resolve([{ id: 9, index: 0, url: "https://c.test/nine" }]),
    );

    await listener(
      { menuItemId: Menus.IDS.TABSTRIP.SELECTED_TAB },
      { id: 9, index: 0, windowId: 7 },
    );
    await jest.advanceTimersByTimeAsync(2000);

    expect(Shortcut.makeShortcut).toHaveBeenCalledWith(
      "HTML_REDIRECT",
      "https://c.test/nine",
      "https://c.test/nine",
    );
    expect(Shortcut.suggestShortcutFilename).toHaveBeenCalledWith(
      "HTML_REDIRECT",
      DOWNLOAD_TYPES.TAB,
      expect.anything(),
      undefined,
      240,
    );
  });

  test("closeTabOnSave removes each tab shortly after saving it", async () => {
    options.closeTabOnSave = true;

    await listener({ menuItemId: Menus.IDS.TABSTRIP.SELECTED_TAB }, fromTab);

    await jest.advanceTimersByTimeAsync(0);
    expect(downloads()).toHaveLength(1);
    expect(global.browser.tabs.remove).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(500);
    expect(global.browser.tabs.remove).toHaveBeenCalledWith(2);
  });
});

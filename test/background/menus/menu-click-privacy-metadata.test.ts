// Kept as its own entry, separate from download-listener.cases.ts and
// tab-listener.cases.ts (both owned by concurrent work), so these regression
// cases run independently of either. The shortcut auto-mock must be
// registered before listeners.fixture.ts (and menu-click.ts) first import
// shortcut.ts, exactly as in listeners.test.ts.
vi.mock(import("../../../src/downloads/shortcut.ts"), { spy: true });

import {
  Download,
  Runtime,
  options,
  setupBrowserMocks,
  importMenus,
  setCurrentTab,
  type MenusFixture,
  type TestMenuListener,
} from "./listeners.fixture.ts";
import {
  LAST_USED_PATH_STORAGE_KEY,
  PRIVATE_LAST_USED_SESSION_KEY,
} from "../../../src/shared/storage-keys.ts";

describe("context menu click privacy and metadata hardening", () => {
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

  const lastState = () => vi.mocked(Download.launchDownload).mock.calls.at(-1)![0];

  describe("stored-destination link metadata gate (#usesContextLinkMetadata)", () => {
    test("a Last used destination still containing :linktitle: triggers the lookup", async () => {
      // options.paths/filenamePatterns carry no metadata variable — only the
      // STORED Last used path does, e.g. after the user removed every
      // options.paths use of :linktitle: but never re-saved to Last used.
      Menus.setLastUsed("archive/:linktitle:", {});
      global.browser.tabs.sendMessage = vi.fn(() =>
        Promise.resolve({ href: "https://example.com/file", title: "Full size" }),
      );

      await listener(
        { menuItemId: Menus.IDS.LAST_USED, linkUrl: "https://example.com/file" },
        { id: 42 },
      );

      expect(global.browser.tabs.sendMessage).toHaveBeenCalledOnce();
      expect(lastState().info.linkTitle).toBe("Full size");
    });

    test("a recent-destination path still containing :linkdownload: triggers the lookup", async () => {
      Menus.pathMappings["save-in-recent-0"] = {
        parsedDir: "archive/:linkdownload:",
        comment: "",
        menuIndex: "",
        title: "Recent",
      };
      global.browser.tabs.sendMessage = vi.fn(() =>
        Promise.resolve({ href: "https://example.com/file", download: "original.jpg" }),
      );

      await listener(
        { menuItemId: "save-in-recent-0", linkUrl: "https://example.com/file" },
        { id: 42 },
      );

      expect(global.browser.tabs.sendMessage).toHaveBeenCalledOnce();
      expect(lastState().info.linkDownload).toBe("original.jpg");
    });

    test("a Quick save directory still containing :linktitle: triggers the lookup", async () => {
      // Quick save resolves saveIntoPath from options.quickSaveDirectory
      // (resolveDefaultDestination), a stored path distinct from
      // options.paths/filenamePatterns — the gate must scan it too.
      options.quickSaveUseDirectory = true;
      options.quickSaveDirectory = "archive/:linktitle:";
      global.browser.tabs.sendMessage = vi.fn(() =>
        Promise.resolve({ href: "https://example.com/file", title: "Full size" }),
      );

      await listener(
        { menuItemId: Menus.IDS.QUICK_SAVE, linkUrl: "https://example.com/file" },
        { id: 42 },
      );

      expect(global.browser.tabs.sendMessage).toHaveBeenCalledOnce();
      expect(lastState().info.linkTitle).toBe("Full size");
    });

    test("stays quiet when neither options nor the stored Last used path use metadata", async () => {
      Menus.setLastUsed("archive/plain", {});

      await listener(
        { menuItemId: Menus.IDS.LAST_USED, linkUrl: "https://example.com/file" },
        { id: 42 },
      );

      expect(global.browser.tabs.sendMessage).not.toHaveBeenCalled();
    });
  });

  // privateContext gates which storage area the click's last-used/recent-
  // destination bookkeeping lands in (session-only vs regular storage.local).
  // A misclassified-as-public private save would leak that bookkeeping into
  // regular, non-private storage — the real-world stake behind hardening the
  // tab || currentTab classification to treat EITHER candidate as private.
  describe("click privacy classification (tab || currentTab)", () => {
    const clickPathItem = async (clickTab: unknown) => {
      Menus.addPaths(["archive"], ["page"]);
      await listener({ menuItemId: "save-in-0", pageUrl: "https://x.test/page" }, clickTab);
    };

    test("routes last-used bookkeeping to the private path when the delivered tab is public but currentTab is private", async () => {
      setCurrentTab({ id: 1, incognito: true, url: "https://x.test/private" } as never);

      await clickPathItem({ id: 2, incognito: false, url: "https://x.test/public" });

      expect(global.browser.storage.session.set).toHaveBeenCalledWith(
        expect.objectContaining({ [PRIVATE_LAST_USED_SESSION_KEY]: expect.anything() }),
      );
      expect(global.browser.storage.local.set).not.toHaveBeenCalledWith(
        expect.objectContaining({ [LAST_USED_PATH_STORAGE_KEY]: expect.anything() }),
      );
    });

    test("routes last-used bookkeeping to the private path when currentTab is public but the delivered tab is private", async () => {
      setCurrentTab({ id: 1, incognito: false, url: "https://x.test/public" } as never);

      await clickPathItem({ id: 2, incognito: true, url: "https://x.test/private" });

      expect(global.browser.storage.session.set).toHaveBeenCalledWith(
        expect.objectContaining({ [PRIVATE_LAST_USED_SESSION_KEY]: expect.anything() }),
      );
      expect(global.browser.storage.local.set).not.toHaveBeenCalledWith(
        expect.objectContaining({ [LAST_USED_PATH_STORAGE_KEY]: expect.anything() }),
      );
    });

    test("keeps last-used bookkeeping on the regular path when neither candidate is private", async () => {
      setCurrentTab({ id: 1, incognito: false, url: "https://x.test/public" } as never);

      await clickPathItem({ id: 2, incognito: false, url: "https://x.test/public-too" });

      expect(global.browser.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({ [LAST_USED_PATH_STORAGE_KEY]: expect.anything() }),
      );
      expect(global.browser.storage.session.set).not.toHaveBeenCalledWith(
        expect.objectContaining({ [PRIVATE_LAST_USED_SESSION_KEY]: expect.anything() }),
      );
    });
  });
});

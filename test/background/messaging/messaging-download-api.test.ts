import {
  MESSAGE_TYPES,
  DOWNLOAD_TYPES,
  Download,
  Path,
  backgroundRuntime,
  Log,
  onMessage,
  onMessageExternal,
  trackedTab,
  setupGlobals,
  waitForCall,
} from "./messaging.fixture.ts";
import { parseRulesCollecting } from "../../../src/routing/rule-parser.ts";
import { options } from "../../../src/config/options-data.ts";
import * as DownloadDisposition from "../../../src/downloads/download-disposition.ts";
import * as Collector from "../../../src/background/script-media-collector.ts";
import { menuState } from "../../../src/background/menu-build.ts";
import { handleAutoDownloadSource } from "../../../src/background/messaging/auto-download.ts";
import { webExtensionStorageArea } from "../../support/webextension-host.fixture.ts";

const resetLastUsed = () => {
  menuState.lastUsedPath = null;
  menuState.lastUsedMeta = null;
  menuState.privateLastUsedPath = null;
  menuState.privateLastUsedMeta = null;
};

beforeEach(() => {
  setupGlobals();
  resetLastUsed();
});
afterEach(resetLastUsed);

describe("handleDownloadMessage", () => {
  const request = (overrides = {}) => ({
    type: MESSAGE_TYPES.DOWNLOAD,
    body: Object.assign(
      {
        url: "https://x/file.png",
        info: { pageUrl: "https://x/", srcUrl: "https://x/file.png" },
      },
      overrides,
    ),
  });

  test("tolerates an external message with no info object", async () => {
    const sendResponse = vi.fn();
    expect(
      onMessage(
        { type: MESSAGE_TYPES.DOWNLOAD, body: { url: "https://x/file.png" } },
        {},
        sendResponse,
      ),
    ).toBe(true);
    expect(Download.launchDownload).toHaveBeenCalledTimes(1);
    await waitForCall(sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: { status: MESSAGE_TYPES.OK, version: 1, url: "https://x/file.png" },
    });
  });

  test("rejects an omitted body as a missing URL", () => {
    const sendResponse = vi.fn();
    onMessage({ type: MESSAGE_TYPES.DOWNLOAD }, {}, sendResponse);
    expect(Download.launchDownload).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: {
        status: MESSAGE_TYPES.ERROR,
        error: "BAD_REQUEST",
        message: expect.any(String),
        version: 1,
      },
    });
  });

  test("canonicalizes a caller's URL spelling before it becomes the correlation key", async () => {
    const sendResponse = vi.fn();
    expect(onMessage(request({ url: "HTTPS://Example.com:443/x y.pdf" }), {}, sendResponse)).toBe(
      true,
    );

    const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
    expect(state.info.url).toBe("https://example.com/x%20y.pdf");
    await waitForCall(sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: { status: MESSAGE_TYPES.OK, version: 1, url: "https://example.com/x%20y.pdf" },
    });
  });

  test("downloads with defaults when no previous download state exists", async () => {
    const sendResponse = vi.fn();
    expect(onMessage(request(), {}, sendResponse)).toBe(true);

    expect(Download.launchDownload).toHaveBeenCalledTimes(1);

    const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
    expect(state.path).toMatchObject({ raw: "." });
    expect(state.path.finalize()).toBe(".");
    expect(state.scratch).toEqual({});
    expect(state.info.url).toBe("https://x/file.png");
    expect(state.info.pageUrl).toBe("https://x/");
    expect(state.info.sourceUrl).toBe("https://x/file.png");
    expect(state.info.context).toBe(DOWNLOAD_TYPES.CLICK);
    expect(state.info.now).toEqual(expect.any(Date));

    await waitForCall(sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: { status: MESSAGE_TYPES.OK, version: 1, url: "https://x/file.png" },
    });
  });

  test("keeps the message channel alive until the browser accepts the download", async () => {
    let finish!: (value: { status: "started"; downloadId: number }) => void;
    vi.mocked(Download.launchDownload).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const sendResponse = vi.fn();

    expect(onMessage(request(), {}, sendResponse)).toBe(true);
    expect(sendResponse).not.toHaveBeenCalled();

    finish({ status: "started", downloadId: 7 });
    await waitForCall(sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: { status: MESSAGE_TYPES.OK, version: 1, url: "https://x/file.png" },
    });
  });

  test("closes the source tab after a matched route action starts", async () => {
    vi.mocked(global.browser.tabs.remove).mockClear();
    vi.mocked(global.browser.tabs.get).mockResolvedValueOnce({
      id: 9,
      url: "https://x/",
    } as browser.tabs.Tab);
    vi.mocked(Download.launchDownload).mockImplementationOnce(async (state) => {
      state.scratch.routeTabAction = "close";
      return { status: "started", downloadId: 7 };
    });
    const sendResponse = vi.fn();
    expect(
      onMessage(
        request(),
        {
          id: global.browser.runtime.id,
          url: "https://x/",
          tab: { id: 9, url: "https://x/" },
        },
        sendResponse,
      ),
    ).toBe(true);
    await waitForCall(sendResponse);
    await vi.waitFor(() => expect(global.browser.tabs.remove).toHaveBeenCalledWith(9));
  });

  test("does not close a source tab that navigated while the save was starting", async () => {
    vi.mocked(global.browser.tabs.remove).mockClear();
    vi.mocked(global.browser.tabs.get).mockResolvedValueOnce({
      id: 9,
      url: "https://x/next",
    } as browser.tabs.Tab);
    vi.mocked(Download.launchDownload).mockImplementationOnce(async (state) => {
      state.scratch.routeTabAction = "close";
      return { status: "started", downloadId: 7 };
    });
    const sendResponse = vi.fn();

    expect(
      onMessage(
        request(),
        {
          id: global.browser.runtime.id,
          url: "https://x/",
          tab: { id: 9, url: "https://x/" },
        },
        sendResponse,
      ),
    ).toBe(true);
    await waitForCall(sendResponse);
    // The navigation refusal happens after the awaited tabs.get; drain the
    // remaining microtasks so a wrongly-executed close would be visible.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(global.browser.tabs.remove).not.toHaveBeenCalled();
  });

  test("keeps the source tab when an action-bearing save does not start", async () => {
    vi.mocked(global.browser.tabs.remove).mockClear();
    vi.mocked(Download.launchDownload).mockImplementationOnce(async (state) => {
      state.scratch.routeTabAction = "close";
      return { status: "skipped" };
    });
    const sendResponse = vi.fn();
    expect(
      onMessage(request(), { id: global.browser.runtime.id, tab: { id: 9 } }, sendResponse),
    ).toBe(true);
    await waitForCall(sendResponse);
    expect(global.browser.tabs.remove).not.toHaveBeenCalled();
  });

  test("does not close an ambient tab for a URL requested by an extension page", async () => {
    vi.mocked(global.browser.tabs.remove).mockClear();
    vi.mocked(Download.launchDownload).mockImplementationOnce(async (state) => {
      state.scratch.routeTabAction = "close";
      return { status: "started", downloadId: 7 };
    });
    const optionsUrl = global.browser.runtime.getURL("options.html");
    const sendResponse = vi.fn();

    expect(
      onMessage(
        request(),
        { id: global.browser.runtime.id, url: optionsUrl, tab: { id: 9, url: optionsUrl } },
        sendResponse,
      ),
    ).toBe(true);
    await waitForCall(sendResponse);
    expect(global.browser.tabs.remove).not.toHaveBeenCalled();
  });

  test("contains and logs a post-save tab close failure", async () => {
    vi.mocked(global.browser.tabs.get).mockResolvedValueOnce({
      id: 9,
      url: "https://x/",
    } as browser.tabs.Tab);
    vi.mocked(global.browser.tabs.remove).mockRejectedValueOnce(new Error("tab vanished"));
    vi.mocked(Download.launchDownload).mockImplementationOnce(async (state) => {
      state.scratch.routeTabAction = "close";
      return { status: "started", downloadId: 7 };
    });
    const sendResponse = vi.fn();

    expect(
      onMessage(
        request(),
        {
          id: global.browser.runtime.id,
          url: "https://x/",
          tab: { id: 9, url: "https://x/", incognito: true },
        },
        sendResponse,
      ),
    ).toBe(true);
    await waitForCall(sendResponse);
    await vi.waitFor(() =>
      expect(Log.addLogEntry).toHaveBeenCalledWith(
        "post-save tab action failed",
        "Error: tab vanished",
        { privateContext: true },
      ),
    );
  });

  test("acknowledges the primary media save without waiting for its deferred sidecar", async () => {
    options.saveSourceSidecar = true;
    const sendResponse = vi.fn();

    expect(
      onMessage(
        request({
          info: {
            pageUrl: "https://x/",
            srcUrl: "https://x/file.png",
            sourceKind: "image",
          },
        }),
        { id: global.browser.runtime.id },
        sendResponse,
      ),
    ).toBe(true);

    await waitForCall(sendResponse);
    expect(Download.launchDownload).toHaveBeenCalledOnce();
    expect(vi.mocked(Download.launchDownload).mock.calls[0]![0]!.scratch.sourceSidecar).toEqual({
      sourceUrl: "https://x/file.png",
      pageUrl: "https://x/",
      title: "Tracked Tab",
    });
    expect(sendResponse).toHaveBeenCalledOnce();
  });

  test("never writes a source sidecar for a private source-panel save", async () => {
    options.saveSourceSidecar = true;
    const sendResponse = vi.fn();

    expect(
      onMessage(
        request({
          info: {
            pageUrl: "https://private.example/gallery/",
            srcUrl: "https://x/private-file.png",
            sourceKind: "image",
          },
        }),
        {
          id: global.browser.runtime.id,
          tab: { id: 8, title: "Private gallery", incognito: true },
        },
        sendResponse,
      ),
    ).toBe(true);

    await waitForCall(sendResponse);
    expect(Download.launchDownload).toHaveBeenCalledOnce();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: { status: MESSAGE_TYPES.OK, version: 1, url: "https://x/file.png" },
    });
  });

  test("defers sidecar preparation until after the accepted primary save completes", async () => {
    options.saveSourceSidecar = true;
    const finalize = vi.spyOn(DownloadDisposition, "finalizeFullPath");
    const sendResponse = vi.fn();

    expect(
      onMessage(
        request({
          info: {
            pageUrl: "https://x/",
            srcUrl: "https://x/file.png",
            sourceKind: "image",
          },
        }),
        { id: global.browser.runtime.id },
        sendResponse,
      ),
    ).toBe(true);

    await waitForCall(sendResponse);
    expect(finalize).not.toHaveBeenCalled();
    expect(Log.addLogEntry).not.toHaveBeenCalledWith("source sidecar failed", expect.anything());
    expect(sendResponse).toHaveBeenCalledOnce();
  });

  test("preserves a caller-supplied suggested filename", () => {
    onMessage(
      request({ info: { pageUrl: "https://x/", suggestedFilename: "caller-name.png" } }),
      {},
      vi.fn(),
    );

    const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
    expect(state.info.suggestedFilename).toBe("caller-name.png");
  });

  test("preserves source metadata supplied by an integration", () => {
    onMessage(
      request({
        info: {
          srcUrl: "https://x/file.png",
          mime: "image/png",
          mediaType: "image",
          sourceKind: "image",
        },
      }),
      {},
      vi.fn(),
    );

    const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
    expect(state.info).toMatchObject({
      mime: "image/png",
      mediaType: "image",
      sourceKind: "image",
    });
  });

  test("reuses the last path and routing metadata, never filenames or routes", () => {
    menuState.lastUsedPath = "images/cats";
    menuState.lastUsedMeta = { comment: "0last", menuIndex: "1" };
    backgroundRuntime.lastDownloadState = {
      path: new Path("images/cats"),
      scratch: { hasExtension: true },
      route: new Path("stale/route/from/other.png"),
      info: {
        comment: "0last",
        menuIndex: "1",
        suggestedFilename: "previous-download.png",
        filename: "previous-download.png",
      },
    };

    onMessage(request(), {}, vi.fn());

    const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
    expect(state.path.finalize()).toBe("images/cats");
    // Inheriting the previous route, filename, or scratch would name this
    // download after the previous one (found live by the alt+click e2e)
    expect(state).not.toHaveProperty("route");
    expect(state.info.suggestedFilename).toBeUndefined();
    expect(state.info.filename).toBeUndefined();
    // Only the folder/metadata pairing mark is new scratch; none is inherited.
    expect(state.scratch).toEqual({ keepInheritedFolder: true });
    // Routing metadata is kept so comment/menuindex rules stay usable
    expect(state.info.menuIndex).toBe("1");
    expect(state.info.comment).toBe("0last");
    expect(state.info.url).toBe("https://x/file.png");
  });

  test("falls back to the default path when no folder was picked from the menu", () => {
    onMessage(request(), {}, vi.fn());

    const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
    expect(state.path).toMatchObject({ raw: "." });
    expect(state.path.finalize()).toBe(".");
  });

  // #238: the folder a click inherits is the one last picked from the menu.
  // That is the persisted Last used record, which survives a background
  // restart and is kept apart for private windows; the in-memory last download
  // is neither.
  describe("inheriting the Last used folder (#238)", () => {
    afterEach(() => {
      options.persistPrivateActivity = false;
    });
    const clickState = () => vi.mocked(Download.launchDownload).mock.calls[0]![0]!;

    test("inherits the persisted Last used folder and its menu metadata", () => {
      menuState.lastUsedPath = "Image Sorting";
      menuState.lastUsedMeta = { comment: "category=nature", menuIndex: "1" };

      onMessage(request(), {}, vi.fn());

      expect(clickState().path.finalize()).toBe("Image Sorting");
      expect(clickState().info.comment).toBe("category=nature");
      expect(clickState().info.menuIndex).toBe("1");
      expect(clickState().scratch.keepInheritedFolder).toBe(true);
    });

    // Any later save rewrites the in-memory last download: a routed click
    // re-roots its path, an automatic or external save replaces it. None of
    // those is a folder picked from the menu.
    test("ignores an in-memory last download that a later save overwrote", () => {
      menuState.lastUsedPath = "Image Sorting";
      menuState.lastUsedMeta = { comment: "category=nature", menuIndex: "1" };
      backgroundRuntime.lastDownloadState = {
        path: new Path("routed/by/a/rule"),
        scratch: {},
        info: { comment: "from-an-automatic-save", menuIndex: "9" },
      } as any;

      onMessage(request(), {}, vi.fn());

      expect(clickState().path.finalize()).toBe("Image Sorting");
      expect(clickState().info.comment).toBe("category=nature");
      expect(clickState().info.menuIndex).toBe("1");
    });

    test("inherits nothing from an in-memory last download alone", () => {
      backgroundRuntime.lastDownloadState = {
        path: new Path("images/cats"),
        scratch: {},
        info: { comment: "0last", menuIndex: "1" },
      } as any;

      onMessage(request(), {}, vi.fn());

      expect(clickState().path.finalize()).toBe(".");
      expect(clickState().info.comment).toBeUndefined();
      expect(clickState().info.menuIndex).toBeUndefined();
      expect(clickState().scratch.keepInheritedFolder).toBeUndefined();
    });

    // The in-memory last download only ever describes regular saves.
    test("an isolated private click never inherits the regular folder", () => {
      menuState.lastUsedPath = "Regular";
      menuState.lastUsedMeta = { comment: "regular-comment", menuIndex: "2" };
      backgroundRuntime.lastDownloadState = {
        path: new Path("Regular"),
        scratch: {},
        info: { comment: "regular-comment", menuIndex: "2" },
      } as any;

      onMessage(request(), { tab: { id: 7, incognito: true } }, vi.fn());

      expect(clickState().path.finalize()).toBe(".");
      expect(clickState().info.comment).toBeUndefined();
      expect(clickState().info.menuIndex).toBeUndefined();
    });

    test("keeps a private click on the private Last used folder", () => {
      menuState.lastUsedPath = "Regular";
      menuState.privateLastUsedPath = "Private";

      onMessage(request(), { tab: { id: 7, incognito: true } }, vi.fn());

      expect(clickState().path.finalize()).toBe("Private");
    });

    test("uses the regular folder for a private click once private activity is remembered", () => {
      menuState.lastUsedPath = "Regular";
      menuState.privateLastUsedPath = "Private";
      options.persistPrivateActivity = true;

      onMessage(request(), { tab: { id: 7, incognito: true } }, vi.fn());

      expect(clickState().path.finalize()).toBe("Regular");
    });
  });

  // #162: "If I need it anywhere I would select those other folders and then my
  // instant click download is broken." The inherited folder is the default; the
  // option opts out of it.
  describe("click-to-save default destination (#162)", () => {
    const seedLastPath = () => {
      menuState.lastUsedPath = "images/cats";
    };

    const clickPath = () => {
      const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
      return state.path.finalize();
    };

    test("still inherits the last folder while the option is off", () => {
      seedLastPath();
      options.contentClickToSaveUseDefault = false;

      onMessage(request(), {}, vi.fn());

      expect(clickPath()).toBe("images/cats");
    });

    test("uses the Downloads root instead of the last folder when opted in", () => {
      seedLastPath();
      options.contentClickToSaveUseDefault = true;

      onMessage(request(), {}, vi.fn());

      expect(clickPath()).toBe(".");
    });

    // The opt-out resolves the same destination Quick save does, so the two
    // one-click saves cannot disagree about where "default" is.
    test("follows the configured Quick save folder when one is set", () => {
      seedLastPath();
      options.contentClickToSaveUseDefault = true;
      options.quickSaveUseDirectory = true;
      options.quickSaveDirectory = "Inbox";

      onMessage(request(), {}, vi.fn());

      expect(clickPath()).toBe("Inbox");
    });

    // #238: only a click that inherits the folder AND its menu metadata may
    // keep that folder under a matched rule.
    describe("pairing the inherited folder with its menu metadata (#238)", () => {
      const seedMenuSave = () => {
        menuState.lastUsedPath = "Image Sorting";
        menuState.lastUsedMeta = { comment: "category=nature", menuIndex: "1" };
      };
      const clickScratch = () => vi.mocked(Download.launchDownload).mock.calls[0]![0]!.scratch;

      test("marks a click that inherits both", () => {
        seedMenuSave();

        onMessage(request(), {}, vi.fn());

        expect(clickScratch().keepInheritedFolder).toBe(true);
      });

      test("does not mark a click whose caller supplied its own comment", () => {
        seedMenuSave();

        onMessage(request({ comment: "from-foxy-gestures" }), {}, vi.fn());

        expect(clickScratch().keepInheritedFolder).toBeUndefined();
      });

      test("does not mark a click that saves to the default destination", () => {
        seedMenuSave();
        options.contentClickToSaveUseDefault = true;

        onMessage(request(), {}, vi.fn());

        expect(clickScratch().keepInheritedFolder).toBeUndefined();
      });

      test("does not mark a click after a save that carried no menu metadata", () => {
        seedLastPath();

        onMessage(request(), {}, vi.fn());

        expect(clickScratch().keepInheritedFolder).toBeUndefined();
      });
    });

    afterEach(() => {
      options.contentClickToSaveUseDefault = false;
      options.quickSaveUseDirectory = false;
      options.quickSaveDirectory = ".";
    });
  });

  test("prefers the sender's tab over the tracked global tab (#172)", () => {
    const senderTab = { id: 5, title: "Sender Tab" };
    onMessage(request(), { tab: senderTab }, vi.fn());

    const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
    expect(state.info.currentTab).toBe(senderTab);
  });

  test("falls back to the tracked tab when the sender has none", () => {
    onMessage(request(), {}, vi.fn());

    const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
    expect(state.info.currentTab).toBe(trackedTab);
  });

  test("passes through a comment for routing rules (external extensions)", () => {
    onMessage(request({ comment: "from-foxy-gestures" }), {}, vi.fn());

    const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
    expect(state.info.comment).toBe("from-foxy-gestures");
  });

  test("does not let external info override pipeline-owned fields", () => {
    onMessage(
      request({
        info: {
          pageUrl: "https://x/",
          context: "forged",
          url: "javascript:forged",
          currentTab: { id: 99 },
        },
      }),
      {},
      vi.fn(),
    );

    const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
    expect(state.info.context).toBe(DOWNLOAD_TYPES.CLICK);
    expect(state.info.url).toBe("https://x/file.png");
    expect(state.info.currentTab).toBe(trackedTab);
  });

  test("accepts CSS attestations only through the internal message channel", async () => {
    const cssRequest = request({
      info: {
        pageUrl: "https://x/",
        srcUrl: "https://x/file.png",
        matchedCssSelectorsByOrigin: [["article img"]],
      },
    });
    onMessage(cssRequest, { url: "https://x/", tab: { id: 8, url: "https://x/" } }, vi.fn());
    expect(vi.mocked(Download.launchDownload).mock.calls[0]![0]!.info).toMatchObject({
      matchedCssSelectorsByOrigin: [["article img"]],
    });

    vi.mocked(Download.launchDownload).mockClear();
    const response = vi.fn();
    onMessageExternal(cssRequest, { id: "trusted-extension", tab: { id: 9 } }, response);
    await waitForCall(response);
    expect(
      vi.mocked(Download.launchDownload).mock.calls[0]![0]!.info.matchedCssSelectorsByOrigin,
    ).toBeUndefined();
  });

  test("routes on the image alt text a save request supplies", () => {
    onMessage(
      request({
        info: { pageUrl: "https://x/", srcUrl: "https://x/file.png", altText: "Sunset" },
      }),
      { url: "https://x/", tab: { id: 8, url: "https://x/" } },
      vi.fn(),
    );
    expect(vi.mocked(Download.launchDownload).mock.calls[0]![0]!.info.altText).toBe("Sunset");

    vi.mocked(Download.launchDownload).mockClear();
    const rejected = vi.fn();
    onMessage(
      request({ info: { pageUrl: "https://x/", srcUrl: "https://x/file.png", altText: 7 } }),
      { url: "https://x/", tab: { id: 8, url: "https://x/" } },
      rejected,
    );
    expect(Download.launchDownload).not.toHaveBeenCalled();
  });

  describe("captured page text", () => {
    const textRequest = request({
      info: {
        pageUrl: "https://x/",
        srcUrl: "https://x/file.png",
        capturedPageText: [["header .author", "example author"]],
        // A message may carry evidence, never the value a rule resolved to.
        pageText: "forged",
      },
    });
    const launchedInfo = () => vi.mocked(Download.launchDownload).mock.calls[0]![0]!.info;

    test("is accepted from the page's own top-frame content script", () => {
      onMessage(textRequest, { url: "https://x/", tab: { id: 8, url: "https://x/" } }, vi.fn());
      expect(launchedInfo().capturedPageText).toEqual([["header .author", "example author"]]);
      expect(launchedInfo().pageText).toBeUndefined();
    });

    test.each([
      [
        "another extension page",
        {
          url: "chrome-extension://save-in/src/options/options.html",
          tab: { id: 8, url: "chrome-extension://save-in/src/options/options.html" },
        },
      ],
      ["a subframe", { url: "https://frame.test/", tab: { id: 8, url: "https://x/" } }],
      [
        "a frame that names the top page",
        { url: "https://x/", frameId: 3, tab: { id: 8, url: "https://x/" } },
      ],
      ["a page on another origin", { url: "https://y/", tab: { id: 8, url: "https://y/" } }],
    ])("is dropped when sent by %s", (_label, sender) => {
      onMessage(textRequest, sender, vi.fn());
      expect(Download.launchDownload).toHaveBeenCalledOnce();
      expect(launchedInfo().capturedPageText).toBeUndefined();
      expect(launchedInfo().pageText).toBeUndefined();
    });

    test("is dropped from an external extension", async () => {
      const response = vi.fn();
      onMessageExternal(textRequest, { id: "trusted-extension", tab: { id: 9 } }, response);
      await waitForCall(response);
      expect(launchedInfo().capturedPageText).toBeUndefined();
      expect(launchedInfo().pageText).toBeUndefined();
    });

    test("an unbounded or malformed capture rejects the whole request", () => {
      for (const capturedPageText of [
        [["header .author", "x".repeat(513)]],
        [["header .author", " padded "]],
        "example author",
      ]) {
        onMessage(
          request({
            info: { pageUrl: "https://x/", srcUrl: "https://x/file.png", capturedPageText },
          }),
          { url: "https://x/", tab: { id: 8, url: "https://x/" } },
          vi.fn(),
        );
      }
      expect(Download.launchDownload).not.toHaveBeenCalled();
    });
  });

  test("accepts gesture provenance only from the trusted content channel", async () => {
    const gestureRequest = request({
      info: {
        pageUrl: "https://x/",
        srcUrl: "https://x/file.png",
        gesture: "double-left-click",
      },
    });
    onMessage(gestureRequest, { url: "https://x/", tab: { id: 8, url: "https://x/" } }, vi.fn());
    expect(vi.mocked(Download.launchDownload).mock.calls[0]![0]!.info.gesture).toBe(
      "double-left-click",
    );

    vi.mocked(Download.launchDownload).mockClear();
    const response = vi.fn();
    onMessageExternal(gestureRequest, { id: "trusted-extension", tab: { id: 9 } }, response);
    await waitForCall(response);
    expect(vi.mocked(Download.launchDownload).mock.calls[0]![0]!.info.gesture).toBeUndefined();
  });

  test.each([
    ["ctrl+shift", "ctrl+shift"],
    // A content script spells keys canonically, but the field is untrusted:
    // re-spell what the binding parser reads and drop anything else.
    ["Shift+Ctrl", "ctrl+shift"],
    ["none", "none"],
    ["", undefined],
    ["hyper+click", undefined],
    // Content scripts from before #15 send no keys at all.
    [undefined, undefined],
  ])("normalizes content click keys %j to %j for routing", (clickKeys, expected) => {
    onMessage(
      request({
        info: {
          pageUrl: "https://x/",
          srcUrl: "https://x/file.png",
          gesture: "left-click",
          ...(clickKeys === undefined ? {} : { clickKeys }),
        },
      }),
      { url: "https://x/", tab: { id: 8, url: "https://x/" } },
      vi.fn(),
    );
    const info = vi.mocked(Download.launchDownload).mock.calls[0]![0]!.info;
    expect(info.gesture).toBe("left-click");
    expect(info.clickKeys).toBe(expected);
  });

  test("ignores click keys from external callers", async () => {
    const response = vi.fn();
    onMessageExternal(
      request({ info: { pageUrl: "https://x/", srcUrl: "https://x/file.png", clickKeys: "alt" } }),
      { id: "trusted-extension", tab: { id: 9 } },
      response,
    );
    await waitForCall(response);
    expect(vi.mocked(Download.launchDownload).mock.calls[0]![0]!.info.clickKeys).toBeUndefined();
  });

  test("rejects CSS attestations forged by another internal extension page", () => {
    onMessage(
      request({
        info: {
          pageUrl: "https://x/",
          srcUrl: "https://x/file.png",
          matchedCssSelectorsByOrigin: [["article img"]],
        },
      }),
      {
        url: "chrome-extension://save-in/src/options/options.html",
        tab: { id: 8, url: "chrome-extension://save-in/src/options/options.html" },
      },
      vi.fn(),
    );

    expect(
      vi.mocked(Download.launchDownload).mock.calls[0]![0]!.info.matchedCssSelectorsByOrigin,
    ).toBeUndefined();
  });

  test("rejects CSS attestations sent from a subframe", () => {
    onMessage(
      request({
        info: {
          pageUrl: "https://frame.test/",
          srcUrl: "https://frame.test/file.png",
          matchedCssSelectorsByOrigin: [["article img"]],
        },
      }),
      {
        url: "https://frame.test/",
        tab: { id: 8, url: "https://top.test/" },
      },
      vi.fn(),
    );

    expect(
      vi.mocked(Download.launchDownload).mock.calls[0]![0]!.info.matchedCssSelectorsByOrigin,
    ).toBeUndefined();
  });

  test("omits the comment when none is supplied", () => {
    onMessage(request(), {}, vi.fn());

    const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
    expect(state.info.comment).toBeUndefined();
  });

  test("is reachable from external extensions via onMessageExternal", async () => {
    const sendResponse = vi.fn();
    expect(
      onMessageExternal(request(), { id: "trusted-extension", tab: { id: 9 } }, sendResponse),
    ).toBe(true);

    expect(Download.launchDownload).toHaveBeenCalledTimes(1);
    await waitForCall(sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: { status: MESSAGE_TYPES.OK, version: 1, url: "https://x/file.png" },
    });
  });

  test("holds the source-tab action while routing is still undecided", async () => {
    vi.mocked(global.browser.tabs.remove).mockClear();
    vi.mocked(global.browser.tabs.get).mockResolvedValueOnce({
      id: 9,
      url: "https://x/",
    } as browser.tabs.Tab);
    vi.mocked(Download.launchDownload).mockImplementationOnce(async (state) => {
      state.scratch.routeTabAction = "close";
      // A still-set requirement means Chrome's filename pass has not accepted
      // the route; the close must not run on this undecided state.
      state.scratch.deferredRouteRequirement = true;
      return { status: "started", downloadId: 7 };
    });
    const sendResponse = vi.fn();

    expect(
      onMessage(
        request(),
        { id: global.browser.runtime.id, url: "https://x/", tab: { id: 9, url: "https://x/" } },
        sendResponse,
      ),
    ).toBe(true);
    await waitForCall(sendResponse);
    // The response lands before the handler's close block runs; drain the
    // remaining microtasks so a wrongly-executed close would be visible.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(global.browser.tabs.remove).not.toHaveBeenCalled();
  });

  test("does not let an external download execute a source-tab action", async () => {
    vi.mocked(global.browser.tabs.remove).mockClear();
    vi.mocked(Download.launchDownload).mockImplementationOnce(async (state) => {
      state.scratch.routeTabAction = "close";
      return { status: "started", downloadId: 7 };
    });
    const sendResponse = vi.fn();

    expect(
      onMessageExternal(request(), { id: "trusted-extension", tab: { id: 9 } }, sendResponse),
    ).toBe(true);
    await waitForCall(sendResponse);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(global.browser.tabs.remove).not.toHaveBeenCalled();
  });

  test("an external activeTab request owns the tab it named for the route action", async () => {
    vi.mocked(global.browser.tabs.remove).mockClear();
    vi.mocked(global.browser.tabs.get).mockResolvedValueOnce({
      id: 9,
      url: "https://x/",
    } as browser.tabs.Tab);
    vi.mocked(Download.launchDownload).mockImplementationOnce(async (state) => {
      state.scratch.routeTabAction = "close";
      return { status: "started", downloadId: 7 };
    });
    const sendResponse = vi.fn();

    expect(
      onMessageExternal(
        request({ url: undefined, target: "activeTab" }),
        { id: "trusted-extension", tab: { id: 9, url: "https://x/" } },
        sendResponse,
      ),
    ).toBe(true);
    await waitForCall(sendResponse);

    await vi.waitFor(() => expect(global.browser.tabs.remove).toHaveBeenCalledWith(9));
  });

  test("external downloads wait for cold-start initialization", async () => {
    let finish!: () => void;
    backgroundRuntime.ready = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const sendResponse = vi.fn();

    expect(
      onMessageExternal(request(), { id: "trusted-extension", tab: { id: 9 } }, sendResponse),
    ).toBe(true);
    expect(Download.launchDownload).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();

    finish();
    await backgroundRuntime.ready;
    await waitForCall(sendResponse);
    expect(Download.launchDownload).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: { status: MESSAGE_TYPES.OK, version: 1, url: "https://x/file.png" },
    });
  });
});

describe("automatic page-source downloads", () => {
  const request = {
    type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
    body: {
      pageUrl: "https://example.test/gallery/",
      sourceUrl: "https://cdn.test/original/cat.png",
      sourceKind: "image" as const,
    },
  };
  const configure = () => {
    options.autoDownloadEnabled = true;
    options.autoDownloadPrivate = false;
    options.filenamePatterns = parseRulesCollecting(`
context: ^auto$
pageurl: ^https://example\\.test/gallery/
sourcekind: image
sourceurl: /original/
into: automatic/:pagedomain:/
`).rules;
  };

  test("revalidates a candidate and launches it with the matching destination", async () => {
    configure();
    const sendResponse = vi.fn();
    const senderTab = {
      id: 7,
      url: "https://example.test/gallery/",
      title: "Gallery",
      incognito: false,
    };

    expect(onMessage(request, { tab: senderTab }, sendResponse)).toBe(true);
    await waitForCall(sendResponse);

    expect(Download.launchDownload).toHaveBeenCalledOnce();
    const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
    expect(state.path).toMatchObject({ raw: "." });
    expect(state.scratch.routeTemplateRaw).toBe("automatic/:pagedomain:/");
    expect(state.info).toMatchObject({
      currentTab: senderTab,
      context: DOWNLOAD_TYPES.AUTO,
      pageUrl: senderTab.url,
      sourceUrl: request.body.sourceUrl,
      sourceKind: "image",
      url: request.body.sourceUrl,
    });
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
      body: { status: "started" },
    });
  });

  // The page's per-visit limit lives in its content script, which a reload
  // replaces. A hostile page a rule matches reloads itself in a loop, offering
  // fresh matching addresses each time.
  describe("a budget the page cannot reset by reloading", () => {
    const tab = { id: 7, url: "https://example.test/gallery/", incognito: false };
    const offer = async (index: number, senderTab: Record<string, unknown> = tab) => {
      const sendResponse = vi.fn();
      await handleAutoDownloadSource(
        {
          ...request,
          body: { ...request.body, sourceUrl: `https://cdn.test/original/${index}.png` },
        },
        { tab: senderTab },
        sendResponse,
      );
      return sendResponse.mock.calls[0]![0].body.status as string;
    };
    const offerMany = async (count: number, senderTab?: Record<string, unknown>) => {
      const statuses: string[] = [];
      for (let index = 0; index < count; index += 1) statuses.push(await offer(index, senderTab));
      return statuses;
    };
    const budgetLogs = () =>
      vi
        .mocked(Log.addLogEntry)
        .mock.calls.filter(([message]) => message === "automatic Page Sources: tab budget reached");
    let session: ReturnType<typeof webExtensionStorageArea>;
    let now: number;

    beforeEach(() => {
      configure();
      session = webExtensionStorageArea();
      (global.browser as any).storage.session = session;
      now = 1_800_000_000_000;
      vi.spyOn(Date, "now").mockImplementation(() => now);
    });

    test("stops launching after three visits' worth of saves and logs it once", async () => {
      const statuses = await offerMany(75);

      expect(statuses.filter((status) => status === "started")).toHaveLength(60);
      expect(statuses.slice(60)).toEqual(Array.from({ length: 15 }, () => "skipped"));
      expect(Download.launchDownload).toHaveBeenCalledTimes(60);
      expect(budgetLogs()).toEqual([
        [
          "automatic Page Sources: tab budget reached",
          { limit: 60, windowMinutes: 10 },
          { privateContext: false },
        ],
      ]);
    });

    test("follows the configured per-visit limit", async () => {
      options.autoDownloadMaxPerPage = 2;

      expect(await offerMany(8)).toEqual([
        ...Array.from({ length: 6 }, () => "started"),
        "skipped",
        "skipped",
      ]);
    });

    test("another tab, and another site in the same tab, are not affected", async () => {
      options.autoDownloadMaxPerPage = 1;
      options.filenamePatterns = parseRulesCollecting(`
context: ^auto$
pageurl: ^https://(example|other)\\.test/gallery/
sourcekind: image
into: automatic/
`).rules;
      await offerMany(5);

      expect(await offer(100)).toBe("skipped");
      expect(await offer(101, { ...tab, id: 8 })).toBe("started");
      expect(await offer(102, { ...tab, url: "https://other.test/gallery/" })).toBe("started");
    });

    test("ordinary paging is saved again once the window has moved on", async () => {
      options.autoDownloadMaxPerPage = 1;
      await offerMany(5);
      expect(await offer(100)).toBe("skipped");

      now += 20 * 60 * 1000;

      expect(await offer(101)).toBe("started");
    });

    test.each([
      ["skipped", async () => ({ status: "skipped" as const })],
      ["failed", async () => ({ status: "failed" as const })],
    ])("a save the pipeline %s does not spend the budget", async (_label, outcome) => {
      options.autoDownloadMaxPerPage = 1;
      vi.mocked(Download.launchDownload).mockImplementation(outcome);
      await offerMany(20);
      vi.mocked(Download.launchDownload).mockResolvedValue({ status: "started", downloadId: 1 });

      expect(await offerMany(4)).toEqual(["started", "started", "started", "skipped"]);
    });

    test("a save that throws does not spend the budget", async () => {
      options.autoDownloadMaxPerPage = 1;
      vi.mocked(Download.launchDownload).mockRejectedValue(new Error("launch failed"));
      for (let index = 0; index < 5; index += 1) {
        await expect(offer(index)).rejects.toThrow("launch failed");
      }
      vi.mocked(Download.launchDownload).mockResolvedValue({ status: "started", downloadId: 1 });

      expect(await offerMany(4)).toEqual(["started", "started", "started", "skipped"]);
    });

    test("keeps only counts, and no origin for a private tab", async () => {
      options.autoDownloadPrivate = true;
      await offer(1);
      await offer(2, { ...tab, id: 9, incognito: true });

      const stored = (await session.get("siAutomaticSaveBudget")) as Record<string, unknown>;
      expect(stored.siAutomaticSaveBudget).toEqual({
        "7|https://example.test": { start: now, count: 1, previous: 0, logged: false },
        "9|": { start: now, count: 1, previous: 0, logged: false },
      });
    });

    test("a private tab's refusal is logged as private", async () => {
      options.autoDownloadPrivate = true;
      options.autoDownloadMaxPerPage = 1;

      await offerMany(5, { ...tab, incognito: true });

      expect(budgetLogs()).toEqual([
        [
          "automatic Page Sources: tab budget reached",
          { limit: 3, windowMinutes: 10 },
          { privateContext: true },
        ],
      ]);
    });

    test("a storage failure does not stop automatic saves", async () => {
      options.autoDownloadMaxPerPage = 1;
      session.get.mockImplementation(() => Promise.reject(new Error("storage unavailable")));

      expect(await offerMany(5)).toEqual(Array.from({ length: 5 }, () => "started"));
    });
  });

  test.each(["skipped", "failed"] as const)(
    "holds the page's once-per-visit slot when the pipeline answers %s after launching",
    async (status) => {
      configure();
      vi.mocked(Download.launchDownload).mockResolvedValueOnce({ status });
      const sendResponse = vi.fn();

      onMessage(
        request,
        { tab: { id: 7, url: "https://example.test/gallery/", incognito: false } },
        sendResponse,
      );
      await waitForCall(sendResponse);

      // A declined save (existing file, dismissed Save As) was consumed; only a
      // pre-launch gate may tell the page to offer the candidate again.
      expect(sendResponse).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
        body: { status: status === "skipped" ? "started" : "failed" },
      });
    },
  );

  test("answers declined when History already holds the address", async () => {
    configure();
    vi.mocked(Download.launchDownload).mockImplementationOnce(async (state) => {
      state.scratch.savedSourceSkipped = true;
      return { status: "skipped" };
    });
    const sendResponse = vi.fn();

    onMessage(
      request,
      { tab: { id: 7, url: "https://example.test/gallery/", incognito: false } },
      sendResponse,
    );
    await waitForCall(sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
      body: { status: "declined" },
    });
  });

  test("a script-media replay waits for cold-start initialization", async () => {
    let finish!: () => void;
    backgroundRuntime.ready = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const forTab = vi.spyOn(Collector, "automaticScriptMediaForTab").mockResolvedValue([]);
    const sendResponse = vi.fn();

    onMessage(
      { type: MESSAGE_TYPES.SCRIPT_MEDIA_AUTO_REPLAY, body: { visitStart: 1 } },
      { tab: { id: 7, url: "https://example.test/gallery/", incognito: false } },
      sendResponse,
    );
    await Promise.resolve();
    expect(sendResponse).not.toHaveBeenCalled();

    // Options load during init; the gate must read them only afterwards.
    options.autoDownloadEnabled = true;
    options.autoDownloadScriptMedia = true;
    finish();
    await waitForCall(sendResponse);
    expect(forTab).toHaveBeenCalled();
  });

  test("revalidates a terminal exclusion without launching a download", async () => {
    configure();
    options.filenamePatterns = parseRulesCollecting(`
context: ^auto$
pageurl: ^https://example\\.test/gallery/
sourceurl: /original/
exclude: true

context: ^auto$
pageurl: ^https://example\\.test/gallery/
sourcekind: image
into: automatic/
`).rules;
    const sendResponse = vi.fn();
    const senderTab = { id: 7, url: request.body.pageUrl, incognito: false };

    expect(onMessage(request, { tab: senderTab }, sendResponse)).toBe(true);
    await waitForCall(sendResponse);

    expect(Download.launchDownload).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
      body: { status: "skipped" },
    });
  });

  test("rechecks CSS attestations against the current automatic rule", async () => {
    options.autoDownloadEnabled = true;
    options.autoDownloadPrivate = false;
    options.filenamePatterns = parseRulesCollecting(`
context: ^auto$
pageurl: ^https://example\\.test/gallery/
css: article img
css: img:not(.avatar)
into: automatic/
`).rules;
    const senderTab = { id: 7, url: request.body.pageUrl, incognito: false };

    const stale = vi.fn();
    onMessage(request, { url: senderTab.url, tab: senderTab }, stale);
    await waitForCall(stale);
    expect(Download.launchDownload).not.toHaveBeenCalled();

    const splitOrigins = vi.fn();
    onMessage(
      {
        ...request,
        body: {
          ...request.body,
          matchedCssSelectorsByOrigin: [["article img"], ["img:not(.avatar)"]],
        },
      },
      { url: senderTab.url, tab: senderTab },
      splitOrigins,
    );
    await waitForCall(splitOrigins);
    expect(Download.launchDownload).not.toHaveBeenCalled();

    const matched = vi.fn();
    onMessage(
      {
        ...request,
        body: {
          ...request.body,
          matchedCssSelectorsByOrigin: [["article img", "img:not(.avatar)"]],
        },
      },
      { url: senderTab.url, tab: senderTab },
      matched,
    );
    await waitForCall(matched);
    expect(Download.launchDownload).toHaveBeenCalledOnce();
    expect(vi.mocked(Download.launchDownload).mock.calls[0]![0]!.info).toMatchObject({
      matchedCssSelectorsByOrigin: [["article img", "img:not(.avatar)"]],
    });
  });

  test("names an automatic save after page text only its own page reported", async () => {
    options.autoDownloadEnabled = true;
    options.autoDownloadPrivate = false;
    options.filenamePatterns = parseRulesCollecting(`
context: ^auto$
pageurl: ^https://example\\.test/gallery/
sourcekind: image
pagetext: header .author
into: authors/:pagetext:/
`).rules;
    const senderTab = { id: 7, url: request.body.pageUrl, incognito: false };
    const withText = {
      ...request,
      body: { ...request.body, capturedPageText: [["header .author", "example author"]] },
    };

    const missing = vi.fn();
    onMessage(request, { url: senderTab.url, tab: senderTab }, missing);
    await waitForCall(missing);
    expect(Download.launchDownload).not.toHaveBeenCalled();

    // A frame of the page is not the page: its text does not satisfy the rule.
    const framed = vi.fn();
    onMessage(withText, { url: "https://frame.test/", tab: senderTab }, framed);
    await waitForCall(framed);
    expect(framed).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
      body: { status: "skipped" },
    });
    expect(Download.launchDownload).not.toHaveBeenCalled();

    const matched = vi.fn();
    onMessage(withText, { url: senderTab.url, tab: senderTab }, matched);
    await waitForCall(matched);
    expect(Download.launchDownload).toHaveBeenCalledOnce();
    const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
    expect(state.scratch.routeTemplateRaw).toBe("authors/:pagetext:/");
    expect(state.info).toMatchObject({
      pageText: "example author",
      capturedPageText: [["header .author", "example author"]],
    });
  });

  test("an automatic rule without pagetext: launches with no page text", async () => {
    options.autoDownloadEnabled = true;
    options.autoDownloadPrivate = false;
    options.filenamePatterns = parseRulesCollecting(`
context: ^auto$
pageurl: ^https://example\\.test/gallery/
sourcekind: image
into: automatic/
`).rules;
    const senderTab = { id: 7, url: request.body.pageUrl, incognito: false };
    const sendResponse = vi.fn();

    onMessage(request, { url: senderTab.url, tab: senderTab }, sendResponse);
    await waitForCall(sendResponse);

    expect(vi.mocked(Download.launchDownload).mock.calls[0]![0]!.info).not.toHaveProperty(
      "pageText",
    );
  });

  test("passes a matched rule's fetch template through to the launch scratch", async () => {
    options.autoDownloadEnabled = true;
    options.autoDownloadPrivate = false;
    options.filenamePatterns = parseRulesCollecting(`
context: ^auto$
pageurl: ^https://example\\.test/gallery/
sourceurl: ^https://cdn\\.test/original/([\\w.]+)$
capturegroups: sourceurl
fetch: https://cdn.test/full/:$1:
into: automatic/:$1:
`).rules;
    const sendResponse = vi.fn();
    const senderTab = { id: 7, url: "https://example.test/gallery/", incognito: false };

    expect(onMessage(request, { tab: senderTab }, sendResponse)).toBe(true);
    await waitForCall(sendResponse);

    const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
    expect(state.scratch.routeTemplateRaw).toBe("automatic/cat.png");
    expect(state.scratch.fetchTemplateRaw).toBe("https://cdn.test/full/cat.png");
  });

  test("passes a matched rule's rename transform through to the launch scratch", async () => {
    options.autoDownloadEnabled = true;
    options.autoDownloadPrivate = false;
    options.filenamePatterns = parseRulesCollecting(`
context: ^auto$
pageurl: ^https://example\\.test/gallery/
sourceurl: ^https://cdn\\.test/original/([\\w.]+)$
capturegroups: sourceurl
rename/i: ^cat -> pet-:$1:
into: automatic/:filename:
`).rules;
    const sendResponse = vi.fn();
    const senderTab = { id: 7, url: "https://example.test/gallery/", incognito: false };

    expect(onMessage(request, { tab: senderTab }, sendResponse)).toBe(true);
    await waitForCall(sendResponse);

    const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
    expect(state.scratch.routeTemplateRaw).toBe("automatic/:filename:");
    expect(state.scratch.renameTemplate).toEqual({
      find: "^cat",
      flags: "i",
      replacement: "pet-cat.png",
    });
  });

  test.each([
    ["the feature is disabled", () => (options.autoDownloadEnabled = false)],
    ["no rule matches", () => (options.filenamePatterns = [])],
    ["stored rules are malformed", () => (options.filenamePatterns = null as any)],
    ["the sender is private", () => undefined],
  ])("skips when %s", async (_label, arrange) => {
    configure();
    arrange();
    const sendResponse = vi.fn();
    const privateTab = _label === "the sender is private";
    onMessage(
      request,
      { tab: { id: 7, url: request.body.pageUrl, incognito: privateTab } },
      sendResponse,
    );

    await waitForCall(sendResponse);
    expect(Download.launchDownload).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
      body: { status: "skipped" },
    });
  });

  test.each(["not a URL", "ftp://cdn.test/file.png"])(
    "skips a non-HTTP source URL: %s",
    async (sourceUrl) => {
      configure();
      const sendResponse = vi.fn();
      onMessage(
        { ...request, body: { ...request.body, sourceUrl } },
        { tab: { id: 7, url: request.body.pageUrl } },
        sendResponse,
      );

      await waitForCall(sendResponse);
      expect(Download.launchDownload).not.toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
        body: { status: "skipped" },
      });
    },
  );

  test("backstops a stale content script on a disabled site", async () => {
    configure();
    // The sender-tab page matches the per-site disable list, so a save request
    // from a content script that has not yet torn down must be refused.
    options.perSiteDisableList = "*://example.test/*";
    const sendResponse = vi.fn();
    onMessage(
      request,
      { tab: { id: 7, url: "https://example.test/gallery/", incognito: false } },
      sendResponse,
    );

    await waitForCall(sendResponse);
    expect(Download.launchDownload).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
      body: { status: "skipped" },
    });
  });

  test("backstops a stale content script when the disable list cannot be read", async () => {
    configure();
    // A line the parser rejects reads as "no match", which used to let the save
    // through on the very site the line was written to exclude — and automatic
    // saves take no gesture, so nobody would see it happen.
    options.perSiteDisableList = "example.test/*";
    const sendResponse = vi.fn();
    onMessage(
      request,
      { tab: { id: 7, url: "https://example.test/gallery/", incognito: false } },
      sendResponse,
    );

    await waitForCall(sendResponse);
    expect(Download.launchDownload).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
      body: { status: "skipped" },
    });
  });

  test("a malformed stored disable list never blocks automatic saves", async () => {
    configure();
    // Legacy or corrupted storage can hold a non-string here; the backstop must
    // fall back to "nothing disabled" rather than guessing a match.
    options.perSiteDisableList = ["*://example.test/*"] as unknown as string;
    const sendResponse = vi.fn();
    onMessage(
      request,
      { tab: { id: 7, url: "https://example.test/gallery/", incognito: false } },
      sendResponse,
    );

    await waitForCall(sendResponse);
    expect(Download.launchDownload).toHaveBeenCalledOnce();
  });

  test("allows private automatic saves only when explicitly enabled", async () => {
    configure();
    options.autoDownloadPrivate = true;
    const sendResponse = vi.fn();
    onMessage(
      request,
      { tab: { id: 7, url: request.body.pageUrl, incognito: true } },
      sendResponse,
    );
    await waitForCall(sendResponse);
    expect(Download.launchDownload).toHaveBeenCalledOnce();
  });

  describe("phase-B channel backstop", () => {
    // No sourcekind restriction: isolates the channel/kind gate from rule
    // matching, exactly like the content-side discovery-boundary fixtures.
    const configureBroad = () => {
      options.autoDownloadEnabled = true;
      options.autoDownloadPrivate = false;
      // options is a shared singleton across tests in this file; a prior row's
      // "then allows it" mutation must not leak into the next row's refusal.
      options.autoDownloadLinks = false;
      options.autoDownloadDocuments = false;
      options.autoDownloadBackgrounds = false;
      options.autoDownloadManifests = false;
      options.filenamePatterns = parseRulesCollecting(`
context: ^auto$
pageurl: ^https://example\\.test/gallery/
sourceurl: cdn\\.test
into: automatic/:pagedomain:/
`).rules;
    };
    const senderTab = { id: 7, url: "https://example.test/gallery/", incognito: false };
    const channelRequest = (sourceKind: string, sourceChannel: string) => ({
      type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
      body: {
        pageUrl: senderTab.url,
        sourceUrl: "https://cdn.test/candidate",
        sourceKind,
        sourceChannel,
      },
    });

    test.each([
      ["document", "anchor", "autoDownloadDocuments"],
      ["stream", "anchor", "autoDownloadDocuments"],
      ["image", "background", "autoDownloadBackgrounds"],
      ["stream", "resource-hint", "autoDownloadManifests"],
    ] as const)(
      "refuses a stale %s/%s candidate until %s is on, then allows it",
      async (sourceKind, sourceChannel, optionName) => {
        configureBroad();
        const refused = vi.fn();
        onMessage(channelRequest(sourceKind, sourceChannel), { tab: senderTab }, refused);
        await waitForCall(refused);
        expect(Download.launchDownload).not.toHaveBeenCalled();
        expect(refused).toHaveBeenCalledWith({
          type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
          body: { status: "skipped" },
        });

        (options as unknown as Record<string, boolean>)[optionName] = true;
        const allowed = vi.fn();
        onMessage(channelRequest(sourceKind, sourceChannel), { tab: senderTab }, allowed);
        await waitForCall(allowed);
        expect(Download.launchDownload).toHaveBeenCalledOnce();
      },
    );

    test("a .m3u8 anchor is not adopted merely because the manifests option is on", async () => {
      configureBroad();
      options.autoDownloadManifests = true;
      const sendResponse = vi.fn();
      onMessage(channelRequest("stream", "anchor"), { tab: senderTab }, sendResponse);
      await waitForCall(sendResponse);
      expect(Download.launchDownload).not.toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
        body: { status: "skipped" },
      });
    });

    test("a resource-hint stream is not adopted merely because linked documents/streams is on", async () => {
      configureBroad();
      options.autoDownloadDocuments = true;
      const sendResponse = vi.fn();
      onMessage(channelRequest("stream", "resource-hint"), { tab: senderTab }, sendResponse);
      await waitForCall(sendResponse);
      expect(Download.launchDownload).not.toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
        body: { status: "skipped" },
      });
    });

    test("a malformed stored channel option never blocks embedded media", async () => {
      configure();
      // Legacy or corrupted storage can hold a non-boolean here; the backstop
      // must fall back to "channel off" without throwing, and embedded media
      // (no sourceChannel) is unaffected either way.
      options.autoDownloadDocuments = "yes" as unknown as boolean;
      const sendResponse = vi.fn();
      onMessage(
        request,
        { tab: { id: 7, url: request.body.pageUrl, incognito: false } },
        sendResponse,
      );
      await waitForCall(sendResponse);
      expect(Download.launchDownload).toHaveBeenCalledOnce();
    });
  });

  describe("script-media backstop", () => {
    const senderTab = { id: 7, url: "https://example.test/player/", incognito: false };
    const sourceUrl = "https://cdn.test/clips/intro.mp4";
    const configureScriptMedia = () => {
      options.autoDownloadEnabled = true;
      options.autoDownloadPrivate = false;
      options.autoDownloadScriptMedia = true;
      options.perSiteDisableList = "";
      options.filenamePatterns = parseRulesCollecting(`
context: ^auto$
pageurl: ^https://example\\.test/player/
sourcekind: ^video$
into: automatic/
`).rules;
    };
    const visitStart = 1234;
    const scriptMediaRequest = (
      sourceChannel?: string,
      extra: Record<string, unknown> = { scriptMediaVisitStart: visitStart },
    ) => ({
      type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
      body: {
        pageUrl: senderTab.url,
        sourceUrl,
        sourceKind: "video",
        ...(sourceChannel ? { sourceChannel } : {}),
        ...extra,
      },
    });
    const skipped = { type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE, body: { status: "skipped" } };

    test("refuses a script-media candidate while its option is off", async () => {
      configureScriptMedia();
      options.autoDownloadScriptMedia = false;
      const collected = vi
        .spyOn(Collector, "isAutomaticScriptMediaCollected")
        .mockResolvedValue(true);
      const sendResponse = vi.fn();
      onMessage(scriptMediaRequest("script-media"), { tab: senderTab }, sendResponse);
      await waitForCall(sendResponse);
      expect(sendResponse).toHaveBeenCalledWith(skipped);
      expect(collected).not.toHaveBeenCalled();
      expect(Download.launchDownload).not.toHaveBeenCalled();
    });

    test("refuses a URL the collector did not observe as a whole file in that tab", async () => {
      configureScriptMedia();
      const collected = vi
        .spyOn(Collector, "isAutomaticScriptMediaCollected")
        .mockResolvedValue(false);
      const sendResponse = vi.fn();
      onMessage(scriptMediaRequest("script-media"), { tab: senderTab }, sendResponse);
      await waitForCall(sendResponse);
      expect(collected).toHaveBeenCalledWith(7, sourceUrl, "video", { start: visitStart });
      expect(sendResponse).toHaveBeenCalledWith(skipped);
      expect(Download.launchDownload).not.toHaveBeenCalled();
    });

    test("checks the claim against the sender's own document and visit", async () => {
      configureScriptMedia();
      const collected = vi
        .spyOn(Collector, "isAutomaticScriptMediaCollected")
        .mockResolvedValue(true);
      const sendResponse = vi.fn();
      onMessage(
        scriptMediaRequest("script-media"),
        { tab: senderTab, documentId: "doc-b" },
        sendResponse,
      );
      await waitForCall(sendResponse);
      expect(collected).toHaveBeenCalledWith(7, sourceUrl, "video", {
        start: visitStart,
        documentId: "doc-b",
      });
      expect(Download.launchDownload).toHaveBeenCalledOnce();
    });

    test("refuses a script-media claim that names no visit", async () => {
      configureScriptMedia();
      const collected = vi
        .spyOn(Collector, "isAutomaticScriptMediaCollected")
        .mockResolvedValue(true);
      const sendResponse = vi.fn();
      onMessage(scriptMediaRequest("script-media", {}), { tab: senderTab }, sendResponse);
      await waitForCall(sendResponse);
      expect(collected).not.toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith(skipped);
      expect(Download.launchDownload).not.toHaveBeenCalled();
    });

    test("refuses a script-media claim from a sender without a tab id", async () => {
      configureScriptMedia();
      const collected = vi.spyOn(Collector, "isAutomaticScriptMediaCollected");
      const sendResponse = vi.fn();
      onMessage(
        scriptMediaRequest("script-media"),
        { tab: { url: senderTab.url, incognito: false } },
        sendResponse,
      );
      await waitForCall(sendResponse);
      expect(collected).not.toHaveBeenCalled();
      expect(Download.launchDownload).not.toHaveBeenCalled();
    });

    test("launches a confirmed candidate through the repeated rule match", async () => {
      configureScriptMedia();
      vi.spyOn(Collector, "isAutomaticScriptMediaCollected").mockResolvedValue(true);
      const sendResponse = vi.fn();
      onMessage(scriptMediaRequest("script-media"), { tab: senderTab }, sendResponse);
      await waitForCall(sendResponse);
      expect(Download.launchDownload).toHaveBeenCalledOnce();
      expect(vi.mocked(Download.launchDownload).mock.calls[0]![0]!.info).toMatchObject({
        sourceUrl,
        sourceKind: "video",
        context: DOWNLOAD_TYPES.AUTO,
      });
    });

    test("never consults the collector for embedded media", async () => {
      configureScriptMedia();
      const collected = vi.spyOn(Collector, "isAutomaticScriptMediaCollected");
      const sendResponse = vi.fn();
      onMessage(scriptMediaRequest(), { tab: senderTab }, sendResponse);
      await waitForCall(sendResponse);
      expect(collected).not.toHaveBeenCalled();
      expect(Download.launchDownload).toHaveBeenCalledOnce();
    });

    describe("replay", () => {
      const replay = {
        type: MESSAGE_TYPES.SCRIPT_MEDIA_AUTO_REPLAY,
        body: { visitStart },
      };
      const entries = [{ url: sourceUrl, kind: "video" as const, at: 1 }];

      test("hands the sender tab's buffered whole files to its discovery", async () => {
        configureScriptMedia();
        const forTab = vi.spyOn(Collector, "automaticScriptMediaForTab").mockResolvedValue(entries);
        const sendResponse = vi.fn();
        onMessage(replay, { tab: senderTab, documentId: "doc-b" }, sendResponse);
        await waitForCall(sendResponse);
        expect(forTab).toHaveBeenCalledWith(7, { start: visitStart, documentId: "doc-b" });
        expect(sendResponse).toHaveBeenCalledWith({
          type: MESSAGE_TYPES.SCRIPT_MEDIA_AUTO_REPLAY,
          body: { sources: entries },
        });
      });

      test.each([
        ["automatic saves are off", { autoDownloadEnabled: false }, senderTab],
        ["the script-media option is off", { autoDownloadScriptMedia: false }, senderTab],
        ["the option holds a malformed value", { autoDownloadScriptMedia: "yes" }, senderTab],
        ["the tab is private", {}, { ...senderTab, incognito: true }],
        ["the sender has no tab id", {}, { url: senderTab.url, incognito: false }],
        ["the request names no visit", {}, senderTab, {}],
      ])("offers nothing when %s", async (_label, overrides, tab, message: object = replay) => {
        configureScriptMedia();
        Object.assign(options, overrides);
        const forTab = vi.spyOn(Collector, "automaticScriptMediaForTab").mockResolvedValue(entries);
        const sendResponse = vi.fn();
        onMessage(
          { type: MESSAGE_TYPES.SCRIPT_MEDIA_AUTO_REPLAY, ...message },
          { tab },
          sendResponse,
        );
        await waitForCall(sendResponse);
        expect(forTab).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledWith({
          type: MESSAGE_TYPES.SCRIPT_MEDIA_AUTO_REPLAY,
          body: { sources: [] },
        });
      });

      test("offers a private tab its media once private automatic saves are on", async () => {
        configureScriptMedia();
        options.autoDownloadPrivate = true;
        vi.spyOn(Collector, "automaticScriptMediaForTab").mockResolvedValue(entries);
        const sendResponse = vi.fn();
        onMessage(replay, { tab: { ...senderTab, incognito: true } }, sendResponse);
        await waitForCall(sendResponse);
        expect(sendResponse).toHaveBeenCalledWith({
          type: MESSAGE_TYPES.SCRIPT_MEDIA_AUTO_REPLAY,
          body: { sources: entries },
        });
      });
    });
  });

  describe("phase-C data: backstop", () => {
    const senderTab = { id: 7, url: "https://example.test/gallery/", incognito: false };
    const configureData = (sourcePattern = "^data:image/") => {
      options.autoDownloadEnabled = true;
      options.autoDownloadPrivate = false;
      options.autoDownloadDataUrls = false;
      options.perSiteDisableList = "";
      options.filenamePatterns = parseRulesCollecting(`
context: ^auto$
pageurl: ^https://example\\.test/gallery/
sourcekind: image
sourceurl: ${sourcePattern}
into: automatic/
`).rules;
    };
    const dataRequest = (sourceUrl: string) => ({
      type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
      body: { pageUrl: senderTab.url, sourceUrl, sourceKind: "image" as const },
    });

    test("refuses a data: source until the option is on, then launches it with the parsed mime", async () => {
      configureData();
      const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
      const refused = vi.fn();
      onMessage(dataRequest(dataUrl), { tab: senderTab }, refused);
      await waitForCall(refused);
      expect(Download.launchDownload).not.toHaveBeenCalled();
      expect(refused).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
        body: { status: "skipped" },
      });

      options.autoDownloadDataUrls = true;
      const allowed = vi.fn();
      onMessage(dataRequest(dataUrl), { tab: senderTab }, allowed);
      await waitForCall(allowed);
      expect(Download.launchDownload).toHaveBeenCalledOnce();
      const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
      // The mediatype is parsed on the trusted side from the URL header, so
      // mime-based matching and :mimeext: naming resolve without a HEAD fetch.
      expect(state.info.mime).toBe("image/png");
      expect(state.info.url).toBe(dataUrl);
      expect(state.info.suggestedFilename).toBe("download");
      expect(state.info.context).toBe(DOWNLOAD_TYPES.AUTO);
    });

    test("treats a data: URL with no parseable mediatype as application/octet-stream", async () => {
      configureData("^data:");
      options.autoDownloadDataUrls = true;
      const sendResponse = vi.fn();
      onMessage(dataRequest("data:;base64,SGVsbG8="), { tab: senderTab }, sendResponse);
      await waitForCall(sendResponse);
      expect(Download.launchDownload).toHaveBeenCalledOnce();
      expect(vi.mocked(Download.launchDownload).mock.calls[0]![0]!.info.mime).toBe(
        "application/octet-stream",
      );
    });

    test("rejects an oversize data: source, logging one debug entry and never launching", async () => {
      configureData();
      options.autoDownloadDataUrls = true;
      const oversize = `data:image/png;base64,${"A".repeat(2 * 1024 * 1024 + 10)}`;
      const sendResponse = vi.fn();
      onMessage(dataRequest(oversize), { tab: senderTab }, sendResponse);
      await waitForCall(sendResponse);
      expect(Download.launchDownload).not.toHaveBeenCalled();
      expect(Log.addLogEntry).toHaveBeenCalledWith(
        "automatic data: source rejected: exceeds size cap",
        { length: oversize.length },
        { privateContext: false },
      );
      expect(sendResponse).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
        body: { status: "skipped" },
      });
    });

    test("never adopts a blob: source, even with the data: option on", async () => {
      configureData("^blob:");
      options.autoDownloadDataUrls = true;
      const sendResponse = vi.fn();
      onMessage(dataRequest("blob:https://example.test/2b8c"), { tab: senderTab }, sendResponse);
      await waitForCall(sendResponse);
      expect(Download.launchDownload).not.toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.AUTO_DOWNLOAD_SOURCE,
        body: { status: "skipped" },
      });
    });
  });
});

// Official versioned external API (#110)

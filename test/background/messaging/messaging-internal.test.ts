import {
  MESSAGE_TYPES,
  DOWNLOAD_TYPES,
  OptionsManagement,
  options,
  Menus,
  router,
  Variable,
  Path,
  backgroundRuntime,
  Download,
  HistoryMove,
  SaveHistory,
  ActiveTransfers,
  OffscreenClient,
  ExternalDownloadRejections,
  SourcePanelState,
  RoutePreview,
  Log,
  onMessage,
  onMessageExternal,
  setupGlobals,
  waitForCall,
} from "./messaging.fixture.ts";

beforeEach(() => setupGlobals());

describe("listener registration", () => {
  test("registers onMessage and onMessageExternal listeners at import", () => {
    expect(global.browser.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
    expect(global.browser.runtime.onMessageExternal.addListener).toHaveBeenCalledTimes(1);
    expect(onMessage).toEqual(expect.any(Function));
    expect(onMessageExternal).toEqual(expect.any(Function));
  });
});

describe("onMessage", () => {
  test("WAKE_WARM responds OK", () => {
    const sendResponse = vi.fn();
    onMessage({ type: MESSAGE_TYPES.WAKE_WARM }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ type: MESSAGE_TYPES.OK });
  });

  test.each([
    ["saved", "saved"],
    [42, 42],
    [Number.NaN, "."],
  ])("GET_CONFIG normalizes stored value option %#", async (stored, expected) => {
    vi.mocked(global.browser.storage.local.get).mockResolvedValueOnce({
      prompt: false,
      paths: stored,
    });
    const sendResponse = vi.fn();

    expect(onMessage({ type: MESSAGE_TYPES.GET_CONFIG }, {}, sendResponse)).toBe(true);
    await waitForCall(sendResponse);
    expect(sendResponse.mock.calls[0]![0]!.body.config.paths).toBe(expected);
  });

  test("omits automatic filenames when a candidate URL has no filename", async () => {
    const sendResponse = vi.fn();
    expect(
      onMessage(
        {
          type: MESSAGE_TYPES.VALIDATE,
          body: {
            filenamePatterns: "context: ^auto$",
            automaticCandidate: {
              pageUrl: "https://example.test/gallery",
              sourceUrl: "https://cdn.test/",
              sourceKind: "image",
            },
          },
        },
        {},
        sendResponse,
      ),
    ).toBe(true);
    await waitForCall(sendResponse);
    expect(vi.mocked(router.traceRules).mock.calls[0]![1]).toEqual({
      context: "AUTO",
      pageUrl: "https://example.test/gallery",
      sourceUrl: "https://cdn.test/",
      url: "https://cdn.test/",
      sourceKind: "image",
      mediaType: "image",
    });
  });

  // A data: URL has no path, so mime: is the documented way to match one. The
  // trace must seed it from the header exactly as the real automatic match
  // does, or the dry-run reports a working rule as broken.
  test("VALIDATE traces a data: candidate with the mediatype the save would match", async () => {
    const sendResponse = vi.fn();
    expect(
      onMessage(
        {
          type: MESSAGE_TYPES.VALIDATE,
          body: {
            filenamePatterns: "context: ^auto$",
            automaticCandidate: {
              pageUrl: "https://example.test/gallery",
              sourceUrl: "data:image/png;base64,iVBORw0KGgo=",
              sourceKind: "image",
            },
          },
        },
        {},
        sendResponse,
      ),
    ).toBe(true);
    await waitForCall(sendResponse);
    expect(vi.mocked(router.traceRules).mock.calls[0]![1]).toMatchObject({
      mime: "image/png",
    });
  });

  test("HISTORY_GET returns normalized history from its background owner", async () => {
    vi.mocked(SaveHistory.getHistoryEntries).mockResolvedValue([
      { id: "h1", url: "https://x.test/a" },
    ]);
    const sendResponse = vi.fn();

    expect(onMessage({ type: MESSAGE_TYPES.HISTORY_GET }, {}, sendResponse)).toBe(true);
    await waitForCall(sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.HISTORY_GET,
      body: { entries: [{ id: "h1", url: "https://x.test/a" }] },
    });
  });

  test("HISTORY_CLEAR waits for the serialized background clear", async () => {
    const sendResponse = vi.fn();
    expect(onMessage({ type: MESSAGE_TYPES.HISTORY_CLEAR }, {}, sendResponse)).toBe(true);
    await waitForCall(sendResponse);
    expect(SaveHistory.clearHistory).toHaveBeenCalledOnce();
    expect(sendResponse).toHaveBeenCalledWith({ type: MESSAGE_TYPES.OK });
  });

  test("HISTORY_CANCEL aborts offscreen and active browser transfers", async () => {
    vi.mocked(ActiveTransfers.getActiveTransfer).mockReturnValue({
      requestId: "request-1",
      downloadId: 17,
      updatedAt: 1,
    });
    vi.mocked(ActiveTransfers.cancelActiveTransfer).mockReturnValue(true);
    vi.mocked(OffscreenClient.canUse).mockReturnValue(true);
    vi.mocked(OffscreenClient.cancel).mockRejectedValue(new Error("already released"));
    vi.mocked(global.browser.downloads.search).mockResolvedValue([
      { id: 17, state: "in_progress" } as any,
    ]);
    const sendResponse = vi.fn();

    expect(
      onMessage(
        { type: MESSAGE_TYPES.HISTORY_CANCEL, body: { historyId: "history-1" } },
        {},
        sendResponse,
      ),
    ).toBe(true);
    await waitForCall(sendResponse);

    expect(OffscreenClient.cancel).toHaveBeenCalledWith("request-1");
    expect(global.browser.downloads.cancel).toHaveBeenCalledWith(17);
    expect(SaveHistory.setHistoryStatus).toHaveBeenCalledWith("history-1", "USER_CANCELED", 17);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.HISTORY_CANCEL,
      body: { canceled: true },
    });
  });

  test("HISTORY_UNDO removes the file, erases the shelf entry, and marks the entry", async () => {
    vi.mocked(SaveHistory.getHistoryEntries).mockResolvedValue([
      { id: "history-9", url: "https://x.test/file.png", downloadId: 31, status: "complete" },
    ]);
    vi.mocked(global.browser.downloads.search).mockResolvedValue([
      { id: 31, url: "https://x.test/file.png" } as never,
    ]);
    const sendResponse = vi.fn();

    expect(
      onMessage(
        { type: MESSAGE_TYPES.HISTORY_UNDO, body: { historyId: "history-9" } },
        {},
        sendResponse,
      ),
    ).toBe(true);
    await waitForCall(sendResponse);

    expect(global.browser.downloads.removeFile).toHaveBeenCalledWith(31);
    expect(global.browser.downloads.erase).toHaveBeenCalledWith({ id: 31 });
    expect(SaveHistory.setHistoryStatus).toHaveBeenCalledWith("history-9", "undone", 31);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.HISTORY_UNDO,
      body: { undone: true, fileMissing: false },
    });
  });

  test("HISTORY_UNDO still erases and marks when the file is already gone", async () => {
    vi.mocked(SaveHistory.getHistoryEntries).mockResolvedValue([
      { id: "history-10", url: "https://x.test/gone.png", downloadId: 32, status: "complete" },
    ]);
    vi.mocked(global.browser.downloads.search).mockResolvedValue([
      { id: 32, url: "https://x.test/gone.png" } as never,
    ]);
    vi.mocked(global.browser.downloads.removeFile).mockRejectedValueOnce(new Error("no such file"));
    const sendResponse = vi.fn();

    onMessage(
      { type: MESSAGE_TYPES.HISTORY_UNDO, body: { historyId: "history-10" } },
      {},
      sendResponse,
    );
    await waitForCall(sendResponse);

    expect(global.browser.downloads.erase).toHaveBeenCalledWith({ id: 32 });
    expect(SaveHistory.setHistoryStatus).toHaveBeenCalledWith("history-10", "undone", 32);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.HISTORY_UNDO,
      body: { undone: true, fileMissing: true },
    });
  });

  test("HISTORY_REROUTE re-downloads, removes the verified original, and links the rows", async () => {
    vi.mocked(SaveHistory.getHistoryEntries).mockResolvedValue([
      {
        id: "history-20",
        url: "https://x.test/moved.png",
        finalFullPath: "from/moved.png",
        downloadId: 41,
        status: "complete",
        downloadStartTime: "2026-07-17T01:02:03.000Z",
        variables: { suggestedfilename: "moved.png", comment: "archive" },
      },
    ]);
    vi.mocked(global.browser.downloads.search).mockResolvedValue([
      {
        id: 41,
        url: "https://x.test/moved.png",
        startTime: "2026-07-17T01:02:03.000Z",
        state: "complete",
      } as never,
    ]);
    vi.mocked(Download.launchDownload).mockImplementation(async (state) => {
      state.scratch.historyEntryId = "history-new";
      return { status: "started", downloadId: 42 };
    });
    vi.mocked(HistoryMove.completePendingHistoryMove).mockResolvedValue({
      handled: true,
      oldRemoved: true,
      newHistoryId: "history-new",
    });
    const sendResponse = vi.fn();

    expect(
      onMessage(
        {
          type: MESSAGE_TYPES.HISTORY_REROUTE,
          body: { historyId: "history-20", destination: "moved/here" },
        },
        {},
        sendResponse,
      ),
    ).toBe(true);
    await waitForCall(sendResponse);

    const state = vi.mocked(Download.launchDownload).mock.calls[0]![0]!;
    expect(state.path.finalize()).toBe("moved/here");
    expect(state.info.url).toBe("https://x.test/moved.png");
    expect(state.info.suggestedFilename).toBe("moved.png");
    expect(state.info.comment).toBe("archive");
    expect(HistoryMove.registerPendingHistoryMove).toHaveBeenCalledWith(42, {
      historyId: "history-20",
      downloadId: 41,
      startTime: "2026-07-17T01:02:03.000Z",
      filename: "from/moved.png",
    });
    // A reroute re-issues an existing save; it must not double-report through
    // the webhook.
    expect(state.info.webhookEligible).toBe(false);
    expect(HistoryMove.completePendingHistoryMove).toHaveBeenCalledWith(42);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.HISTORY_REROUTE,
      body: { rerouted: true, oldRemoved: true, newHistoryId: "history-new" },
    });
  });

  // A move routes a replacement and then deletes the original. Options stay at
  // their seeded defaults when init fails, so an ungated handler would drop
  // every routing rule and still destroy the only copy.
  test("HISTORY_REROUTE refuses instead of routing when initialization failed", async () => {
    const previousReady = backgroundRuntime.ready;
    backgroundRuntime.ready = Promise.reject(new Error("init failed"));
    backgroundRuntime.ready.catch(() => {});
    vi.mocked(SaveHistory.getHistoryEntries).mockResolvedValue([
      {
        id: "history-init-failed",
        url: "https://x.test/original.png",
        finalFullPath: "from/original.png",
        downloadId: 70,
        status: "complete",
      },
    ]);
    vi.mocked(global.browser.downloads.search).mockResolvedValue([
      { id: 70, url: "https://x.test/original.png" } as never,
    ]);
    vi.mocked(Download.launchDownload).mockResolvedValue({ status: "started", downloadId: 71 });
    vi.mocked(Download.launchDownload).mockClear();
    vi.mocked(global.browser.downloads.removeFile).mockClear();
    const sendResponse = vi.fn();

    onMessage(
      {
        type: MESSAGE_TYPES.HISTORY_REROUTE,
        body: { historyId: "history-init-failed", destination: "moved/here" },
      },
      {},
      sendResponse,
    );
    await waitForCall(sendResponse);

    expect(Download.launchDownload).not.toHaveBeenCalled();
    expect(global.browser.downloads.removeFile).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.HISTORY_REROUTE,
      body: {
        status: MESSAGE_TYPES.ERROR,
        error: "INTERNAL_ERROR",
        message: "Save In could not complete the request",
      },
    });
    if (previousReady) backgroundRuntime.ready = previousReady;
  });

  test("HISTORY_REROUTE keeps the original when the accepted replacement later fails", async () => {
    vi.mocked(SaveHistory.getHistoryEntries).mockResolvedValue([
      {
        id: "history-late-failure",
        url: "https://x.test/original.png",
        finalFullPath: "from/original.png",
        downloadId: 60,
        status: "complete",
      },
    ]);
    vi.mocked(global.browser.downloads.search).mockResolvedValue([
      { id: 60, url: "https://x.test/original.png" } as never,
    ]);
    vi.mocked(Download.launchDownload).mockResolvedValue({ status: "started", downloadId: 61 });
    vi.mocked(global.browser.downloads.search)
      .mockResolvedValueOnce([{ id: 60, url: "https://x.test/original.png" } as never])
      .mockResolvedValueOnce([{ id: 61, state: "interrupted" } as never]);
    vi.mocked(global.browser.downloads.removeFile).mockClear();
    const sendResponse = vi.fn();

    onMessage(
      {
        type: MESSAGE_TYPES.HISTORY_REROUTE,
        body: { historyId: "history-late-failure", destination: "moved/here" },
      },
      {},
      sendResponse,
    );
    await waitForCall(sendResponse);

    expect(HistoryMove.abandonPendingHistoryMove).toHaveBeenCalledWith(61);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.HISTORY_REROUTE,
      body: { rerouted: false, oldRemoved: false },
    });
  });

  test("HISTORY_REROUTE treats an already-handled completion race as pending, not failure", async () => {
    vi.mocked(SaveHistory.getHistoryEntries).mockResolvedValue([
      {
        id: "history-completion-race",
        url: "https://x.test/original.png",
        finalFullPath: "from/original.png",
        downloadId: 66,
        status: "complete",
      },
    ]);
    vi.mocked(global.browser.downloads.search).mockResolvedValue([
      { id: 66, url: "https://x.test/original.png", state: "complete" } as never,
    ]);
    vi.mocked(Download.launchDownload).mockResolvedValue({ status: "started", downloadId: 67 });
    vi.mocked(HistoryMove.completePendingHistoryMove).mockResolvedValue({
      handled: false,
      oldRemoved: false,
    });
    const sendResponse = vi.fn();

    onMessage(
      {
        type: MESSAGE_TYPES.HISTORY_REROUTE,
        body: { historyId: "history-completion-race", destination: "moved/here" },
      },
      {},
      sendResponse,
    );
    await waitForCall(sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.HISTORY_REROUTE,
      body: { rerouted: true, oldRemoved: false, pending: true },
    });
  });

  test("HISTORY_REROUTE restores recorded private routing context and menu variables", async () => {
    vi.mocked(SaveHistory.getHistoryEntries).mockResolvedValue([
      {
        id: "history-context",
        url: "https://cdn.test/photo.png",
        finalFullPath: "from/photo.png",
        downloadId: 62,
        status: "complete",
        private: true,
        info: {
          context: DOWNLOAD_TYPES.MEDIA,
          sourceUrl: "https://cdn.test/photo.png",
          pageUrl: "https://page.test/gallery",
        },
        menu: { id: "save-in-2", title: "Pictures", path: "old/path" },
        variables: {
          pagetitle: "Gallery",
          linktext: "Full-size photo",
          linktitle: "Open original",
          linkdownload: "original-photo.png",
          selection: "selected words",
          menuindex: "2",
          gesture: "double-left-click",
          comment: "photos",
          suggestedfilename: "photo.png",
          frameurl: "https://page.test/frame",
          referrerurl: "https://page.test/referrer",
          mediatype: "image",
          sourcekind: "video",
          mime: "image/png",
        },
      },
    ]);
    vi.mocked(global.browser.downloads.search).mockResolvedValue([
      { id: 62, url: "https://cdn.test/photo.png" } as never,
    ]);
    vi.mocked(Download.launchDownload).mockImplementation(async (state) => {
      state.scratch.historyEntryId = "history-context-new";
      return { status: "started", downloadId: 63 };
    });
    const sendResponse = vi.fn();

    onMessage(
      {
        type: MESSAGE_TYPES.HISTORY_REROUTE,
        body: { historyId: "history-context", destination: "new/path" },
      },
      {},
      sendResponse,
    );
    await waitForCall(sendResponse);

    expect(vi.mocked(Download.launchDownload).mock.calls[0]![0]!.info).toMatchObject({
      context: DOWNLOAD_TYPES.MEDIA,
      sourceUrl: "https://cdn.test/photo.png",
      pageUrl: "https://page.test/gallery",
      linkText: "Full-size photo",
      linkTitle: "Open original",
      linkDownload: "original-photo.png",
      selectionText: "selected words",
      menuIndex: "2",
      gesture: "double-left-click",
      menuItemId: "save-in-2",
      menuItemTitle: "Pictures",
      menuItemPath: "new/path",
      currentTab: {
        title: "Gallery",
        url: "https://page.test/gallery",
        incognito: true,
      },
      // A rule keyed on any of these matchers must route the moved copy the
      // same way it routed the original.
      frameUrl: "https://page.test/frame",
      referrerUrl: "https://page.test/referrer",
      mediaType: "image",
      sourceKind: "video",
      mime: "image/png",
    });
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.HISTORY_REROUTE,
      body: {
        rerouted: true,
        oldRemoved: false,
        pending: true,
        newHistoryId: "history-context-new",
      },
    });
  });

  test("HISTORY_REROUTE keeps a private context without recorded page metadata", async () => {
    vi.mocked(SaveHistory.getHistoryEntries).mockResolvedValue([
      {
        id: "history-private-legacy",
        url: "https://cdn.test/private.png",
        finalFullPath: "from/private.png",
        downloadId: 64,
        status: "complete",
        private: true,
      },
    ]);
    vi.mocked(global.browser.downloads.search).mockResolvedValue([
      { id: 64, url: "https://cdn.test/private.png" } as never,
    ]);
    vi.mocked(Download.launchDownload).mockResolvedValue({
      status: "started",
      downloadId: 65,
    });
    const sendResponse = vi.fn();

    onMessage(
      {
        type: MESSAGE_TYPES.HISTORY_REROUTE,
        body: { historyId: "history-private-legacy", destination: "new/path" },
      },
      {},
      sendResponse,
    );
    await waitForCall(sendResponse);

    expect(vi.mocked(Download.launchDownload).mock.calls[0]![0]!.info.currentTab).toEqual({
      incognito: true,
    });
    // No matcher evidence was recorded, so none of it is fabricated for the
    // reroute.
    const rerouteInfo = vi.mocked(Download.launchDownload).mock.calls[0]![0]!.info;
    expect(rerouteInfo.frameUrl).toBeUndefined();
    expect(rerouteInfo.referrerUrl).toBeUndefined();
    expect(rerouteInfo.mediaType).toBeUndefined();
    expect(rerouteInfo.sourceKind).toBeUndefined();
    expect(rerouteInfo.mime).toBeUndefined();
  });

  test("HISTORY_REROUTE ignores an unrecognized recorded sourcekind instead of fabricating one", async () => {
    vi.mocked(SaveHistory.getHistoryEntries).mockResolvedValue([
      {
        id: "history-bad-sourcekind",
        url: "https://cdn.test/photo.png",
        finalFullPath: "from/photo.png",
        downloadId: 66,
        status: "complete",
        variables: { sourcekind: "not-a-real-kind" },
      },
    ]);
    vi.mocked(global.browser.downloads.search).mockResolvedValue([
      { id: 66, url: "https://cdn.test/photo.png" } as never,
    ]);
    vi.mocked(Download.launchDownload).mockResolvedValue({ status: "started", downloadId: 67 });
    const sendResponse = vi.fn();

    onMessage(
      {
        type: MESSAGE_TYPES.HISTORY_REROUTE,
        body: { historyId: "history-bad-sourcekind", destination: "new/path" },
      },
      {},
      sendResponse,
    );
    await waitForCall(sendResponse);

    expect(vi.mocked(Download.launchDownload).mock.calls[0]![0]!.info.sourceKind).toBeUndefined();
  });

  test("HISTORY_REROUTE re-downloads generated data bytes instead of their originating page", async () => {
    const generatedUrl = "data:text/plain;base64,c2VsZWN0ZWQ=";
    vi.mocked(SaveHistory.getHistoryEntries).mockResolvedValue([
      {
        id: "history-generated",
        url: generatedUrl,
        finalFullPath: "from/selection.txt",
        downloadId: 64,
        status: "complete",
        info: {
          context: DOWNLOAD_TYPES.SELECTION,
          sourceUrl: "https://page.test/article",
          pageUrl: "https://page.test/article",
        },
      },
    ]);
    vi.mocked(global.browser.downloads.search).mockResolvedValue([
      { id: 64, url: generatedUrl } as never,
    ]);
    vi.mocked(Download.launchDownload).mockResolvedValue({ status: "started", downloadId: 65 });
    const sendResponse = vi.fn();

    onMessage(
      {
        type: MESSAGE_TYPES.HISTORY_REROUTE,
        body: { historyId: "history-generated", destination: "new/path" },
      },
      {},
      sendResponse,
    );
    await waitForCall(sendResponse);

    expect(vi.mocked(Download.launchDownload).mock.calls[0]![0]!.info.url).toBe(generatedUrl);
  });

  test("HISTORY_REROUTE refuses an unknown entry without launching anything", async () => {
    vi.mocked(SaveHistory.getHistoryEntries).mockResolvedValue([]);
    vi.mocked(Download.launchDownload).mockClear();
    vi.mocked(global.browser.downloads.removeFile).mockClear();
    const sendResponse = vi.fn();

    onMessage(
      {
        type: MESSAGE_TYPES.HISTORY_REROUTE,
        body: { historyId: "history-absent", destination: "moved/here" },
      },
      {},
      sendResponse,
    );
    await waitForCall(sendResponse);

    expect(Download.launchDownload).not.toHaveBeenCalled();
    expect(global.browser.downloads.removeFile).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.HISTORY_REROUTE,
      body: { rerouted: false, oldRemoved: false },
    });
  });

  test("HISTORY_REROUTE accepts a legacy source URL from state info", async () => {
    vi.mocked(SaveHistory.getHistoryEntries).mockResolvedValue([
      {
        id: "history-legacy",
        finalFullPath: "from/legacy.png",
        downloadId: 50,
        status: "complete",
        info: { context: "CLICK" },
        state: { info: { sourceUrl: "https://legacy.test/image.png" } },
      },
    ]);
    vi.mocked(global.browser.downloads.search).mockResolvedValue([
      { id: 50, url: "https://legacy.test/image.png", state: "complete" } as never,
    ]);
    vi.mocked(Download.launchDownload).mockResolvedValue({ status: "started", downloadId: 51 });
    const sendResponse = vi.fn();

    onMessage(
      {
        type: MESSAGE_TYPES.HISTORY_REROUTE,
        body: { historyId: "history-legacy", destination: "moved/here" },
      },
      {},
      sendResponse,
    );
    await waitForCall(sendResponse);

    expect(vi.mocked(Download.launchDownload).mock.calls[0]![0]!.info.url).toBe(
      "https://legacy.test/image.png",
    );
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.HISTORY_REROUTE,
      body: { rerouted: true, oldRemoved: true },
    });
  });

  test("HISTORY_REROUTE refuses an abbreviated data URL from an older profile", async () => {
    vi.mocked(SaveHistory.getHistoryEntries).mockResolvedValue([
      {
        id: "history-auto-data",
        url: "data:image/png;base64,AAAA…",
        downloadId: 52,
        status: "complete",
        info: { context: "CLICK" },
      },
    ]);
    vi.mocked(Download.launchDownload).mockClear();
    vi.mocked(global.browser.downloads.search).mockClear();
    const sendResponse = vi.fn();

    onMessage(
      {
        type: MESSAGE_TYPES.HISTORY_REROUTE,
        body: { historyId: "history-auto-data", destination: "moved/here" },
      },
      {},
      sendResponse,
    );
    await waitForCall(sendResponse);

    expect(global.browser.downloads.search).not.toHaveBeenCalled();
    expect(Download.launchDownload).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.HISTORY_REROUTE,
      body: { rerouted: false, oldRemoved: false },
    });
  });

  test("HISTORY_REROUTE refuses an unverifiable original before any download", async () => {
    vi.mocked(SaveHistory.getHistoryEntries).mockResolvedValue([
      {
        id: "history-21",
        url: "https://x.test/photo.png",
        downloadId: 43,
        status: "complete",
        downloadStartTime: "2026-07-17T01:02:03.000Z",
      },
    ]);
    // A reused session-scoped id points at a different download now.
    vi.mocked(global.browser.downloads.search).mockResolvedValue([
      { id: 43, url: "https://elsewhere/report.pdf", startTime: "2026-07-18T09:00:00.000Z" },
    ] as never);
    vi.mocked(Download.launchDownload).mockClear();
    vi.mocked(global.browser.downloads.removeFile).mockClear();
    const sendResponse = vi.fn();

    onMessage(
      {
        type: MESSAGE_TYPES.HISTORY_REROUTE,
        body: { historyId: "history-21", destination: "moved/here" },
      },
      {},
      sendResponse,
    );
    await waitForCall(sendResponse);

    expect(Download.launchDownload).not.toHaveBeenCalled();
    expect(global.browser.downloads.removeFile).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.HISTORY_REROUTE,
      body: { rerouted: false, oldRemoved: false },
    });
  });

  test("HISTORY_REROUTE leaves the original untouched when the replacement fails", async () => {
    vi.mocked(SaveHistory.getHistoryEntries).mockResolvedValue([
      {
        id: "history-22",
        url: "https://x.test/kept.png",
        downloadId: 44,
        status: "complete",
      },
    ]);
    vi.mocked(global.browser.downloads.search).mockResolvedValue([
      { id: 44, url: "https://x.test/kept.png" } as never,
    ]);
    vi.mocked(Download.launchDownload).mockResolvedValue({ status: "failed" });
    vi.mocked(global.browser.downloads.removeFile).mockClear();
    vi.mocked(SaveHistory.setHistoryStatus).mockClear();
    const sendResponse = vi.fn();

    onMessage(
      {
        type: MESSAGE_TYPES.HISTORY_REROUTE,
        body: { historyId: "history-22", destination: "moved/here" },
      },
      {},
      sendResponse,
    );
    await waitForCall(sendResponse);

    // A failed re-download must never have destroyed the only copy.
    expect(global.browser.downloads.removeFile).not.toHaveBeenCalled();
    expect(SaveHistory.setHistoryStatus).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.HISTORY_REROUTE,
      body: { rerouted: false, oldRemoved: false },
    });
  });

  test("HISTORY_REROUTE reports the kept original when removal is refused after launch", async () => {
    vi.mocked(SaveHistory.getHistoryEntries).mockResolvedValue([
      {
        id: "history-23",
        url: "https://x.test/dup.png",
        downloadId: 45,
        status: "complete",
      },
    ]);
    vi.mocked(global.browser.downloads.search).mockResolvedValue([
      { id: 45, url: "https://x.test/dup.png", state: "complete" } as never,
    ]);
    vi.mocked(Download.launchDownload).mockImplementation(async (state) => {
      state.scratch.historyEntryId = "history-new-2";
      return { status: "started", downloadId: 46 };
    });
    vi.mocked(SaveHistory.setHistoryStatus).mockClear();
    vi.mocked(HistoryMove.completePendingHistoryMove).mockResolvedValue({
      handled: true,
      oldRemoved: false,
      newHistoryId: "history-new-2",
    });
    const sendResponse = vi.fn();

    onMessage(
      {
        type: MESSAGE_TYPES.HISTORY_REROUTE,
        body: { historyId: "history-23", destination: "moved/here" },
      },
      {},
      sendResponse,
    );
    await waitForCall(sendResponse);

    expect(SaveHistory.setHistoryStatus).not.toHaveBeenCalledWith(
      "history-23",
      "moved",
      expect.anything(),
    );
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.HISTORY_REROUTE,
      body: { rerouted: true, oldRemoved: false, newHistoryId: "history-new-2" },
    });
  });

  test("HISTORY_REROUTE succeeds without links when the replacement has no history row", async () => {
    vi.mocked(SaveHistory.getHistoryEntries).mockResolvedValue([
      {
        id: "history-24",
        url: "https://x.test/unlinked.png",
        downloadId: 48,
        status: "complete",
      },
    ]);
    vi.mocked(global.browser.downloads.search).mockResolvedValue([
      { id: 48, url: "https://x.test/unlinked.png", state: "complete" } as never,
    ]);
    vi.mocked(Download.launchDownload).mockResolvedValue({ status: "started", downloadId: 49 });
    vi.mocked(SaveHistory.patchHistoryEntry).mockClear();
    const sendResponse = vi.fn();

    onMessage(
      {
        type: MESSAGE_TYPES.HISTORY_REROUTE,
        body: { historyId: "history-24", destination: "moved/here" },
      },
      {},
      sendResponse,
    );
    await waitForCall(sendResponse);

    expect(SaveHistory.patchHistoryEntry).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.HISTORY_REROUTE,
      body: { rerouted: true, oldRemoved: true },
    });
  });

  test("HISTORY_UNDO works for an automatic-save entry exactly like a manual one", async () => {
    vi.mocked(SaveHistory.getHistoryEntries).mockResolvedValue([
      {
        id: "history-auto",
        url: "https://x.test/auto.png",
        downloadId: 47,
        status: "complete",
        info: { context: "auto" },
      },
    ]);
    vi.mocked(global.browser.downloads.search).mockResolvedValue([
      { id: 47, url: "https://x.test/auto.png" } as never,
    ]);
    const sendResponse = vi.fn();

    onMessage(
      { type: MESSAGE_TYPES.HISTORY_UNDO, body: { historyId: "history-auto" } },
      {},
      sendResponse,
    );
    await waitForCall(sendResponse);

    expect(global.browser.downloads.removeFile).toHaveBeenCalledWith(47);
    expect(SaveHistory.setHistoryStatus).toHaveBeenCalledWith("history-auto", "undone", 47);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.HISTORY_UNDO,
      body: { undone: true, fileMissing: false },
    });
  });

  test("HISTORY_UNDO reports failure when the shelf entry cannot be erased", async () => {
    vi.mocked(SaveHistory.getHistoryEntries).mockResolvedValue([
      { id: "history-12", url: "https://x.test/stuck.png", downloadId: 33, status: "complete" },
    ]);
    vi.mocked(global.browser.downloads.search).mockResolvedValue([
      { id: 33, url: "https://x.test/stuck.png" } as never,
    ]);
    vi.mocked(global.browser.downloads.erase).mockRejectedValueOnce(new Error("shelf locked"));
    vi.mocked(SaveHistory.setHistoryStatus).mockClear();
    const sendResponse = vi.fn();

    onMessage(
      { type: MESSAGE_TYPES.HISTORY_UNDO, body: { historyId: "history-12" } },
      {},
      sendResponse,
    );
    await waitForCall(sendResponse);

    // A failed erase must not mark the entry undone — the shelf record still
    // points at the (removed) file and the user needs the true state.
    expect(SaveHistory.setHistoryStatus).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.HISTORY_UNDO,
      body: { undone: false, fileMissing: false },
    });
  });

  test("HISTORY_UNDO refuses an id the browser no longer tracks", async () => {
    vi.mocked(SaveHistory.getHistoryEntries).mockResolvedValue([
      { id: "history-13", url: "https://x.test/old.png", downloadId: 34, status: "complete" },
    ]);
    // Untracked id: extensions cannot stat the filesystem, so the file's fate
    // is unknowable and nothing may be destroyed or marked.
    vi.mocked(global.browser.downloads.search).mockResolvedValue([]);
    vi.mocked(global.browser.downloads.removeFile).mockClear();
    vi.mocked(global.browser.downloads.erase).mockClear();
    vi.mocked(SaveHistory.setHistoryStatus).mockClear();
    const sendResponse = vi.fn();

    onMessage(
      { type: MESSAGE_TYPES.HISTORY_UNDO, body: { historyId: "history-13" } },
      {},
      sendResponse,
    );
    await waitForCall(sendResponse);

    expect(global.browser.downloads.removeFile).not.toHaveBeenCalled();
    expect(global.browser.downloads.erase).not.toHaveBeenCalled();
    expect(SaveHistory.setHistoryStatus).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.HISTORY_UNDO,
      body: { undone: false, fileMissing: false },
    });
  });

  test("HISTORY_UNDO refuses a reused id whose download is not the entry's", async () => {
    vi.mocked(SaveHistory.getHistoryEntries).mockResolvedValue([
      {
        id: "history-14",
        url: "https://x.test/photo.jpg",
        finalFullPath: "gallery/photo.jpg",
        downloadId: 3,
        status: "complete",
      },
    ]);
    // Firefox reuses session-scoped ids after a restart: id 3 now names an
    // unrelated download that must not be deleted.
    vi.mocked(global.browser.downloads.search).mockResolvedValue([
      { id: 3, url: "https://elsewhere.test/report.pdf", filename: "/dl/report.pdf" } as never,
    ]);
    vi.mocked(global.browser.downloads.removeFile).mockClear();
    vi.mocked(global.browser.downloads.erase).mockClear();
    vi.mocked(SaveHistory.setHistoryStatus).mockClear();
    const sendResponse = vi.fn();

    onMessage(
      { type: MESSAGE_TYPES.HISTORY_UNDO, body: { historyId: "history-14" } },
      {},
      sendResponse,
    );
    await waitForCall(sendResponse);

    expect(global.browser.downloads.removeFile).not.toHaveBeenCalled();
    expect(global.browser.downloads.erase).not.toHaveBeenCalled();
    expect(SaveHistory.setHistoryStatus).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.HISTORY_UNDO,
      body: { undone: false, fileMissing: false },
    });
  });

  test("HISTORY_UNDO refuses when the stored start time contradicts the browser item", async () => {
    vi.mocked(SaveHistory.getHistoryEntries).mockResolvedValue([
      {
        id: "history-13",
        url: "https://x.test/file.png",
        downloadId: 34,
        status: "complete",
        downloadStartTime: "2026-07-17T01:02:03.000Z",
      },
    ]);
    // Same url, different start time: a reused session-scoped id pointing at a
    // re-download of the same address must still refuse.
    vi.mocked(global.browser.downloads.search).mockResolvedValue([
      { id: 34, url: "https://x.test/file.png", startTime: "2026-07-18T09:08:07.000Z" } as never,
    ]);
    vi.mocked(global.browser.downloads.removeFile).mockClear();
    vi.mocked(SaveHistory.setHistoryStatus).mockClear();
    const sendResponse = vi.fn();

    onMessage(
      { type: MESSAGE_TYPES.HISTORY_UNDO, body: { historyId: "history-13" } },
      {},
      sendResponse,
    );
    await waitForCall(sendResponse);

    expect(global.browser.downloads.removeFile).not.toHaveBeenCalled();
    expect(SaveHistory.setHistoryStatus).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.HISTORY_UNDO,
      body: { undone: false, fileMissing: false },
    });
  });

  test("HISTORY_UNDO matches a blob-acquired download through its start time", async () => {
    vi.mocked(SaveHistory.getHistoryEntries).mockResolvedValue([
      {
        id: "history-14",
        url: "https://x.test/file.png",
        finalFullPath: "gallery/file.png",
        downloadId: 35,
        status: "complete",
        downloadStartTime: "2026-07-17T01:02:03.000Z",
      },
    ]);
    // Chrome's Referer-protected acquisition downloads a blob: URL and the
    // browser may have uniquified the on-disk name; startTime still matches.
    vi.mocked(global.browser.downloads.search).mockResolvedValue([
      {
        id: 35,
        url: "blob:chrome-extension/9",
        filename: "/dl/file (1).png",
        startTime: "2026-07-17T01:02:03.000Z",
      } as never,
    ]);
    const sendResponse = vi.fn();

    onMessage(
      { type: MESSAGE_TYPES.HISTORY_UNDO, body: { historyId: "history-14" } },
      {},
      sendResponse,
    );
    await waitForCall(sendResponse);

    expect(SaveHistory.setHistoryStatus).toHaveBeenCalledWith("history-14", "undone", 35);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.HISTORY_UNDO,
      body: { undone: true, fileMissing: false },
    });
  });

  test("HISTORY_UNDO reports failure for an entry without a known download id", async () => {
    vi.mocked(SaveHistory.getHistoryEntries).mockResolvedValue([
      { id: "history-11", url: "https://x.test/old.png", status: "complete" },
    ]);
    // setupGlobals keeps host mocks across tests in this file; the negative
    // assertions below need a clean slate
    vi.mocked(global.browser.downloads.removeFile).mockClear();
    vi.mocked(SaveHistory.setHistoryStatus).mockClear();
    const sendResponse = vi.fn();

    onMessage(
      { type: MESSAGE_TYPES.HISTORY_UNDO, body: { historyId: "history-11" } },
      {},
      sendResponse,
    );
    await waitForCall(sendResponse);

    expect(global.browser.downloads.removeFile).not.toHaveBeenCalled();
    expect(SaveHistory.setHistoryStatus).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.HISTORY_UNDO,
      body: { undone: false, fileMissing: false },
    });
  });

  test("HISTORY_CANCEL uses a stored download id without overwriting completion", async () => {
    vi.mocked(SaveHistory.getHistoryEntries).mockResolvedValue([
      { id: "history-2", url: "https://x.test/file", downloadId: 23 },
    ]);
    // The item carries the entry's url so the stored id is verifiable: a real
    // DownloadItem always reports one, and an unverifiable id is refused.
    vi.mocked(global.browser.downloads.search).mockResolvedValue([
      { id: 23, state: "complete", url: "https://x.test/file" } as any,
    ]);
    const sendResponse = vi.fn();

    onMessage(
      { type: MESSAGE_TYPES.HISTORY_CANCEL, body: { historyId: "history-2" } },
      {},
      sendResponse,
    );
    await waitForCall(sendResponse);

    expect(global.browser.downloads.cancel).toHaveBeenCalledWith(23);
    expect(SaveHistory.setHistoryStatus).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.HISTORY_CANCEL,
      body: { canceled: true },
    });
  });

  test("HISTORY_CANCEL refuses a stored download id that no longer names its download", async () => {
    // Firefox reassigns download ids per session while history keeps them, so a
    // row left pending by a restart can name a download the user started later.
    vi.mocked(SaveHistory.getHistoryEntries).mockResolvedValue([
      {
        id: "history-stale",
        url: "https://x.test/file",
        downloadId: 7,
        downloadStartTime: "2026-01-01T00:00:00.000Z",
      },
    ]);
    vi.mocked(global.browser.downloads.search).mockResolvedValue([
      {
        id: 7,
        state: "in_progress",
        url: "https://other.test/unrelated.zip",
        startTime: "2026-07-17T00:00:00.000Z",
      } as any,
    ]);
    const sendResponse = vi.fn();

    onMessage(
      { type: MESSAGE_TYPES.HISTORY_CANCEL, body: { historyId: "history-stale" } },
      {},
      sendResponse,
    );
    await waitForCall(sendResponse);

    expect(global.browser.downloads.cancel).not.toHaveBeenCalledWith(7);
    expect(SaveHistory.setHistoryStatus).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.HISTORY_CANCEL,
      body: { canceled: false },
    });
  });

  test("HISTORY_CANCEL records an active transfer when no browser download exists", async () => {
    vi.mocked(ActiveTransfers.getActiveTransfer).mockReturnValue({ updatedAt: 1 });
    vi.mocked(ActiveTransfers.cancelActiveTransfer).mockReturnValue(true);
    const sendResponse = vi.fn();

    onMessage(
      { type: MESSAGE_TYPES.HISTORY_CANCEL, body: { historyId: "history-3" } },
      {},
      sendResponse,
    );
    await waitForCall(sendResponse);

    expect(SaveHistory.setHistoryStatus).toHaveBeenCalledWith(
      "history-3",
      "USER_CANCELED",
      undefined,
    );
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.HISTORY_CANCEL,
      body: { canceled: true },
    });
  });

  test("HISTORY_CANCEL tolerates a browser cancellation race and an empty id", async () => {
    vi.mocked(SaveHistory.getHistoryEntries).mockResolvedValue([
      { id: "history-4", url: "https://x.test/file", downloadId: 29 },
    ]);
    vi.mocked(global.browser.downloads.cancel).mockRejectedValue(new Error("already complete"));
    const racedResponse = vi.fn();
    onMessage(
      { type: MESSAGE_TYPES.HISTORY_CANCEL, body: { historyId: "history-4" } },
      {},
      racedResponse,
    );
    await waitForCall(racedResponse);
    expect(racedResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.HISTORY_CANCEL,
      body: { canceled: false },
    });

    vi.mocked(SaveHistory.getHistoryEntries).mockClear();
    const emptyResponse = vi.fn();
    onMessage({ type: MESSAGE_TYPES.HISTORY_CANCEL, body: { historyId: "" } }, {}, emptyResponse);
    await waitForCall(emptyResponse);
    expect(SaveHistory.getHistoryEntries).not.toHaveBeenCalled();
  });

  test("lists and clears rejected external download callers", async () => {
    vi.mocked(ExternalDownloadRejections.get).mockResolvedValue([
      {
        senderId: "blocked-extension",
        attempts: 2,
        lastRejectedAt: "2026-07-13T10:00:00.000Z",
        requestType: "activeTab",
      },
    ]);
    const listResponse = vi.fn();

    expect(
      onMessage({ type: MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTIONS_GET }, {}, listResponse),
    ).toBe(true);
    await waitForCall(listResponse);
    expect(listResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTIONS_GET,
      body: {
        rejections: [expect.objectContaining({ senderId: "blocked-extension", attempts: 2 })],
      },
    });

    const clearResponse = vi.fn();
    expect(
      onMessage(
        {
          type: MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTION_CLEAR,
          body: { senderId: "blocked-extension" },
        },
        {},
        clearResponse,
      ),
    ).toBe(true);
    await waitForCall(clearResponse);
    expect(ExternalDownloadRejections.clear).toHaveBeenCalledWith("blocked-extension");
    expect(clearResponse).toHaveBeenCalledWith({ type: MESSAGE_TYPES.OK });
  });

  test("SOURCE_PANEL_READY synchronizes state after the content listener exists", async () => {
    const sendResponse = vi.fn();
    expect(
      onMessage({ type: MESSAGE_TYPES.SOURCE_PANEL_READY }, { tab: { id: 12 } }, sendResponse),
    ).toBe(true);
    await waitForCall(sendResponse);
    expect(SourcePanelState.syncSourcePanelToTab).toHaveBeenCalledWith(12);
    expect(sendResponse).toHaveBeenCalledWith({ type: MESSAGE_TYPES.OK });
  });

  test("SOURCE_PANEL_READY tolerates a sender without a tab", async () => {
    const sendResponse = vi.fn();
    expect(onMessage({ type: MESSAGE_TYPES.SOURCE_PANEL_READY }, {}, sendResponse)).toBe(true);
    await waitForCall(sendResponse);
    expect(SourcePanelState.syncSourcePanelToTab).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ type: MESSAGE_TYPES.OK });
  });

  test("SOURCE_PANEL_COPY localizes once per selected locale", () => {
    options.uiLocale = undefined as any;
    const defaultResponse = vi.fn();
    onMessage({ type: MESSAGE_TYPES.SOURCE_PANEL_COPY }, {}, defaultResponse);
    expect(defaultResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.SOURCE_PANEL_COPY,
      body: expect.objectContaining({ title: expect.any(String), save: expect.any(String) }),
    });

    options.uiLocale = "de";
    const firstResponse = vi.fn();
    onMessage({ type: MESSAGE_TYPES.SOURCE_PANEL_COPY }, {}, firstResponse);
    const localizationCalls = vi.mocked(global.browser.i18n.getMessage).mock.calls.length;

    const cachedResponse = vi.fn();
    onMessage({ type: MESSAGE_TYPES.SOURCE_PANEL_COPY }, {}, cachedResponse);
    expect(global.browser.i18n.getMessage).toHaveBeenCalledTimes(localizationCalls);
    expect(cachedResponse).toHaveBeenCalledWith(firstResponse.mock.calls[0]![0]);
  });

  test("SOURCE_PANEL_STATE persists content-script close state", async () => {
    const sendResponse = vi.fn();
    expect(
      onMessage(
        { type: MESSAGE_TYPES.SOURCE_PANEL_STATE, body: { open: false } },
        {},
        sendResponse,
      ),
    ).toBe(true);
    await waitForCall(sendResponse);
    expect(SourcePanelState.setSourcePanelOpenState).toHaveBeenCalledWith(false);
    expect(sendResponse).toHaveBeenCalledWith({ type: MESSAGE_TYPES.OK });
  });

  test("CREATE_SOURCE_RULE stores a disabled domain-scoped draft and opens Options", async () => {
    const sendResponse = vi.fn();
    expect(
      onMessage(
        {
          type: MESSAGE_TYPES.CREATE_SOURCE_RULE,
          body: { sourceUrl: "https://cdn.example.net/cat.jpg", sourceKind: "image" },
        },
        { tab: { id: 12, url: "https://gallery.example.com/post/1" } },
        sendResponse,
      ),
    ).toBe(true);
    await waitForCall(sendResponse);

    expect(global.browser.storage.local.set).toHaveBeenCalledWith({
      sourceRuleDraft: {
        rule: expect.stringMatching(
          /context: \^auto\$[\s\S]*pagerootdomain:[\s\S]*sourcerootdomain:[\s\S]*disabled: true/,
        ),
      },
    });
    expect(global.browser.runtime.openOptionsPage).toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ type: MESSAGE_TYPES.OK });
  });

  test.each([
    ["a sender without a page URL", {}],
    [
      "an incognito sender",
      { tab: { id: 12, url: "https://gallery.example.com/post/1", incognito: true } },
    ],
  ])("CREATE_SOURCE_RULE rejects %s", async (_label, sender) => {
    vi.mocked(global.browser.runtime.openOptionsPage).mockClear();
    const sendResponse = vi.fn();
    expect(
      onMessage(
        {
          type: MESSAGE_TYPES.CREATE_SOURCE_RULE,
          body: { sourceUrl: "https://cdn.example.net/cat.jpg", sourceKind: "image" },
        },
        sender,
        sendResponse,
      ),
    ).toBe(true);
    await waitForCall(sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.CREATE_SOURCE_RULE,
      body: expect.objectContaining({ status: MESSAGE_TYPES.ERROR }),
    });
    expect(global.browser.runtime.openOptionsPage).not.toHaveBeenCalled();
  });

  test("DIAGNOSTICS_GET returns a snapshot and DIAGNOSTICS_CLEAR_FAILURES clears the log", async () => {
    const getResponse = vi.fn();
    expect(onMessage({ type: MESSAGE_TYPES.DIAGNOSTICS_GET }, {}, getResponse)).toBe(true);
    await waitForCall(getResponse);
    expect(getResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DIAGNOSTICS_GET,
      body: expect.objectContaining({ extensionVersion: "4.0.0" }),
    });

    const clearResponse = vi.fn();
    expect(onMessage({ type: MESSAGE_TYPES.DIAGNOSTICS_CLEAR_FAILURES }, {}, clearResponse)).toBe(
      true,
    );
    await waitForCall(clearResponse);
    expect(Log.clearLog).toHaveBeenCalledOnce();
    expect(clearResponse).toHaveBeenCalledWith({ type: MESSAGE_TYPES.OK });
  });

  test("OPTIONS_LOADED responds only after the background reset completes", async () => {
    let finishReset!: () => void;
    backgroundRuntime.reset = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          finishReset = () => resolve(12);
        }),
    );
    const sendResponse = vi.fn();
    expect(onMessage({ type: MESSAGE_TYPES.OPTIONS_LOADED }, {}, sendResponse)).toBe(true);
    expect(backgroundRuntime.reset).toHaveBeenCalledTimes(1);
    expect(sendResponse).not.toHaveBeenCalled();

    finishReset();
    await waitForCall(sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.OK,
      body: { instanceId: backgroundRuntime.instanceId, generation: 12 },
    });
  });

  test("OPTIONS responds with the current options", () => {
    const sendResponse = vi.fn();
    onMessage({ type: MESSAGE_TYPES.OPTIONS }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.OPTIONS,
      body: options,
    });
  });

  test("OPTIONS waits for cold-start initialization before exposing settings", async () => {
    let finish!: () => void;
    backgroundRuntime.ready = new Promise<void>((resolve) => {
      finish = () => {
        options.prompt = true;
        resolve();
      };
    });
    const sendResponse = vi.fn();

    expect(onMessage({ type: MESSAGE_TYPES.OPTIONS }, {}, sendResponse)).toBe(true);
    expect(sendResponse).not.toHaveBeenCalled();

    finish();
    await backgroundRuntime.ready;
    await Promise.resolve();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.OPTIONS,
      body: expect.objectContaining({ prompt: true }),
    });
  });

  test("OPTIONS_SCHEMA responds with option keys and types", () => {
    const sendResponse = vi.fn();
    onMessage({ type: MESSAGE_TYPES.OPTIONS_SCHEMA }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.OPTIONS_SCHEMA,
      body: {
        keys: OptionsManagement.OPTION_KEYS.map(({ name, type, default: defaultValue }) => ({
          name,
          type,
          default: defaultValue,
        })),
        types: OptionsManagement.OPTION_TYPES,
      },
    });
  });

  test("GET_KEYWORDS responds with matcher and variable names", () => {
    const sendResponse = vi.fn();
    onMessage({ type: MESSAGE_TYPES.GET_KEYWORDS }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.KEYWORD_LIST,
      body: {
        matchers: [...Object.keys(router.matcherFunctions), "css"],
        variables: [":date:", ":year:"],
        automaticMatchers: [
          "pageurl",
          "pagedomain",
          "pagerootdomain",
          "css",
          "sourceurl",
          "sourcedomain",
          "sourcerootdomain",
          "sourcekind",
          "mediatype",
          "fileext",
          "urlfileext",
        ],
        automaticContext: "auto",
        sourceKinds: ["image", "video", "audio", "stream", "document", "link"],
      },
    });
  });

  test("PREVIEW_MENUS builds a tree from the supplied (unsaved) paths text", () => {
    const sendResponse = vi.fn();
    onMessage(
      { type: MESSAGE_TYPES.PREVIEW_MENUS, body: { paths: " dogs \n\n>cats\n" } },
      {},
      sendResponse,
    );

    // Lines are trimmed and blanks dropped, mirroring window.init
    expect(Menus.buildTree).toHaveBeenCalledWith(["dogs", ">cats"]);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.MENU_PREVIEW,
      body: {
        items: [
          expect.objectContaining({ kind: "path", id: "save-in-0", title: "dogs" }),
          expect.objectContaining({ kind: "path", id: "save-in-1", title: ">cats" }),
        ],
        errors: [],
      },
    });
  });

  test("PREVIEW_MENUS tolerates a missing body", () => {
    const sendResponse = vi.fn();
    onMessage({ type: MESSAGE_TYPES.PREVIEW_MENUS }, {}, sendResponse);
    expect(Menus.buildTree).toHaveBeenCalledWith([]);
    expect(sendResponse).toHaveBeenCalled();
  });

  test("an unknown internal message type is a no-op", () => {
    // (the external API instead replies UNKNOWN_TYPE — see the API v1 suite)
    const sendResponse = vi.fn();
    onMessage({ type: "SOMETHING_ELSE" }, {}, sendResponse);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  test("a ready-handler string rejection returns a protocol error", async () => {
    backgroundRuntime.ready = Promise.reject("startup failed");
    const sendResponse = vi.fn();

    expect(onMessage({ type: MESSAGE_TYPES.OPTIONS }, {}, sendResponse)).toBe(true);
    await waitForCall(sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.OPTIONS,
      body: {
        status: MESSAGE_TYPES.ERROR,
        error: "INTERNAL_ERROR",
        message: "Save In could not complete the request",
      },
    });
  });
});

describe("onMessage CHECK_ROUTES", () => {
  test("waits for cold-start initialization before previewing routes", async () => {
    let finish!: () => void;
    backgroundRuntime.ready = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const sendResponse = vi.fn();

    expect(onMessage({ type: MESSAGE_TYPES.CHECK_ROUTES }, {}, sendResponse)).toBe(true);
    expect(RoutePreview.previewRoutes).not.toHaveBeenCalled();

    finish();
    await backgroundRuntime.ready;
    await waitForCall(sendResponse);
    expect(RoutePreview.previewRoutes).toHaveBeenCalledTimes(1);
  });

  test("uses the state supplied in the request body", async () => {
    const state = { info: { filename: "f.png" } };
    const sendResponse = vi.fn();

    const keepChannelOpen = onMessage(
      { type: MESSAGE_TYPES.CHECK_ROUTES, body: { state } },
      {},
      sendResponse,
    );
    expect(keepChannelOpen).toBe(true);
    await waitForCall(sendResponse);

    expect(RoutePreview.previewRoutes).toHaveBeenCalledWith(state);
    // interpolation runs in preview mode (a copy of info with preview:true)
    expect(Variable.applyVariables).toHaveBeenCalledWith(
      expect.any(Path),
      expect.objectContaining({ filename: "f.png", now: expect.any(Date), preview: true }),
    );
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.CHECK_ROUTES_RESPONSE,
      body: {
        optionErrors: backgroundRuntime.optionErrors,
        routeInfo: { path: "routed/dir", captures: null },
        lastDownload: undefined,
        interpolatedVariables: { ":date:": "interp::date:", ":year:": "interp::year:" },
        persistenceErrors: [],
      },
    });
  });

  test("turns an async handler rejection into a protocol error", async () => {
    vi.mocked(RoutePreview.previewRoutes).mockRejectedValue(new Error("preview failed"));
    const sendResponse = vi.fn();

    const keepChannelOpen = onMessage({ type: MESSAGE_TYPES.CHECK_ROUTES }, {}, sendResponse);
    expect(keepChannelOpen).toBe(true);
    await waitForCall(sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.CHECK_ROUTES,
      body: {
        status: MESSAGE_TYPES.ERROR,
        error: "INTERNAL_ERROR",
        message: "Save In could not complete the request",
      },
    });
  });

  test("falls back to window.lastDownloadState without a state in the body", async () => {
    const now = new Date("2026-07-14T00:00:00.000Z");
    const lastState = { info: { filename: "last.png", now } };
    backgroundRuntime.lastDownloadState = lastState as any;
    const sendResponse = vi.fn();

    onMessage({ type: MESSAGE_TYPES.CHECK_ROUTES, body: {} }, {}, sendResponse);
    await waitForCall(sendResponse);

    expect(RoutePreview.previewRoutes).toHaveBeenCalledWith(lastState);
    expect(Variable.applyVariables).toHaveBeenCalledWith(
      expect.any(Path),
      expect.objectContaining({ now }),
    );
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          lastDownload: { info: { filename: "last.png", now: now.toISOString() } },
          interpolatedVariables: { ":date:": "interp::date:", ":year:": "interp::year:" },
        }),
      }),
    );
  });

  test("responds with null interpolations when there is no state at all", async () => {
    backgroundRuntime.lastDownloadState = null;
    const sendResponse = vi.fn();

    onMessage({ type: MESSAGE_TYPES.CHECK_ROUTES }, {}, sendResponse);
    await waitForCall(sendResponse);

    expect(RoutePreview.previewRoutes).toHaveBeenCalledWith(null);
    expect(Variable.applyVariables).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          lastDownload: null,
          interpolatedVariables: null,
        }),
      }),
    );
  });
});

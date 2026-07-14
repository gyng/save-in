import {
  downloadState,
  browserState,
  retryHolder,
  Notifier,
  options,
  Log,
  SaveHistory,
  Runtime,
  loadNotification,
  adoptedIds,
  setupGlobals,
} from "./session.fixture.ts";

describe("download lifecycle notifications", () => {
  let sessionStore: Record<string, any>;
  let onCreated: any;
  let onChanged: any;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    sessionStore = {};
    setupGlobals(sessionStore, () => [{ id: 7, fileSize: 2048, mime: "image/png" }]);

    // loadNotification() registers the download listeners via registerNotifier
    await loadNotification();
    Object.assign(options, {
      notifyOnSuccess: true,
      notifyOnFailure: true,
      notifyDuration: 1000,
      promptOnFailure: false,
      browserDownloadFiltersEnabled: true,
      browserDownloadFilter: "",
      browserDownloadExcludeFilter: "",
    });

    const [createdHandler] = vi.mocked(global.browser.downloads.onCreated.addListener).mock
      .calls[0]!;
    const [changedHandler] = vi.mocked(global.browser.downloads.onChanged.addListener).mock
      .calls[0]!;
    onCreated = createdHandler;
    onChanged = changedHandler;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("tracks a download recorded via the persisted pending flag", async () => {
    // The in-memory expectDownload counter was lost with the old worker;
    // the session flag written before downloads.download() takes over
    sessionStore.siPendingDownloads = 1;

    await onCreated({
      id: 7,
      byExtensionId: "save-in",
      filename: "C:\\dl\\pic.png",
      url: "https://x/p.png",
    });

    expect(sessionStore.siPendingDownloads).toBe(0);
    expect(adoptedIds(sessionStore)).toEqual([7]);
  });

  test("tracks Save In private downloads without a session record", async () => {
    Notifier.expectDownload("https://private.example/p.png", { privateContext: true });

    await onCreated({
      id: 8,
      incognito: true,
      filename: "C:\\Downloads\\private.png",
      url: "https://private.example/p.png",
    });

    expect(sessionStore.siDownloads?.[8]).toBeUndefined();
  });

  test("records an ordinary browser download without adopting or retrying it", async () => {
    options.trackBrowserDownloads = true;
    const { SaveHistory: history } = await import("../../../src/background/history.ts");
    vi.spyOn(history, "add").mockReturnValue("h-browser");
    vi.spyOn(history, "setDownloadId").mockResolvedValue(undefined);
    vi.spyOn(history, "setStatus").mockResolvedValue(undefined);

    await onCreated({
      id: 44,
      filename: "C:\\Downloads\\browser.zip",
      url: "https://example.com/browser.zip",
    });

    expect(sessionStore.siDownloads[44]!).toMatchObject({
      observedBrowserDownload: true,
      adopted: false,
      historyEntryId: "h-browser",
      allowOriginalUrlFallback: false,
    });
    expect(SaveHistory.add).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.com/browser.zip",
        finalFullPath: "C:\\Downloads\\browser.zip",
        info: { context: "browser" },
      }),
      { privateContext: false },
    );

    await onChanged({ id: 44, state: { current: "complete", previous: "in_progress" } });

    expect(SaveHistory.setStatus).toHaveBeenCalledWith("h-browser", "complete", 44, 2048);
    expect(sessionStore.siDownloads[44]!.observedBrowserDownload).toBe(false);
    expect(retryHolder.retry).not.toHaveBeenCalled();
    expect(global.browser.notifications.create).not.toHaveBeenCalled();
  });

  test("does not retain ordinary downloads from private browsing", async () => {
    options.trackBrowserDownloads = true;
    const { SaveHistory: history } = await import("../../../src/background/history.ts");
    vi.spyOn(history, "add");

    await onCreated({
      id: 48,
      incognito: true,
      filename: "C:\\Downloads\\private.zip",
      url: "https://private.example/private.zip",
    });

    expect(history.add).not.toHaveBeenCalled();
    expect(sessionStore.siDownloads?.[48]).toBeUndefined();
  });

  test("does not reroute Firefox downloads from private browsing", async () => {
    browserState.current = "FIREFOX";
    options.routeBrowserDownloadsFirefox = true;
    options.browserDownloadFilter = "*://private.example/*";
    const { BrowserDownloadRouting } = await import("../../../src/downloads/browser-downloads.ts");
    vi.spyOn(BrowserDownloadRouting, "route");

    await onCreated({
      id: 49,
      incognito: true,
      filename: "C:\\Downloads\\private.bin",
      url: "https://private.example/private.bin",
    });

    expect(BrowserDownloadRouting.route).not.toHaveBeenCalled();
    expect(global.browser.downloads.cancel).not.toHaveBeenCalled();
    expect(global.browser.downloads.download).not.toHaveBeenCalled();
  });

  test("does not track downloads initiated by another extension", async () => {
    options.trackBrowserDownloads = true;
    const { SaveHistory: history } = await import("../../../src/background/history.ts");
    vi.spyOn(history, "add");

    await onCreated({
      id: 45,
      byExtensionId: "another-extension",
      filename: "C:\\Downloads\\other.zip",
      url: "https://example.com/other.zip",
    });

    expect(history.add).not.toHaveBeenCalled();
    expect(sessionStore.siDownloads?.[45]).toBeUndefined();
  });

  test("Firefox experimentally cancels and replaces a matching ordinary download", async () => {
    browserState.current = "FIREFOX";
    options.routeBrowserDownloadsFirefox = true;
    options.browserDownloadFilter = "*://example.com/*";
    const { BrowserDownloadRouting } = await import("../../../src/downloads/browser-downloads.ts");
    vi.spyOn(BrowserDownloadRouting, "route").mockResolvedValue("sorted/native.bin");
    const { SaveHistory: history } = await import("../../../src/background/history.ts");
    vi.spyOn(history, "add").mockReturnValue("h-reroute");
    vi.spyOn(history, "setDownloadId").mockResolvedValue(undefined);
    vi.mocked(global.browser.downloads.download).mockImplementationOnce(async (downloadOptions) => {
      await onCreated({
        id: 99,
        byExtensionId: "save-in",
        filename: "C:\\Downloads\\sorted\\native.bin",
        url: downloadOptions.url,
      });
      return 99;
    });

    await onCreated({
      id: 46,
      filename: "C:\\Downloads\\native.bin",
      url: "https://example.com/native.bin",
    });

    expect(global.browser.downloads.cancel).toHaveBeenCalledWith(46);
    expect(global.browser.downloads.erase).toHaveBeenCalledWith({ id: 46 });
    expect(global.browser.downloads.download).toHaveBeenCalledWith({
      url: "https://example.com/native.bin",
      filename: "sorted/native.bin",
      conflictAction: options.conflictAction,
    });
    expect(sessionStore.siDownloads[99]!).toMatchObject({
      observedBrowserDownload: true,
      adopted: false,
      historyEntryId: "h-reroute",
      allowOriginalUrlFallback: false,
    });
    expect(BrowserDownloadRouting.route).toHaveBeenCalledTimes(1);
  });

  test("Firefox leaves nonmatching ordinary downloads untouched", async () => {
    browserState.current = "FIREFOX";
    options.routeBrowserDownloadsFirefox = true;
    options.browserDownloadFilter = "*://allowed.example/*";
    const { BrowserDownloadRouting } = await import("../../../src/downloads/browser-downloads.ts");
    vi.spyOn(BrowserDownloadRouting, "route");

    await onCreated({
      id: 47,
      filename: "C:\\Downloads\\native.bin",
      url: "https://example.com/native.bin",
    });

    expect(BrowserDownloadRouting.route).not.toHaveBeenCalled();
    expect(global.browser.downloads.cancel).not.toHaveBeenCalled();
    expect(global.browser.downloads.download).not.toHaveBeenCalled();
  });

  test("recovers every download created after one restart (counter, not boolean)", async () => {
    // Two downloads were in flight when the worker died; the old boolean flag
    // tracked only the first, silently dropping the second's notifications
    sessionStore.siPendingDownloads = 2;

    await onCreated({
      id: 7,
      byExtensionId: "save-in",
      filename: "C:\\dl\\a.png",
      url: "https://x/a.png",
    });
    await onCreated({
      id: 8,
      byExtensionId: "save-in",
      filename: "C:\\dl\\b.png",
      url: "https://x/b.png",
    });

    expect(sessionStore.siPendingDownloads).toBe(0);
    expect(adoptedIds(sessionStore)).toEqual([7, 8]);
  });

  test("does not adopt a foreign download even with a leaked pending count", async () => {
    // A stale siPendingDownloads (a requested download that never actually
    // created) must not cause an unrelated download — a manual save or another
    // extension's — to be tracked as ours and fire a spurious notification
    sessionStore.siPendingDownloads = 1;

    await onCreated({
      id: 500,
      filename: "C:\\dl\\theirs.png",
      byExtensionId: "some-other-extension",
    });

    expect(adoptedIds(sessionStore)).toEqual([]);
    // the leaked count is left untouched (only our downloads consume it)
    expect(sessionStore.siPendingDownloads).toBe(1);
  });

  test("notifies on completion and untracks", async () => {
    sessionStore.siPendingDownloads = 1;
    await onCreated({
      id: 7,
      byExtensionId: "save-in",
      filename: "C:\\dl\\pic.png",
      url: "https://x/p.png",
    });

    await onChanged({
      id: 7,
      state: { current: "complete", previous: "in_progress" },
    });

    expect(global.browser.notifications.create).toHaveBeenCalledWith(
      "7",
      expect.objectContaining({ type: "basic" }),
    );
    expect(adoptedIds(sessionStore)).toEqual([]);
  });

  test("membership survives a worker restart via the persisted record", async () => {
    // Adoption is a field on the DownloadState record, persisted to siDownloads,
    // so a completion that arrives after the worker restarted (the in-memory
    // mirror wiped) still recognises the download as ours and notifies
    sessionStore.siPendingDownloads = 1;
    await onCreated({
      id: 7,
      byExtensionId: "save-in",
      filename: "/dl/pic.png",
      url: "https://x/p.png",
    });

    // the record — and its adoption — was persisted
    expect(sessionStore.siDownloads[7]!).toMatchObject({ adopted: true });

    // a restart wipes the in-memory mirror; the persisted record survives
    downloadState.records.clear();

    await onChanged({ id: 7, state: { current: "complete", previous: "in_progress" } });

    expect(global.browser.notifications.create).toHaveBeenCalledWith(
      "7",
      expect.objectContaining({ type: "basic" }),
    );
    // adoption is cleared at the terminal delta, but the record is retained
    expect(sessionStore.siDownloads[7]!).toMatchObject({ adopted: false });
  });

  test("ignores downloads it did not initiate", async () => {
    await onCreated({ id: 99, filename: "C:\\dl\\other.png" });

    await onChanged({
      id: 99,
      state: { current: "complete", previous: "in_progress" },
    });

    expect(global.browser.notifications.create).not.toHaveBeenCalled();
    expect(adoptedIds(sessionStore)).toEqual([]);
  });

  test("does not crash on failure deltas for entries missing a filename", async () => {
    sessionStore.siPendingDownloads = 1;
    await onCreated({ id: 7, byExtensionId: "save-in", url: "https://x/p.png" }); // no filename yet

    await expect(
      onChanged({ id: 7, error: { current: "NETWORK_FAILED" } }),
    ).resolves.toBeUndefined();

    expect(global.browser.notifications.create).toHaveBeenCalled();
    expect(adoptedIds(sessionStore)).toEqual([]);
  });

  test("clicking a download notification opens its file", () => {
    const [onClicked] = vi.mocked(global.browser.notifications.onClicked.addListener).mock
      .calls[0]!;

    onClicked("save-in-not-123"); // extension notifications are not downloads
    expect(global.browser.downloads.show).not.toHaveBeenCalled();

    onClicked("42");
    expect(global.browser.downloads.show).toHaveBeenCalledWith(42);
  });

  test("picks the filename up from Chrome's delta", async () => {
    sessionStore.siPendingDownloads = 1;
    await onCreated({ id: 7, byExtensionId: "save-in", url: "https://x/p.png" }); // Chrome: no filename yet

    await onChanged({ id: 7, filename: {} }); // delta without a current filename
    await onChanged({ id: 7, filename: { current: "/dl/renamed.png" } });
    await onChanged({ id: 7, state: { current: "complete", previous: "in_progress" } });

    expect(global.browser.notifications.create).toHaveBeenCalledWith(
      "7",
      expect.objectContaining({ message: "renamed.png" }),
    );
  });

  test("clears the success notification after notifyDuration", async () => {
    sessionStore.siPendingDownloads = 1;
    await onCreated({
      id: 7,
      byExtensionId: "save-in",
      filename: "/dl/pic.png",
      url: "https://x/p.png",
    });

    await onChanged({ id: 7, state: { current: "complete", previous: "in_progress" } });

    expect(global.browser.notifications.clear).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(global.browser.notifications.clear).toHaveBeenCalledWith("7");
  });

  test("contains Firefox replacement cleanup and terminal failures", async () => {
    browserState.current = "FIREFOX";
    options.routeBrowserDownloadsFirefox = true;
    options.browserDownloadFilter = "*://example.com/*";
    const { BrowserDownloadRouting } = await import("../../../src/downloads/browser-downloads.ts");
    vi.spyOn(BrowserDownloadRouting, "route").mockResolvedValue("sorted/native.bin");
    const { SaveHistory: history } = await import("../../../src/background/history.ts");
    vi.spyOn(history, "add").mockReturnValue("h-reroute");
    vi.spyOn(history, "setStatus").mockResolvedValue(undefined);
    vi.mocked(global.browser.downloads.erase).mockRejectedValueOnce(new Error("erase failed"));
    vi.mocked(global.browser.downloads.download).mockResolvedValueOnce(99);

    await onCreated({
      id: 46,
      filename: "C:\\Downloads\\native.bin",
      url: "https://example.com/native.bin",
    });
    expect(global.browser.downloads.download).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(10000);

    vi.mocked(global.browser.downloads.cancel).mockRejectedValueOnce(new Error("cancel failed"));
    await onCreated({
      id: 47,
      filename: "C:\\Downloads\\other.bin",
      url: "https://example.com/other.bin",
    });
    expect(history.setStatus).toHaveBeenCalledWith("h-reroute", "FIREFOX_REROUTE_FAILED");
    expect(Log.add).toHaveBeenCalledWith(
      "Firefox browser download reroute failed",
      expect.stringContaining("cancel failed"),
    );
  });

  test("tracks an ordinary browser download without a history id", async () => {
    options.trackBrowserDownloads = true;
    const { SaveHistory: history } = await import("../../../src/background/history.ts");
    vi.spyOn(history, "add").mockReturnValue(null);

    await onCreated({
      id: 43,
      filename: "C:\\Downloads\\browser.zip",
      url: "https://example.com/browser.zip",
    });

    expect(sessionStore.siDownloads[43]).not.toHaveProperty("historyEntryId");
  });

  test("records tracked completion size and tolerates a failed size lookup", async () => {
    const { SaveHistory: history } = await import("../../../src/background/history.ts");
    vi.spyOn(history, "setStatus").mockResolvedValue(undefined);
    Notifier.expectDownload("https://x/sized.png", { historyEntryId: "h-sized" });
    await onCreated({
      id: 70,
      byExtensionId: "save-in",
      filename: "/dl/sized.png",
      url: "https://x/sized.png",
    });
    await onChanged({ id: 70, state: { current: "complete", previous: "in_progress" } });
    expect(history.setStatus).toHaveBeenCalledWith("h-sized", "complete", 70, 2048);

    Notifier.expectDownload("https://x/unknown.png", { historyEntryId: "h-unknown" });
    await onCreated({
      id: 71,
      byExtensionId: "save-in",
      filename: "/dl/unknown.png",
      url: "https://x/unknown.png",
    });
    vi.mocked(global.browser.downloads.search).mockRejectedValueOnce(new Error("search failed"));
    await onChanged({ id: 71, state: { current: "complete", previous: "in_progress" } });
    expect(history.setStatus).toHaveBeenCalledWith("h-unknown", "complete", 71);

    Notifier.expectDownload("https://x/fallback.png", { historyEntryId: "h-fallback" });
    await onCreated({
      id: 73,
      byExtensionId: "save-in",
      filename: "/dl/fallback.png",
      url: "https://x/fallback.png",
    });
    vi.mocked(global.browser.downloads.search).mockResolvedValueOnce([
      { id: 73, fileSize: 0, totalBytes: 512 } as any,
    ]);
    await onChanged({ id: 73, state: { current: "complete", previous: "in_progress" } });
    expect(history.setStatus).toHaveBeenCalledWith("h-fallback", "complete", 73, 512);

    Notifier.expectDownload("https://x/empty.png", { historyEntryId: "h-empty" });
    await onCreated({
      id: 74,
      byExtensionId: "save-in",
      filename: "/dl/empty.png",
      url: "https://x/empty.png",
    });
    vi.mocked(global.browser.downloads.search).mockResolvedValueOnce([]);
    await onChanged({ id: 74, state: { current: "complete", previous: "in_progress" } });
    expect(history.setStatus).toHaveBeenCalledWith("h-empty", "complete", 74, undefined);
  });

  test("updates and fails an observed browser-download history row", async () => {
    options.trackBrowserDownloads = true;
    const { SaveHistory: history } = await import("../../../src/background/history.ts");
    vi.spyOn(history, "add").mockReturnValue("h-observed");
    vi.spyOn(history, "patch").mockResolvedValue(undefined);
    vi.spyOn(history, "setStatus").mockResolvedValue(undefined);
    await onCreated({
      id: 72,
      filename: "/dl/original.zip",
      url: "https://x/observed.zip",
    });

    await onChanged({ id: 72, filename: { current: "/dl/renamed.zip" } });
    expect(history.patch).toHaveBeenCalledWith("h-observed", {
      finalFullPath: "/dl/renamed.zip",
    });
    await onChanged({ id: 72, error: { current: "NETWORK_FAILED" } });
    expect(history.setStatus).toHaveBeenCalledWith("h-observed", "NETWORK_FAILED", 72, undefined);
    await onChanged({ id: 72, filename: { current: "/dl/ignored.zip" } });
    expect(history.patch).not.toHaveBeenCalledWith("h-observed", {
      finalFullPath: "/dl/ignored.zip",
    });
  });

  test("waits through rejected startup readiness for both download events", async () => {
    Runtime.ready = Promise.reject(new Error("startup failed"));
    await onCreated({ id: 80, byExtensionId: "other", filename: "other" });
    Runtime.ready = Promise.reject(new Error("startup failed again"));
    await onChanged({ id: 80, state: { current: "complete" } });
    Runtime.ready = undefined;
  });

  test("contains rejected registered event tasks", async () => {
    vi.spyOn(Notifier, "onDownloadCreated").mockRejectedValueOnce(new Error("created failed"));
    vi.spyOn(Notifier, "onDownloadChanged").mockRejectedValueOnce(new Error("changed failed"));
    vi.spyOn(Notifier, "onNotificationClicked").mockImplementationOnce(() =>
      Promise.reject(new Error("click failed")),
    );
    const [created] = vi.mocked(global.browser.downloads.onCreated.addListener).mock.calls[0]!;
    const [changed] = vi.mocked(global.browser.downloads.onChanged.addListener).mock.calls[0]!;
    const [clicked] = vi.mocked(global.browser.notifications.onClicked.addListener).mock.calls[0]!;

    created({ id: 90 } as any);
    changed({ id: 90 });
    clicked("90");
    await vi.waitFor(() => expect(Log.add).toHaveBeenCalledTimes(3));
  });

  test("Firefox skips a replacement when routing returns no filename", async () => {
    browserState.current = "FIREFOX";
    options.routeBrowserDownloadsFirefox = true;
    options.browserDownloadFilter = "*://example.com/*";
    const { BrowserDownloadRouting } = await import("../../../src/downloads/browser-downloads.ts");
    vi.spyOn(BrowserDownloadRouting, "route").mockResolvedValue(null);

    await onCreated({
      id: 91,
      filename: "/dl/native.bin",
      url: "https://example.com/native.bin",
    });

    expect(global.browser.downloads.cancel).not.toHaveBeenCalled();
  });

  test("Firefox replacement tolerates history being disabled", async () => {
    browserState.current = "FIREFOX";
    options.routeBrowserDownloadsFirefox = true;
    options.browserDownloadFilter = "*://example.com/*";
    const { BrowserDownloadRouting } = await import("../../../src/downloads/browser-downloads.ts");
    vi.spyOn(BrowserDownloadRouting, "route").mockResolvedValue("sorted/native.bin");
    const { SaveHistory: history } = await import("../../../src/background/history.ts");
    vi.spyOn(history, "add").mockReturnValue(null);
    vi.mocked(global.browser.downloads.download).mockResolvedValueOnce(99);

    await onCreated({
      id: 92,
      filename: "/dl/native.bin",
      url: "https://example.com/native.bin",
    });

    expect(global.browser.downloads.download).toHaveBeenCalledOnce();
  });

  test("records observed downloads with missing and fallback byte sizes", async () => {
    options.trackBrowserDownloads = true;
    const { SaveHistory: history } = await import("../../../src/background/history.ts");
    vi.spyOn(history, "add").mockReturnValue("h-bytes");
    vi.spyOn(history, "setStatus").mockResolvedValue(undefined);

    await onCreated({ id: 93, filename: "/dl/a", url: "https://x/a" });
    vi.mocked(global.browser.downloads.search).mockResolvedValueOnce([
      { id: 93, fileSize: 0, totalBytes: 512 } as any,
    ]);
    await onChanged({ id: 93, state: { current: "complete" } });
    expect(history.setStatus).toHaveBeenCalledWith("h-bytes", "complete", 93, 512);

    await onCreated({ id: 94, filename: "/dl/b", url: "https://x/b" });
    vi.mocked(global.browser.downloads.search).mockResolvedValueOnce([]);
    await onChanged({ id: 94, state: { current: "complete" } });
    expect(history.setStatus).toHaveBeenCalledWith("h-bytes", "complete", 94, undefined);
  });

  test("records a generic observed Firefox interruption", async () => {
    browserState.current = "FIREFOX";
    options.trackBrowserDownloads = true;
    const { SaveHistory: history } = await import("../../../src/background/history.ts");
    vi.spyOn(history, "add").mockReturnValue("h-firefox");
    vi.spyOn(history, "setStatus").mockResolvedValue(undefined);
    await onCreated({ id: 95, filename: "/dl/a", url: "https://x/a" });

    await onChanged({ id: 95, state: { current: "interrupted" } });

    expect(history.setStatus).toHaveBeenCalledWith("h-firefox", "failed", 95, undefined);
  });
});

describe("listener registration", () => {
  test("registers bounded download and notification listeners synchronously", async () => {
    vi.resetModules();
    setupGlobals({}, () => []);
    await loadNotification();

    expect(global.browser.downloads.onCreated.addListener).toHaveBeenCalledWith(
      expect.any(Function),
    );
    expect(global.browser.downloads.onChanged.addListener).toHaveBeenCalledWith(
      expect.any(Function),
    );
    expect(global.browser.notifications.onClicked.addListener).toHaveBeenCalledWith(
      expect.any(Function),
    );

    Notifier.onDownloadCreated = vi.fn(() => Promise.reject(new Error("broken event")));
    const [onCreated] = vi.mocked(global.browser.downloads.onCreated.addListener).mock.calls[0]!;
    await expect(onCreated({ id: 7 } as browser.downloads.DownloadItem)).resolves.toBeUndefined();
    expect(Log.add).toHaveBeenCalledWith("download created event failed", "Error: broken event");
  });

  test("tolerates hosts without download or notification events", async () => {
    vi.resetModules();
    setupGlobals({}, () => []);
    await loadNotification();
    const { registerNotifier } = await import("../../../src/downloads/notification.ts");
    (global.browser.downloads as any).onCreated = undefined;
    (global.browser.notifications as any).onClicked = undefined;

    expect(() => registerNotifier()).not.toThrow();
  });
});

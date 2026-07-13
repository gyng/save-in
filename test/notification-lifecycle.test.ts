import {
  downloadState,
  browserState,
  retryHolder,
  Notifier,
  options,
  Log,
  SaveHistory,
  loadNotification,
  adoptedIds,
  setupGlobals,
} from "./notification-session-fixture.ts";

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
    const { SaveHistory: history } = await import("../src/background/history.ts");
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
    const { SaveHistory: history } = await import("../src/background/history.ts");
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
    const { BrowserDownloadRouting } = await import("../src/downloads/browser-downloads.ts");
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
    const { SaveHistory: history } = await import("../src/background/history.ts");
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
    const { BrowserDownloadRouting } = await import("../src/downloads/browser-downloads.ts");
    vi.spyOn(BrowserDownloadRouting, "route").mockResolvedValue("sorted/native.bin");
    const { SaveHistory: history } = await import("../src/background/history.ts");
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
    const { BrowserDownloadRouting } = await import("../src/downloads/browser-downloads.ts");
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
});

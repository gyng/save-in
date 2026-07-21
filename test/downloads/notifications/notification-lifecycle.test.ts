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

  test("puts a webhook diagnostic from a completed save in the download log", async () => {
    // The outcome webhook reports through the log the rest of this download
    // already writes to, so a receiver that never heard about the save is
    // explained in the same place as everything else that happened to it.
    Object.assign(options, {
      webhookEnabled: true,
      webhookUrl: "https://hooks.example/save",
      webhookOnComplete: true,
      webhookOnFailed: true,
    });
    vi.mocked(global.browser.permissions.getAll).mockResolvedValue({
      permissions: [],
      origins: [],
      data_collection: [],
    } as any);
    const { mergeTrackedDownload } = await import("../../../src/downloads/expected-downloads.ts");
    sessionStore.siPendingDownloads = 1;
    await onCreated({ id: 61, filename: "C:\\dl\\a.png", url: "https://x/a.png" });
    await mergeTrackedDownload(61, { webhookEligible: true });

    await onChanged({ id: 61, state: { current: "complete", previous: "in_progress" } });

    await vi.waitFor(() =>
      expect(Log.addLogEntry).toHaveBeenCalledWith(
        "webhook skipped: data permission not granted",
        undefined,
      ),
    );

    // The failure outcome reports through the same log: a receiver waiting on a
    // save it never heard fail is explained where the failure itself is.
    vi.mocked(Log.addLogEntry).mockClear();
    await mergeTrackedDownload(61, { adopted: true });
    await onChanged({ id: 61, error: { current: "NETWORK_FAILED" } });

    await vi.waitFor(() =>
      expect(Log.addLogEntry).toHaveBeenCalledWith(
        "webhook skipped: data permission not granted",
        undefined,
      ),
    );
  });

  test("tracks an isolated Save In private download without a session record", async () => {
    Notifier.expectDownload("https://private.example/p.png", { privateContext: true });

    await onCreated({
      id: 8,
      incognito: true,
      filename: "C:\\Downloads\\private.png",
      url: "https://private.example/p.png",
    });

    expect(sessionStore.siDownloads?.[8]).toBeUndefined();
  });

  test("quarantines an unclaimed Chrome download while an isolated private save is pending", async () => {
    options.trackBrowserDownloads = true;
    sessionStore.siPrivatePendingDownloads = 1;
    const history = await import("../../../src/background/history.ts");
    vi.spyOn(history, "addHistoryEntry");

    // Chrome reports an extension-started Incognito save as a regular item and
    // omits byExtensionId. After a worker restart there is no URL expectation
    // left, so the anonymous guard is the only safe ownership evidence.
    await onCreated({
      id: 9,
      filename: "C:\\Downloads\\private.png",
      url: "https://private.example/p.png",
    });

    expect(history.addHistoryEntry).not.toHaveBeenCalled();
    expect(sessionStore.siDownloads?.[9]).toBeUndefined();
    // Keep the barrier for the whole recovery lease: event ordering is not
    // enough to correlate concurrent public and private requests safely.
    expect(sessionStore.siPrivatePendingDownloads).toBe(1);
  });

  test("fails closed when public and isolated private requests overlap across restart", async () => {
    options.trackBrowserDownloads = true;
    sessionStore.siPendingDownloads = 1;
    sessionStore.siPrivatePendingDownloads = 1;

    await onCreated({
      id: 10,
      filename: "C:\\Downloads\\first.png",
      url: "https://example.test/first.png",
    });
    await onCreated({
      id: 11,
      filename: "C:\\Downloads\\second.png",
      url: "https://example.test/second.png",
    });

    // onCreated order is not proof of which concurrent downloads.download call
    // produced an item. Dropping both ownership recoveries is safer than
    // adopting the private item into normal History or notifications.
    expect(adoptedIds(sessionStore)).toEqual([]);
    expect(sessionStore.siDownloads).toBeUndefined();
    expect(sessionStore.siPendingDownloads).toBe(1);
    expect(sessionStore.siPrivatePendingDownloads).toBe(1);
  });

  test("records an ordinary browser download without adopting or retrying it", async () => {
    options.trackBrowserDownloads = true;
    const history = await import("../../../src/background/history.ts");
    vi.spyOn(history, "addHistoryEntry").mockReturnValue("h-browser");
    vi.spyOn(history, "setHistoryDownloadId").mockResolvedValue(undefined);
    vi.spyOn(history, "setHistoryStatus").mockResolvedValue(undefined);

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
    expect(SaveHistory.addHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.com/browser.zip",
        finalFullPath: "C:\\Downloads\\browser.zip",
        info: { context: "browser" },
      }),
      { privateContext: false },
    );

    await onChanged({ id: 44, state: { current: "complete", previous: "in_progress" } });

    expect(SaveHistory.setHistoryStatus).toHaveBeenCalledWith("h-browser", "complete", 44, 2048);
    expect(sessionStore.siDownloads[44]!.observedBrowserDownload).toBe(false);
    expect(retryHolder.retry).not.toHaveBeenCalled();
    expect(global.browser.notifications.create).not.toHaveBeenCalled();
  });

  test("marks an ordinary browser download that Chrome routed as routed", async () => {
    options.trackBrowserDownloads = true;
    const history = await import("../../../src/background/history.ts");
    vi.spyOn(history, "addHistoryEntry").mockReturnValue("h-routed");
    vi.spyOn(history, "setHistoryDownloadId").mockResolvedValue(undefined);
    vi.spyOn(history, "setHistoryStatus").mockResolvedValue(undefined);
    const patch = vi.spyOn(history, "patchHistoryEntry").mockResolvedValue(undefined);

    await onCreated({
      id: 45,
      filename: "C:\\Downloads\\cat.jpg",
      url: "https://cdn.example/cat.jpg",
    });
    // onDeterminingFilename decides the route only after onCreated has written
    // the row, so the outcome reaches the record rather than the row itself.
    const { mergeTrackedDownload } = await import("../../../src/downloads/expected-downloads.ts");
    await mergeTrackedDownload(45, { browserDownloadRouted: true });

    await onChanged({ id: 45, state: { current: "complete", previous: "in_progress" } });

    expect(patch).toHaveBeenCalledWith("h-routed", { routed: true });
  });

  test("does not retain ordinary downloads from private browsing by default", async () => {
    options.trackBrowserDownloads = true;
    const history = await import("../../../src/background/history.ts");
    vi.spyOn(history, "addHistoryEntry");

    await onCreated({
      id: 48,
      incognito: true,
      filename: "C:\\Downloads\\private.zip",
      url: "https://private.example/private.zip",
    });

    expect(history.addHistoryEntry).not.toHaveBeenCalled();
    expect(sessionStore.siDownloads?.[48]).toBeUndefined();
  });

  test("records private ordinary downloads only under both storage opt-ins", async () => {
    options.trackBrowserDownloads = true;
    options.persistPrivateActivity = true;
    const history = await import("../../../src/background/history.ts");
    vi.spyOn(history, "addHistoryEntry").mockReturnValue("h-private-browser");
    vi.spyOn(history, "setHistoryDownloadId").mockResolvedValue(undefined);

    await onCreated({
      id: 48,
      incognito: true,
      filename: "C:\\Downloads\\private.zip",
      url: "https://private.example/private.zip",
    });

    expect(SaveHistory.addHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        private: true,
        url: "https://private.example/private.zip",
        mechanism: "browser-download",
      }),
      { privateContext: true },
    );
    expect(sessionStore.siDownloads[48]).toMatchObject({
      observedBrowserDownload: true,
      privateContext: true,
      historyEntryId: "h-private-browser",
    });
  });

  test("does not reroute Firefox downloads from private browsing", async () => {
    browserState.current = "FIREFOX";
    options.trackBrowserDownloads = true;
    options.persistPrivateActivity = true;
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
    const history = await import("../../../src/background/history.ts");
    vi.spyOn(history, "addHistoryEntry");

    await onCreated({
      id: 45,
      byExtensionId: "another-extension",
      filename: "C:\\Downloads\\other.zip",
      url: "https://example.com/other.zip",
    });

    expect(history.addHistoryEntry).not.toHaveBeenCalled();
    expect(sessionStore.siDownloads?.[45]).toBeUndefined();
  });

  test("Firefox experimentally cancels and replaces a matching ordinary download", async () => {
    browserState.current = "FIREFOX";
    options.routeBrowserDownloadsFirefox = true;
    options.browserDownloadFilter = "*://example.com/*";
    const { BrowserDownloadRouting } = await import("../../../src/downloads/browser-downloads.ts");
    vi.spyOn(BrowserDownloadRouting, "route").mockResolvedValue("sorted/native.bin");
    const history = await import("../../../src/background/history.ts");
    vi.spyOn(history, "addHistoryEntry").mockReturnValue("h-reroute");
    vi.spyOn(history, "setHistoryDownloadId").mockResolvedValue(undefined);
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

  test("launches a persisted sidecar only after completion with the resolved filename", async () => {
    const { downloadPorts } = await import("../../../src/downloads/ports.ts");
    const sourceSidecar = vi.spyOn(downloadPorts, "sourceSidecar").mockResolvedValue(undefined);
    sessionStore.siDownloads = {
      7: {
        adopted: true,
        filename: "gallery/source-name.png",
        pendingSourceSidecar: {
          sourceUrl: "https://x/source.png",
          pageUrl: "https://x/gallery/",
        },
      },
    };
    downloadState.records.clear();

    await onChanged({
      id: 7,
      filename: { current: "C:\\Downloads\\gallery\\server-name (1).jpg" },
      state: { current: "complete", previous: "in_progress" },
    });

    expect(sourceSidecar).toHaveBeenCalledWith(
      {
        sourceUrl: "https://x/source.png",
        pageUrl: "https://x/gallery/",
      },
      "gallery/source-name.png",
      "C:\\Downloads\\gallery\\server-name (1).jpg",
    );
    expect(sessionStore.siDownloads[7]).not.toHaveProperty("pendingSourceSidecar");
    expect(sessionStore.siDownloads[7]).toMatchObject({ adopted: false });
  });

  test("drops a live data payload from the record after completion", async () => {
    const url = `data:image/png;base64,${"A".repeat(4000)}`;
    const { BackgroundState } = await import("../../../src/background/application-state.ts");
    const activeDownloadState = BackgroundState.downloads;
    activeDownloadState.records.set(7, {
      adopted: true,
      url,
      filename: "automatic/download.png",
    });

    await onChanged({
      id: 7,
      filename: { current: "C:\\Downloads\\automatic\\download.png" },
      state: { current: "complete", previous: "in_progress" },
    });

    expect(activeDownloadState.records.get(7)).toMatchObject({ adopted: false });
    expect(activeDownloadState.records.get(7)?.url).toBeUndefined();
  });

  test("drops pending sidecar intent when the primary is canceled", async () => {
    const { downloadPorts } = await import("../../../src/downloads/ports.ts");
    const sourceSidecar = vi.spyOn(downloadPorts, "sourceSidecar").mockResolvedValue(undefined);
    sessionStore.siDownloads = {
      7: {
        adopted: true,
        pendingSourceSidecar: { sourceUrl: "https://x/source.png" },
      },
    };
    downloadState.records.clear();

    await onChanged({ id: 7, error: { current: "USER_CANCELED" } });

    expect(sourceSidecar).not.toHaveBeenCalled();
    expect(sessionStore.siDownloads[7]).not.toHaveProperty("pendingSourceSidecar");
    expect(sessionStore.siDownloads[7]).toMatchObject({ adopted: false });
  });

  test("contains and records a deferred sidecar launch failure", async () => {
    const { downloadPorts } = await import("../../../src/downloads/ports.ts");
    vi.spyOn(downloadPorts, "sourceSidecar").mockRejectedValue(new Error("sidecar denied"));
    sessionStore.siDownloads = {
      7: {
        adopted: true,
        pendingSourceSidecar: { sourceUrl: "https://x/source.png" },
      },
    };
    downloadState.records.clear();

    await onChanged({ id: 7, state: { current: "complete", previous: "in_progress" } });

    expect(downloadPorts.sourceSidecar).toHaveBeenCalledWith(
      { sourceUrl: "https://x/source.png" },
      "",
      undefined,
    );
    expect(Log.addLogEntry).toHaveBeenCalledWith("source sidecar failed", "Error: sidecar denied");
    expect(sessionStore.siDownloads[7]).not.toHaveProperty("pendingSourceSidecar");
  });

  test("keeps a source sidecar silent across a worker restart", async () => {
    Notifier.expectDownload("data:text/plain,source", { sourceSidecar: true });
    await onCreated({
      id: 8,
      byExtensionId: "save-in",
      filename: "C:\\dl\\pic.url",
      url: "data:text/plain,source",
    });
    expect(sessionStore.siDownloads[8]).toMatchObject({
      adopted: true,
      sourceSidecar: true,
    });

    downloadState.records.clear();
    await onChanged({
      id: 8,
      state: { current: "complete", previous: "in_progress" },
    });

    expect(global.browser.notifications.create).not.toHaveBeenCalled();
    expect(sessionStore.siDownloads[8]).toMatchObject({ adopted: false, sourceSidecar: true });
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

  // The browser reports an absolute on-disk path, which is backslash-separated
  // on Windows; the notification names the file, not where it landed.
  test("names the file from a Windows path the browser reports", async () => {
    sessionStore.siPendingDownloads = 1;
    await onCreated({ id: 8, byExtensionId: "save-in", url: "https://x/cat.png" });

    await onChanged({ id: 8, filename: { current: "C:\\Users\\me\\Downloads\\pics\\cat.png" } });
    await onChanged({ id: 8, state: { current: "complete", previous: "in_progress" } });

    expect(global.browser.notifications.create).toHaveBeenCalledWith(
      "8",
      expect.objectContaining({ message: "cat.png" }),
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
    const history = await import("../../../src/background/history.ts");
    vi.spyOn(history, "addHistoryEntry").mockReturnValue("h-reroute");
    vi.spyOn(history, "setHistoryStatus").mockResolvedValue(undefined);
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
    expect(history.setHistoryStatus).toHaveBeenCalledWith("h-reroute", "FIREFOX_REROUTE_FAILED");
    expect(Log.addLogEntry).toHaveBeenCalledWith(
      "Firefox browser download reroute failed",
      expect.stringContaining("cancel failed"),
    );
  });

  test("tracks an ordinary browser download without a history id", async () => {
    options.trackBrowserDownloads = true;
    const history = await import("../../../src/background/history.ts");
    vi.spyOn(history, "addHistoryEntry").mockReturnValue(null);

    await onCreated({
      id: 43,
      filename: "C:\\Downloads\\browser.zip",
      url: "https://example.com/browser.zip",
    });

    expect(sessionStore.siDownloads[43]).not.toHaveProperty("historyEntryId");
  });

  test("records tracked completion size and tolerates a failed size lookup", async () => {
    const history = await import("../../../src/background/history.ts");
    vi.spyOn(history, "setHistoryStatus").mockResolvedValue(undefined);
    Notifier.expectDownload("https://x/sized.png", { historyEntryId: "h-sized" });
    await onCreated({
      id: 70,
      byExtensionId: "save-in",
      filename: "/dl/sized.png",
      url: "https://x/sized.png",
    });
    await onChanged({ id: 70, state: { current: "complete", previous: "in_progress" } });
    expect(history.setHistoryStatus).toHaveBeenCalledWith("h-sized", "complete", 70, 2048);

    Notifier.expectDownload("https://x/unknown.png", { historyEntryId: "h-unknown" });
    await onCreated({
      id: 71,
      byExtensionId: "save-in",
      filename: "/dl/unknown.png",
      url: "https://x/unknown.png",
    });
    vi.mocked(global.browser.downloads.search).mockRejectedValueOnce(new Error("search failed"));
    await onChanged({ id: 71, state: { current: "complete", previous: "in_progress" } });
    expect(history.setHistoryStatus).toHaveBeenCalledWith("h-unknown", "complete", 71);

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
    expect(history.setHistoryStatus).toHaveBeenCalledWith("h-fallback", "complete", 73, 512);

    Notifier.expectDownload("https://x/empty.png", { historyEntryId: "h-empty" });
    await onCreated({
      id: 74,
      byExtensionId: "save-in",
      filename: "/dl/empty.png",
      url: "https://x/empty.png",
    });
    vi.mocked(global.browser.downloads.search).mockResolvedValueOnce([]);
    await onChanged({ id: 74, state: { current: "complete", previous: "in_progress" } });
    expect(history.setHistoryStatus).toHaveBeenCalledWith("h-empty", "complete", 74, undefined);
  });

  test("updates and fails an observed browser-download history row", async () => {
    options.trackBrowserDownloads = true;
    const history = await import("../../../src/background/history.ts");
    vi.spyOn(history, "addHistoryEntry").mockReturnValue("h-observed");
    vi.spyOn(history, "patchHistoryEntry").mockResolvedValue(undefined);
    vi.spyOn(history, "setHistoryStatus").mockResolvedValue(undefined);
    await onCreated({
      id: 72,
      filename: "/dl/original.zip",
      url: "https://x/observed.zip",
    });

    await onChanged({ id: 72, filename: { current: "/dl/renamed.zip" } });
    expect(history.patchHistoryEntry).toHaveBeenCalledWith("h-observed", {
      finalFullPath: "/dl/renamed.zip",
    });
    await onChanged({ id: 72, error: { current: "NETWORK_FAILED" } });
    expect(history.setHistoryStatus).toHaveBeenCalledWith(
      "h-observed",
      "NETWORK_FAILED",
      72,
      undefined,
    );
    await onChanged({ id: 72, filename: { current: "/dl/ignored.zip" } });
    expect(history.patchHistoryEntry).not.toHaveBeenCalledWith("h-observed", {
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
    // The registered listeners call the real handlers directly, so drive a real
    // rejection from each: malformed download events throw inside the async
    // handlers, and a rejecting downloads.show rejects the click handler.
    // runEventTask must contain and log all three instead of letting them escape.
    vi.mocked(global.browser.downloads.show).mockRejectedValueOnce(new Error("click failed"));
    const [created] = vi.mocked(global.browser.downloads.onCreated.addListener).mock.calls[0]!;
    const [changed] = vi.mocked(global.browser.downloads.onChanged.addListener).mock.calls[0]!;
    const [clicked] = vi.mocked(global.browser.notifications.onClicked.addListener).mock.calls[0]!;

    created(undefined as any);
    changed(undefined as any);
    clicked("90");
    await vi.waitFor(() => expect(Log.addLogEntry).toHaveBeenCalledTimes(3));
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
    const history = await import("../../../src/background/history.ts");
    vi.spyOn(history, "addHistoryEntry").mockReturnValue(null);
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
    const history = await import("../../../src/background/history.ts");
    vi.spyOn(history, "addHistoryEntry").mockReturnValue("h-bytes");
    vi.spyOn(history, "setHistoryStatus").mockResolvedValue(undefined);

    await onCreated({ id: 93, filename: "/dl/a", url: "https://x/a" });
    vi.mocked(global.browser.downloads.search).mockResolvedValueOnce([
      { id: 93, fileSize: 0, totalBytes: 512 } as any,
    ]);
    await onChanged({ id: 93, state: { current: "complete" } });
    expect(history.setHistoryStatus).toHaveBeenCalledWith("h-bytes", "complete", 93, 512);

    await onCreated({ id: 94, filename: "/dl/b", url: "https://x/b" });
    vi.mocked(global.browser.downloads.search).mockResolvedValueOnce([]);
    await onChanged({ id: 94, state: { current: "complete" } });
    expect(history.setHistoryStatus).toHaveBeenCalledWith("h-bytes", "complete", 94, undefined);
  });

  test("records a generic observed Firefox interruption", async () => {
    browserState.current = "FIREFOX";
    options.trackBrowserDownloads = true;
    const history = await import("../../../src/background/history.ts");
    vi.spyOn(history, "addHistoryEntry").mockReturnValue("h-firefox");
    vi.spyOn(history, "setHistoryStatus").mockResolvedValue(undefined);
    await onCreated({ id: 95, filename: "/dl/a", url: "https://x/a" });

    await onChanged({ id: 95, state: { current: "interrupted" } });

    expect(history.setHistoryStatus).toHaveBeenCalledWith("h-firefox", "failed", 95, undefined);
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

    // A malformed event makes the real onDownloadCreated reject; the registered
    // listener wraps it in runEventTask, which resolves after logging the error.
    const [onCreated] = vi.mocked(global.browser.downloads.onCreated.addListener).mock.calls[0]!;
    await expect(
      onCreated(undefined as unknown as browser.downloads.DownloadItem),
    ).resolves.toBeUndefined();
    expect(Log.addLogEntry).toHaveBeenCalledWith(
      "download created event failed",
      expect.stringContaining("byExtensionId"),
    );
  });

  test("tolerates hosts without download or notification events", async () => {
    vi.resetModules();
    setupGlobals({}, () => []);
    await loadNotification();
    const { registerNotifier } = await import("../../../src/downloads/notification.ts");
    (global.browser.downloads as any).onCreated = undefined;
    (global.browser.notifications as any).onClicked = undefined;

    expect(() => registerNotifier()).not.toThrow();

    // Firefox has no notifications.onButtonClicked, and some embedders omit
    // the notifications namespace entirely; the button probe must stay quiet.
    (global.browser as any).notifications = undefined;
    expect(() => registerNotifier()).not.toThrow();
  });
});

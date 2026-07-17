import {
  browserState,
  Notifier,
  options,
  Log,
  SaveHistory,
  Runtime,
  loadNotification,
  adoptedIds,
  setupGlobals,
} from "./session.fixture.ts";

describe("notification variants", () => {
  let sessionStore: Record<string, any>;
  let onCreated: any;
  let onChanged: any;

  const install = async (
    opts: Record<string, any>,
    searchResults: (query: any) => any = () => [],
  ) => {
    vi.resetModules();
    vi.useFakeTimers();
    sessionStore = {};
    setupGlobals(sessionStore, searchResults);
    await loadNotification();
    Object.assign(options, opts);
    const [createdHandler] = vi.mocked(global.browser.downloads.onCreated.addListener).mock
      .calls[0]!;
    const [changedHandler] = vi.mocked(global.browser.downloads.onChanged.addListener).mock
      .calls[0]!;
    onCreated = createdHandler;
    onChanged = changedHandler;
  };

  const startTracked = async (item: Record<string, any>) => {
    sessionStore.siPendingDownloads = 1;
    await onCreated(Object.assign({ byExtensionId: "save-in" }, item));
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  test("promptOnFailure re-prompts with saveAs", async () => {
    await install({ notifyOnFailure: false, promptOnFailure: true, notifyDuration: 1000 });
    await startTracked({ id: 7, filename: "/dl/pic.png", url: "https://x/p.png" });

    await onChanged({ id: 7, error: { current: "NETWORK_FAILED" } });

    expect(global.browser.downloads.download).toHaveBeenCalledWith({
      url: "https://x/p.png",
      saveAs: true,
    });
    expect(global.browser.notifications.create).not.toHaveBeenCalled();
  });

  test("promptOnFailure skips partial records without an original URL", async () => {
    await install({ notifyOnFailure: false, promptOnFailure: true, notifyDuration: 1000 });
    await startTracked({ id: 7, filename: "/dl/pic.png" });

    await onChanged({ id: 7, error: { current: "NETWORK_FAILED" } });

    expect(global.browser.downloads.download).not.toHaveBeenCalled();
  });

  test("contains a rejected failure Save As prompt", async () => {
    await install({ notifyOnFailure: false, promptOnFailure: true, notifyDuration: 1000 });
    await startTracked({ id: 7, filename: "/dl/pic.png", url: "https://x/p.png" });
    vi.mocked(global.browser.downloads.download).mockRejectedValueOnce(new Error("prompt failed"));

    await onChanged({ id: 7, error: { current: "NETWORK_FAILED" } });

    expect(Log.addLogEntry).toHaveBeenCalledWith(
      "failure Save As download failed",
      expect.stringContaining("prompt failed"),
    );
  });

  test("contains offscreen blob release failures", async () => {
    await install({ notifyOnSuccess: false, notifyOnFailure: false });
    const { OffscreenClient } = await import("../../../src/platform/offscreen-client.ts");
    vi.spyOn(OffscreenClient, "release").mockRejectedValue(new Error("release failed"));
    Notifier.expectDownload("https://x/p.png", { offscreenRequestId: "offscreen-1" });
    await onCreated({
      id: 7,
      byExtensionId: "save-in",
      filename: "/dl/pic.png",
      url: "https://x/p.png",
    });

    await onChanged({ id: 7, state: { current: "complete", previous: "in_progress" } });

    expect(Log.addLogEntry).toHaveBeenCalledWith(
      "offscreen blob release failed",
      expect.stringContaining("release failed"),
    );
  });

  test("promptOnFailure keeps a Firefox private download off the record", async () => {
    await install({ notifyOnFailure: false, promptOnFailure: true, notifyDuration: 1000 });
    browserState.current = "FIREFOX";
    Notifier.expectDownload("https://private.example/p.png", { privateContext: true });
    await onCreated({
      id: 8,
      incognito: true,
      filename: "/dl/private.png",
      url: "https://private.example/p.png",
    });

    await onChanged({ id: 8, error: { current: "NETWORK_FAILED" } });

    expect(global.browser.downloads.download).toHaveBeenCalledWith({
      url: "https://private.example/p.png",
      saveAs: true,
      incognito: true,
    });
  });

  test("promptOnFailure does not bypass a protected original URL", async () => {
    await install({ notifyOnFailure: false, promptOnFailure: true, notifyDuration: 1000 });
    Notifier.expectDownload("https://x/p.png", {
      url: "https://x/p.png",
      allowOriginalUrlFallback: false,
    });
    await onCreated({
      id: 7,
      byExtensionId: "save-in",
      filename: "/dl/pic.png",
      url: "https://x/p.png",
    });

    await onChanged({ id: 7, error: { current: "NETWORK_FAILED" } });

    expect(global.browser.downloads.download).not.toHaveBeenCalled();
  });

  test("user-cancelled downloads are untracked without a notification", async () => {
    await install({ notifyOnSuccess: true, notifyOnFailure: true, notifyDuration: 1000 });
    vi.spyOn(SaveHistory, "setHistoryStatus").mockResolvedValue(undefined);
    Notifier.expectDownload("https://x/p.png", { historyEntryId: "h-test" });
    await onCreated({
      id: 7,
      byExtensionId: "save-in",
      filename: "/dl/pic.png",
      url: "https://x/p.png",
    });

    await onChanged({ id: 7, error: { current: "USER_CANCELED" } });

    expect(global.browser.notifications.create).not.toHaveBeenCalled();
    expect(SaveHistory.setHistoryStatus).toHaveBeenCalledWith("h-test", "USER_CANCELED", 7);
    expect(adoptedIds(sessionStore)).toEqual([]);
  });

  test("failures are logged when a Log global is present", async () => {
    await install({ notifyOnFailure: true, notifyDuration: 1000 });
    await startTracked({ id: 7, filename: "/dl/pic.png", url: "https://x/p.png" });

    await onChanged({ id: 7, error: { current: "NETWORK_FAILED" } });

    expect(Log.addLogEntry).toHaveBeenCalledWith("download failed", {
      id: 7,
      error: "NETWORK_FAILED",
    });
  });

  test("Firefox interruptions fall back to a generic error message", async () => {
    await install({ notifyOnFailure: true, notifyDuration: 1000 });
    browserState.current = "FIREFOX";
    await startTracked({ id: 7, filename: "/dl/pic.png", url: "https://x/p.png" });

    await onChanged({ id: 7, state: { current: "interrupted", previous: "in_progress" } });

    expect(Log.addLogEntry).toHaveBeenCalledWith("download failed", { id: 7, error: true });
    expect(global.browser.notifications.create).toHaveBeenCalledWith(
      "7",
      expect.objectContaining({ message: "Translated<genericUnknownError>" }),
    );
  });

  test("clears the failure notification after notifyDuration", async () => {
    await install({ notifyOnFailure: true, notifyDuration: 1000 });
    await startTracked({ id: 7, filename: "/dl/pic.png", url: "https://x/p.png" });

    await onChanged({ id: 7, error: { current: "NETWORK_FAILED" } });

    expect(global.browser.notifications.clear).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(global.browser.notifications.clear).toHaveBeenCalledWith("7");
  });

  test("download id 0 uses the same clear timer as other notifications", async () => {
    await install({ notifyOnFailure: true, notifyDuration: 1000 });
    await startTracked({ id: 0, filename: "/dl/pic.png", url: "https://x/p.png" });

    await onChanged({ id: 0, error: { current: "NETWORK_FAILED" } });

    expect(global.browser.notifications.create).toHaveBeenCalledWith("0", expect.anything());
    vi.runAllTimers();
    expect(global.browser.notifications.clear).toHaveBeenCalledWith("0");
  });

  test("successes are logged and pass browser metadata to the notification model", async () => {
    await install({ notifyOnSuccess: true, notifyDuration: 1000 }, () => [
      { id: 7, fileSize: 2500000, mime: "image/png" },
    ]);
    await startTracked({ id: 7, filename: "/dl/pic.png", url: "https://x/p.png" });

    await onChanged({ id: 7, state: { current: "complete", previous: "in_progress" } });

    expect(Log.addLogEntry).toHaveBeenCalledWith("download complete", {
      id: 7,
      filename: "pic.png",
    });
    expect(global.browser.notifications.create).toHaveBeenCalledWith(
      "7",
      expect.objectContaining({
        title: "Translated<notificationSuccessTitle> · 2.5 MB · image/png",
        iconUrl: "icons/ic_archive_black_128px.png",
      }),
    );
  });

  test("notifyOnSuccess false suppresses the success notification", async () => {
    await install({ notifyOnSuccess: false, notifyOnFailure: true, notifyDuration: 1000 });
    await startTracked({ id: 7, filename: "/dl/pic.png", url: "https://x/p.png" });

    await onChanged({ id: 7, state: { current: "complete", previous: "in_progress" } });

    expect(global.browser.notifications.create).not.toHaveBeenCalled();
    expect(adoptedIds(sessionStore)).toEqual([]);
  });

  test("debug mode logs listener decisions", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      // The "Bad notify duration" preamble died with addNotifications;
      // per-event debug logging remains
      await install({ notifyOnSuccess: true, notifyOnFailure: true });
      Runtime.debug = true;

      await startTracked({ id: 7, filename: "/dl/pic.png", url: "https://x/p.png" });
      await onChanged({ id: 7, error: { current: "NETWORK_FAILED" } });

      await startTracked({ id: 8, filename: "/dl/pic2.png", url: "https://x/p2.png" });
      await onChanged({ id: 8, state: { current: "complete", previous: "in_progress" } });

      const logged = logSpy.mock.calls.map((c) => c[0]!);
      expect(logged).toContain("notification");
      expect(logged).toContain("notification: created failure");
      expect(logged).toContain("notification: created success");
    } finally {
      Runtime.debug = false;
      logSpy.mockRestore();
    }
  });
});

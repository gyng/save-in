import {
  retryHolder,
  Notifier,
  options,
  loadNotification,
  adoptedIds,
  setupGlobals,
} from "./notification-session-fixture.ts";

describe("reportFailure", () => {
  beforeEach(() => {
    vi.resetModules();
    setupGlobals({}, () => []);
  });

  test("fires a failure notification when notifyOnFailure is on", async () => {
    vi.useFakeTimers();
    await loadNotification();
    Object.assign(options, { notifyOnFailure: true, notifyDuration: 0 });

    Notifier.reportFailure("file.png", "boom");
    vi.advanceTimersByTime(250);

    expect(global.browser.notifications.create).toHaveBeenCalledWith(
      "save-in-not-download-failure",
      expect.objectContaining({ iconUrl: "icons/ic_archive_black_128px.png" }),
    );
  });

  test("uses localized fallbacks when failure details are empty", async () => {
    vi.useFakeTimers();
    await loadNotification();
    Object.assign(options, { notifyOnFailure: true, notifyDuration: 0 });

    Notifier.reportFailure("", undefined);
    vi.advanceTimersByTime(250);

    expect(global.browser.notifications.create).toHaveBeenCalledWith(
      "save-in-not-download-failure",
      expect.objectContaining({ message: "Translated<genericUnknownError>" }),
    );
  });

  test("stays silent when notifyOnFailure is off", async () => {
    await loadNotification();
    Object.assign(options, { notifyOnFailure: false });

    Notifier.reportFailure("file.png", "boom");

    expect(global.browser.notifications.create).not.toHaveBeenCalled();
  });
});

describe("expectDownload", () => {
  test("an expected download is tracked without the session fallback", async () => {
    vi.resetModules();
    const sessionStore = {};
    setupGlobals(sessionStore, () => []);
    await loadNotification();
    // Ignore the startup pending-count reconciliation's read; this test is about
    // the download flow itself
    vi.mocked(global.browser.storage.session.get).mockClear();

    Notifier.expectDownload();
    await Notifier.onDownloadCreated({ id: 9, byExtensionId: "save-in", filename: "/dl/x.png" });

    expect(adoptedIds(sessionStore)).toEqual([9]);
    // The session fallback was never consulted
    expect(global.browser.storage.session.get).not.toHaveBeenCalledWith("siPendingDownloads");
  });

  test("two expected downloads are both tracked (counter semantics)", async () => {
    vi.resetModules();
    const sessionStore = {};
    setupGlobals(sessionStore, () => []);
    await loadNotification();

    Notifier.expectDownload();
    Notifier.expectDownload();
    await Notifier.onDownloadCreated({ id: 1, byExtensionId: "save-in", filename: "/dl/a.png" });
    await Notifier.onDownloadCreated({ id: 2, byExtensionId: "save-in", filename: "/dl/b.png" });

    expect(adoptedIds(sessionStore)).toEqual([1, 2]);
  });

  test("matches expected downloads by URL and supports cancellation", async () => {
    vi.resetModules();
    const sessionStore = {};
    setupGlobals(sessionStore, () => []);
    await loadNotification();

    const cancelled = Notifier.expectDownload("https://x/cancelled.png");
    Notifier.cancelExpectedDownload(cancelled);
    Notifier.expectDownload("https://x/ours.png");

    await Notifier.onDownloadCreated({
      id: 1,
      byExtensionId: "save-in",
      url: "https://x/other.png",
      filename: "/dl/other.png",
    });
    expect(adoptedIds(sessionStore)).toEqual([]);

    await Notifier.onDownloadCreated({
      id: 2,
      byExtensionId: "save-in",
      url: "https://x/ours.png",
      filename: "/dl/ours.png",
    });
    expect(adoptedIds(sessionStore)).toEqual([2]);
  });

  test("matches an expected redirect by final URL and ignores duplicate cancellation", async () => {
    vi.resetModules();
    const sessionStore = {};
    setupGlobals(sessionStore, () => []);
    await loadNotification();
    const expected = Notifier.expectDownload("https://x/final.png");
    Notifier.cancelExpectedDownload(expected);
    Notifier.cancelExpectedDownload(expected);
    Notifier.expectDownload("https://x/final.png");

    await Notifier.onDownloadCreated({
      id: 3,
      byExtensionId: "save-in",
      url: "https://x/request.png",
      finalUrl: "https://x/final.png",
      filename: "/dl/final.png",
    });
    expect(adoptedIds(sessionStore)).toEqual([3]);
  });
});

describe("automatic fetch fallback gating", () => {
  let onCreated: any;
  let onChanged: any;
  let sessionStore: Record<string, any>;

  const setupWithDownload = async (retryResult: boolean) => {
    vi.resetModules();
    sessionStore = {};
    setupGlobals(sessionStore, () => [{ id: 7, fileSize: 2048, mime: "image/png" }]);
    await loadNotification();
    Object.assign(options, {
      notifyOnSuccess: true,
      notifyOnFailure: true,
      notifyDuration: 1000,
      promptOnFailure: false,
    });
    retryHolder.retry = vi.fn((downloadId: any) => {
      void downloadId;
      return Promise.resolve(retryResult === true);
    });

    const [createdHandler] = vi.mocked(global.browser.downloads.onCreated.addListener).mock
      .calls[0]!;
    const [changedHandler] = vi.mocked(global.browser.downloads.onChanged.addListener).mock
      .calls[0]!;
    onCreated = createdHandler;
    onChanged = changedHandler;

    sessionStore.siPendingDownloads = 1;
    await onCreated({
      id: 7,
      byExtensionId: "save-in",
      filename: "C:\\dl\\pic.png",
      url: "https://x/p.png",
    });
  };

  test("a network failure is retried and the failure notification suppressed", async () => {
    await setupWithDownload(true);

    await onChanged({ id: 7, error: { current: "NETWORK_FAILED" } });

    expect(retryHolder.retry).toHaveBeenCalledWith(7);
    expect(global.browser.notifications.create).not.toHaveBeenCalled();
    // The failed original is untracked; the retry tracks itself
    expect(adoptedIds(sessionStore)).toEqual([]);
  });

  test("when the retry does not start, the failure notification shows", async () => {
    await setupWithDownload(false);

    await onChanged({ id: 7, error: { current: "SERVER_FORBIDDEN" } });

    expect(retryHolder.retry).toHaveBeenCalledWith(7);
    expect(global.browser.notifications.create).toHaveBeenCalled();
  });

  test("file errors are not retried", async () => {
    await setupWithDownload(true);

    await onChanged({ id: 7, error: { current: "FILE_FAILED" } });

    expect(retryHolder.retry).not.toHaveBeenCalled();
    expect(global.browser.notifications.create).toHaveBeenCalled();
  });

  test("user cancellation is never retried or notified", async () => {
    await setupWithDownload(true);

    await onChanged({ id: 7, error: { current: "USER_CANCELED" } });

    expect(retryHolder.retry).not.toHaveBeenCalled();
    expect(global.browser.notifications.create).not.toHaveBeenCalled();
  });
});

// storage.session download tracking: notifications must survive MV3 service
// worker restarts between download start and completion

// SessionState and DownloadState are the real modules under test (session
// persistence + record hydration/pruning); notification.ts is re-imported per
// test for its module-load side effects, and its other deps are imported real
// alongside it.
import { BackgroundState } from "../src/background-state.ts";

const downloadState = BackgroundState.downloads;

// chrome-detector now exports setCurrentBrowser, but this suite resetModules +
// re-imports notification.ts per test (re-binding a fresh chrome-detector each
// time), so a hoisted-holder getter stays the stable control point across the
// re-binds (BROWSERS is a plain constant). A couple of tests flip the holder.
const browserState = vi.hoisted(() => ({ current: "CHROME" }));
vi.mock("../src/chrome-detector.ts", () => ({
  BROWSERS: { CHROME: "CHROME", FIREFOX: "FIREFOX", UNKNOWN: "UNKNOWN" },
  get WEB_EXTENSION_CAPABILITIES() {
    return { downloadDeltaFilename: browserState.current === "CHROME" };
  },
}));

const retryHolder = vi.hoisted(() => ({
  retry: vi.fn((downloadId: any) => {
    void downloadId;
    return Promise.resolve(false);
  }),
}));
vi.mock("../src/download-retry.ts", () => ({
  DownloadRetry: {
    retry: (downloadId: any) => retryHolder.retry(downloadId),
  },
}));

// notification.ts and its remaining deps (option, log) are re-imported after
// each resetModules; grab the fresh singletons the notifier binds to so the
// tests mutate/assert the same instances.
let Notifier: any;
let options: any;
let Log: any;

const loadNotification = async () => {
  const mod = await import("../src/notification.ts");
  await mod.notifierReady;
  Notifier = mod.Notifier;
  ({ options } = await import("../src/options-data.ts"));
  ({ Log } = await import("../src/log.ts"));
  // Reset the real options bag to empty; each test sets the fields it needs
  for (const k of Object.keys(options)) delete options[k];
  // Log is defensive (typeof Log !== "undefined"); spy it so its calls are
  // assertable and it never writes to the session store
  vi.spyOn(Log, "add").mockImplementation(() => Promise.resolve());
  // Side effects are deferred (Task #2): notification.ts no longer registers the
  // download/notification listeners at import — the entry does, so register them
  // here against the browser stubs setupGlobals installed above.
  mod.registerNotifier();
  return Notifier;
};

const makeSessionMock = (store: Record<string, any>) => ({
  get: jest.fn((key: string) =>
    Promise.resolve(key == null ? { ...store } : { [key]: store[key] }),
  ),
  set: jest.fn((obj: Record<string, any>) => {
    Object.assign(store, obj);
    return Promise.resolve();
  }),
});

// Membership is now the `adopted` flag on each persisted DownloadState record;
// the sorted ids of the records currently adopted are what the old
// siTrackedDownloads array used to hold.
const adoptedIds = (store: Record<string, any>) =>
  Object.keys(store.siDownloads || {})
    .filter((id) => store.siDownloads[id] && store.siDownloads[id].adopted)
    .map(Number);

const setupGlobals = (sessionStore: Record<string, any>, searchResults: (query: any) => any) => {
  // Handlers await window.ready when set; none of these tests want that
  delete global.window.ready;
  // downloadState.records is a module singleton; clear the in-memory mirror and
  // the memoized hydration so each test rebuilds the records from its own
  // sessionStore
  downloadState.records.clear();
  downloadState.hydration = null;
  browserState.current = "CHROME";
  retryHolder.retry = vi.fn((downloadId: any) => {
    void downloadId;
    return Promise.resolve(false);
  });

  (global.browser as any).runtime = Object.assign(global.browser.runtime || {}, { id: "save-in" });
  (global.browser.storage as any).session = makeSessionMock(sessionStore);
  (global.browser.downloads as any).search = jest.fn((query: any) =>
    Promise.resolve(searchResults(query)),
  );
  (global.browser.downloads as any).onCreated = {
    addListener: jest.fn(),
    removeListener: jest.fn(),
    hasListener: jest.fn(() => true),
  };
  (global.browser.downloads as any).onChanged = {
    addListener: jest.fn(),
    removeListener: jest.fn(),
    hasListener: jest.fn(() => true),
  };
  (global.browser.downloads as any).show = jest.fn();
  (global.browser.downloads as any).download = jest.fn();
  (global.browser as any).notifications = {
    create: jest.fn(),
    clear: jest.fn(),
    onClicked: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
      hasListener: jest.fn(() => true),
    },
  };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startup restore", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test("prunes downloads that completed while the worker was dead", async () => {
    const sessionStore = {
      siDownloads: {
        11: { adopted: true, historyEntryId: "h11" },
        12: { adopted: true, historyEntryId: "h12" },
        13: { adopted: true, historyEntryId: "h13" },
      },
    };
    setupGlobals(sessionStore, (query) => {
      if (query.id === 11) return [{ id: 11, state: "complete" }];
      if (query.id === 12) return [{ id: 12, state: "in_progress" }];
      return []; // 13 vanished entirely
    });

    await loadNotification();

    // only the still-live download stays adopted; the record (and its
    // historyEntryId) is retained, just no longer watched
    expect(adoptedIds(sessionStore)).toEqual([12]);
    expect(sessionStore.siDownloads[11]).toMatchObject({ adopted: false, historyEntryId: "h11" });
  });

  test("does not throw when storage.session is unavailable (older Firefox)", async () => {
    setupGlobals({}, () => []);
    (global.browser.storage as any).session = undefined;

    await expect(loadNotification()).resolves.toBeDefined();
  });

  test("keeps adoption when every download is still live", async () => {
    const sessionStore = { siDownloads: { 12: { adopted: true, historyEntryId: "h12" } } };
    setupGlobals(sessionStore, () => [{ id: 12, state: "in_progress" }]);

    await loadNotification();

    // A live download keeps its adoption; storage.session is not written at all
    // (nothing to prune)
    expect(adoptedIds(sessionStore)).toEqual([12]);
    expect(global.browser.storage.session.set).not.toHaveBeenCalled();
  });

  test("clears adoption when the download lookup fails", async () => {
    const sessionStore = { siDownloads: { 21: { adopted: true } } };
    setupGlobals(sessionStore, () => []);
    (global.browser.downloads as any).search = jest.fn(() => Promise.reject(new Error("boom")));

    await loadNotification();

    expect(adoptedIds(sessionStore)).toEqual([]);
  });

  test("clears a stale pending count after the grace window", async () => {
    jest.useFakeTimers();
    try {
      const sessionStore = { siPendingDownloads: 3 };
      setupGlobals(sessionStore, () => []);

      await loadNotification();

      // honored immediately after startup so an in-flight download can recover
      expect(sessionStore.siPendingDownloads).toBe(3);

      // ...but a stale leak is cleared once the grace window elapses
      await jest.advanceTimersByTimeAsync(10000);
      expect(sessionStore.siPendingDownloads).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("download lifecycle notifications", () => {
  let sessionStore: Record<string, any>;
  let onCreated: any;
  let onChanged: any;

  beforeEach(async () => {
    jest.resetModules();
    jest.useFakeTimers();
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

    const [[createdHandler]] = vi.mocked(global.browser.downloads.onCreated.addListener).mock.calls;
    const [[changedHandler]] = vi.mocked(global.browser.downloads.onChanged.addListener).mock.calls;
    onCreated = createdHandler;
    onChanged = changedHandler;
  });

  afterEach(() => {
    jest.useRealTimers();
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
    expect(sessionStore.siDownloads[7]).toMatchObject({ adopted: true });

    // a restart wipes the in-memory mirror; the persisted record survives
    downloadState.records.clear();

    await onChanged({ id: 7, state: { current: "complete", previous: "in_progress" } });

    expect(global.browser.notifications.create).toHaveBeenCalledWith(
      "7",
      expect.objectContaining({ type: "basic" }),
    );
    // adoption is cleared at the terminal delta, but the record is retained
    expect(sessionStore.siDownloads[7]).toMatchObject({ adopted: false });
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
    const [[onClicked]] = vi.mocked(global.browser.notifications.onClicked.addListener).mock.calls;

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
    jest.runAllTimers();
    expect(global.browser.notifications.clear).toHaveBeenCalledWith("7");
  });
});

describe("listener registration", () => {
  test("registers download and notification listeners at import (MV3 requirement)", async () => {
    jest.resetModules();
    setupGlobals({}, () => []);
    await loadNotification();

    // Registered synchronously at module load with stable named handlers, so
    // a service worker woken BY one of these events still handles it
    expect(global.browser.downloads.onCreated.addListener).toHaveBeenCalledWith(
      Notifier.onDownloadCreated,
    );
    expect(global.browser.downloads.onChanged.addListener).toHaveBeenCalledWith(
      Notifier.onDownloadChanged,
    );
    expect(global.browser.notifications.onClicked.addListener).toHaveBeenCalledWith(
      Notifier.onNotificationClicked,
    );
  });
});

describe("notification variants", () => {
  let sessionStore: Record<string, any>;
  let onCreated: any;
  let onChanged: any;

  const install = async (
    opts: Record<string, any>,
    searchResults: (query: any) => any = () => [],
  ) => {
    jest.resetModules();
    jest.useFakeTimers();
    sessionStore = {};
    setupGlobals(sessionStore, searchResults);
    await loadNotification();
    Object.assign(options, opts);
    const [[createdHandler]] = vi.mocked(global.browser.downloads.onCreated.addListener).mock.calls;
    const [[changedHandler]] = vi.mocked(global.browser.downloads.onChanged.addListener).mock.calls;
    onCreated = createdHandler;
    onChanged = changedHandler;
  };

  const startTracked = async (item: Record<string, any>) => {
    sessionStore.siPendingDownloads = 1;
    await onCreated(Object.assign({ byExtensionId: "save-in" }, item));
  };

  afterEach(() => {
    jest.useRealTimers();
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

  test("user-cancelled downloads are untracked without a notification", async () => {
    await install({ notifyOnSuccess: true, notifyOnFailure: true, notifyDuration: 1000 });
    await startTracked({ id: 7, filename: "/dl/pic.png", url: "https://x/p.png" });

    await onChanged({ id: 7, error: { current: "USER_CANCELED" } });

    expect(global.browser.notifications.create).not.toHaveBeenCalled();
    expect(adoptedIds(sessionStore)).toEqual([]);
  });

  test("failures are logged when a Log global is present", async () => {
    await install({ notifyOnFailure: true, notifyDuration: 1000 });
    await startTracked({ id: 7, filename: "/dl/pic.png", url: "https://x/p.png" });

    await onChanged({ id: 7, error: { current: "NETWORK_FAILED" } });

    expect(Log.add).toHaveBeenCalledWith("download failed", {
      id: 7,
      error: "NETWORK_FAILED",
    });
  });

  test("Firefox interruptions fall back to a generic error message", async () => {
    await install({ notifyOnFailure: true, notifyDuration: 1000 });
    browserState.current = "FIREFOX";
    await startTracked({ id: 7, filename: "/dl/pic.png", url: "https://x/p.png" });

    await onChanged({ id: 7, state: { current: "interrupted", previous: "in_progress" } });

    expect(Log.add).toHaveBeenCalledWith("download failed", { id: 7, error: true });
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
    jest.runAllTimers();
    expect(global.browser.notifications.clear).toHaveBeenCalledWith("7");
  });

  test("download id 0 never schedules a clear timer", async () => {
    await install({ notifyOnFailure: true, notifyDuration: 1000 });
    await startTracked({ id: 0, filename: "/dl/pic.png", url: "https://x/p.png" });

    await onChanged({ id: 0, error: { current: "NETWORK_FAILED" } });

    expect(global.browser.notifications.create).toHaveBeenCalledWith("0", expect.anything());
    jest.runAllTimers();
    expect(global.browser.notifications.clear).not.toHaveBeenCalled();
  });

  test("successes are logged and show megabyte sizes", async () => {
    await install({ notifyOnSuccess: true, notifyDuration: 1000 }, () => [
      { id: 7, fileSize: 2500000, mime: "image/png" },
    ]);
    await startTracked({ id: 7, filename: "/dl/pic.png", url: "https://x/p.png" });

    await onChanged({ id: 7, state: { current: "complete", previous: "in_progress" } });

    expect(Log.add).toHaveBeenCalledWith("download complete", {
      id: 7,
      filename: "pic.png",
    });
    expect(global.browser.notifications.create).toHaveBeenCalledWith(
      "7",
      expect.objectContaining({ title: expect.stringContaining("2.5 MB") }),
    );
  });

  test("small downloads show byte sizes", async () => {
    await install({ notifyOnSuccess: true, notifyDuration: 1000 }, () => [
      { id: 7, fileSize: 512, mime: "text/plain" },
    ]);
    await startTracked({ id: 7, filename: "/dl/pic.png", url: "https://x/p.png" });

    await onChanged({ id: 7, state: { current: "complete", previous: "in_progress" } });

    expect(global.browser.notifications.create).toHaveBeenCalledWith(
      "7",
      expect.objectContaining({ title: expect.stringContaining("512 B") }),
    );
  });

  test("missing file sizes leave the size out", async () => {
    await install({ notifyOnSuccess: true, notifyDuration: 1000 }, () => [
      { id: 7, mime: "text/plain" },
    ]);
    await startTracked({ id: 7, filename: "/dl/pic.png", url: "https://x/p.png" });

    await onChanged({ id: 7, state: { current: "complete", previous: "in_progress" } });

    expect(global.browser.notifications.create).toHaveBeenCalledWith(
      "7",
      expect.objectContaining({
        title: "Translated<notificationSuccessTitle> ·  · text/plain",
      }),
    );
  });

  test("an empty search result falls back to a bare success title", async () => {
    await install({ notifyOnSuccess: true, notifyDuration: 1000 }, () => []);
    await startTracked({ id: 7, filename: "/dl/pic.png", url: "https://x/p.png" });

    await onChanged({ id: 7, state: { current: "complete", previous: "in_progress" } });

    expect(global.browser.notifications.create).toHaveBeenCalledWith(
      "7",
      expect.objectContaining({ title: "Translated<notificationSuccessTitle>" }),
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
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    window.SI_DEBUG = 1;
    try {
      // The "Bad notify duration" preamble died with addNotifications;
      // per-event debug logging remains
      await install({ notifyOnSuccess: true, notifyOnFailure: true });

      await startTracked({ id: 7, filename: "/dl/pic.png", url: "https://x/p.png" });
      await onChanged({ id: 7, error: { current: "NETWORK_FAILED" } });

      await startTracked({ id: 8, filename: "/dl/pic2.png", url: "https://x/p2.png" });
      await onChanged({ id: 8, state: { current: "complete", previous: "in_progress" } });

      const logged = logSpy.mock.calls.map((c) => c[0]);
      expect(logged).toContain("notification");
      expect(logged).toContain("notification: created failure");
      expect(logged).toContain("notification: created success");
    } finally {
      window.SI_DEBUG = 0;
      logSpy.mockRestore();
    }
  });
});

describe("reportFailure", () => {
  beforeEach(() => {
    jest.resetModules();
    setupGlobals({}, () => []);
  });

  test("fires a failure notification when notifyOnFailure is on", async () => {
    await loadNotification();
    Object.assign(options, { notifyOnFailure: true, notifyDuration: 0 });

    Notifier.reportFailure("file.png", "boom");

    expect(global.browser.notifications.create).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ iconUrl: expect.stringContaining("error") }),
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
    jest.resetModules();
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
    jest.resetModules();
    const sessionStore = {};
    setupGlobals(sessionStore, () => []);
    await loadNotification();

    Notifier.expectDownload();
    Notifier.expectDownload();
    await Notifier.onDownloadCreated({ id: 1, byExtensionId: "save-in", filename: "/dl/a.png" });
    await Notifier.onDownloadCreated({ id: 2, byExtensionId: "save-in", filename: "/dl/b.png" });

    expect(adoptedIds(sessionStore)).toEqual([1, 2]);
  });
});

describe("automatic fetch fallback gating", () => {
  let onCreated: any;
  let onChanged: any;
  let sessionStore: Record<string, any>;

  const setupWithDownload = async (retryResult: boolean) => {
    jest.resetModules();
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

    const [[createdHandler]] = vi.mocked(global.browser.downloads.onCreated.addListener).mock.calls;
    const [[changedHandler]] = vi.mocked(global.browser.downloads.onChanged.addListener).mock.calls;
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

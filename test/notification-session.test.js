// storage.session download tracking: notifications must survive MV3 service
// worker restarts between download start and completion

// Microtask flush (jsdom in jest 27 has no setImmediate; plain promise
// hops also keep working under fake timers)
const flush = async (times = 10) => {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
};

const makeSessionMock = (store) => ({
  get: jest.fn((key) => Promise.resolve(key == null ? { ...store } : { [key]: store[key] })),
  set: jest.fn((obj) => {
    Object.assign(store, obj);
    return Promise.resolve();
  }),
});

const setupGlobals = (sessionStore, searchResults) => {
  // Handlers await window.ready when set; none of these tests want that
  delete global.window.ready;
  global.BROWSERS = { CHROME: "CHROME", FIREFOX: "FIREFOX" };
  global.CURRENT_BROWSER = "CHROME";

  global.browser.storage.session = makeSessionMock(sessionStore);
  global.browser.downloads.search = jest.fn((query) => Promise.resolve(searchResults(query)));
  global.browser.downloads.onCreated = {
    addListener: jest.fn(),
    removeListener: jest.fn(),
    hasListener: jest.fn(() => true),
  };
  global.browser.downloads.onChanged = {
    addListener: jest.fn(),
    removeListener: jest.fn(),
    hasListener: jest.fn(() => true),
  };
  global.browser.downloads.show = jest.fn();
  global.browser.downloads.download = jest.fn();
  global.browser.notifications = {
    create: jest.fn(),
    clear: jest.fn(),
    onClicked: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
      hasListener: jest.fn(() => true),
    },
  };
};

describe("startup restore", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test("prunes downloads that completed while the worker was dead", async () => {
    const sessionStore = { siTrackedDownloads: [11, 12, 13] };
    setupGlobals(sessionStore, (query) => {
      if (query.id === 11) return [{ id: 11, state: "complete" }];
      if (query.id === 12) return [{ id: 12, state: "in_progress" }];
      return []; // 13 vanished entirely
    });

    await import("../src/notification.js");
    await flush();

    expect(sessionStore.siTrackedDownloads).toEqual([12]);
  });

  test("does not throw when storage.session is unavailable (older Firefox)", async () => {
    setupGlobals({}, () => []);
    global.browser.storage.session = undefined;

    await expect(import("../src/notification.js")).resolves.toBeDefined();
    await flush();
  });

  test("keeps the list untouched when every download is still live", async () => {
    const sessionStore = { siTrackedDownloads: [12] };
    setupGlobals(sessionStore, () => [{ id: 12, state: "in_progress" }]);

    await import("../src/notification.js");
    await flush();

    expect(sessionStore.siTrackedDownloads).toEqual([12]);
    expect(global.browser.storage.session.set).not.toHaveBeenCalled();
  });

  test("prunes downloads whose lookup fails", async () => {
    const sessionStore = { siTrackedDownloads: [21] };
    setupGlobals(sessionStore, () => []);
    global.browser.downloads.search = jest.fn(() => Promise.reject(new Error("boom")));

    await import("../src/notification.js");
    await flush();

    expect(sessionStore.siTrackedDownloads).toEqual([]);
  });
});

describe("track/untrack helpers", () => {
  let Notification;
  let sessionStore;

  beforeEach(async () => {
    jest.resetModules();
    sessionStore = {};
    setupGlobals(sessionStore, () => []);
    Notification = (await import("../src/notification.js")).default;
  });

  test("trackDownload appends without duplicating", async () => {
    await Notification.trackDownload(5);
    await Notification.trackDownload(6);
    await Notification.trackDownload(5);
    expect(sessionStore.siTrackedDownloads).toEqual([5, 6]);
  });

  test("untrackDownload removes only the given id", async () => {
    sessionStore.siTrackedDownloads = [5, 6];
    await Notification.untrackDownload(5);
    expect(sessionStore.siTrackedDownloads).toEqual([6]);
  });

  test("untrackDownload leaves unknown ids alone", async () => {
    await expect(Notification.untrackDownload(99)).resolves.toBeNull();
    expect(sessionStore.siTrackedDownloads).toBeUndefined();
  });

  test("trackDownload survives a failing storage read", async () => {
    global.browser.storage.session.get.mockRejectedValueOnce(new Error("gone"));
    await Notification.trackDownload(5);
    expect(sessionStore.siTrackedDownloads).toEqual([5]);
  });

  test("trackDownload survives a failing storage write", async () => {
    global.browser.storage.session.set.mockRejectedValueOnce(new Error("gone"));
    await expect(Notification.trackDownload(5)).resolves.toBeUndefined();
    expect(sessionStore.siTrackedDownloads).toBeUndefined();
  });

  test("trackDownload resolves without storage.session (older Firefox)", async () => {
    global.browser.storage.session = undefined;
    await expect(Notification.trackDownload(1)).resolves.toBeUndefined();
  });
});

describe("download lifecycle notifications", () => {
  let Notification;
  let sessionStore;
  let onCreated;
  let onChanged;

  beforeEach(async () => {
    jest.resetModules();
    jest.useFakeTimers();
    sessionStore = {};
    setupGlobals(sessionStore, () => [{ id: 7, fileSize: 2048, mime: "image/png" }]);

    global.options = {
      notifyOnSuccess: true,
      notifyOnFailure: true,
      notifyDuration: 1000,
      promptOnFailure: false,
    };
    Notification = (await import("../src/notification.js")).default;

    [[onCreated]] = global.browser.downloads.onCreated.addListener.mock.calls;
    [[onChanged]] = global.browser.downloads.onChanged.addListener.mock.calls;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("tracks a download recorded via the persisted pending flag", async () => {
    // requestedDownloadFlag (in-memory) was lost with the old worker;
    // the session flag written before downloads.download() takes over
    sessionStore.siPendingDownload = true;

    onCreated({ id: 7, filename: "C:\\dl\\pic.png", url: "https://x/p.png" });
    await flush();

    expect(sessionStore.siPendingDownload).toBe(false);
    expect(sessionStore.siTrackedDownloads).toEqual([7]);
  });

  test("notifies on completion and untracks", async () => {
    sessionStore.siPendingDownload = true;
    onCreated({ id: 7, filename: "C:\\dl\\pic.png", url: "https://x/p.png" });
    await flush();

    onChanged({
      id: 7,
      state: { current: "complete", previous: "in_progress" },
    });
    await flush();

    expect(global.browser.notifications.create).toHaveBeenCalledWith(
      "7",
      expect.objectContaining({ type: "basic" }),
    );
    expect(sessionStore.siTrackedDownloads).toEqual([]);
  });

  test("ignores downloads it did not initiate", async () => {
    onCreated({ id: 99, filename: "C:\\dl\\other.png" });
    await flush();

    onChanged({
      id: 99,
      state: { current: "complete", previous: "in_progress" },
    });
    await flush();

    expect(global.browser.notifications.create).not.toHaveBeenCalled();
    expect(sessionStore.siTrackedDownloads).toBeUndefined();
  });

  test("does not crash on failure deltas for entries missing a filename", async () => {
    sessionStore.siPendingDownload = true;
    onCreated({ id: 7, url: "https://x/p.png" }); // no filename yet
    await flush();

    expect(() => onChanged({ id: 7, error: { current: "NETWORK_FAILED" } })).not.toThrow();
    await flush();

    expect(global.browser.notifications.create).toHaveBeenCalled();
    expect(sessionStore.siTrackedDownloads).toEqual([]);
  });

  test("clicking a download notification opens its file", () => {
    const [[onClicked]] = global.browser.notifications.onClicked.addListener.mock.calls;

    onClicked("save-in-not-123"); // extension notifications are not downloads
    expect(global.browser.downloads.show).not.toHaveBeenCalled();

    onClicked("42");
    expect(global.browser.downloads.show).toHaveBeenCalledWith(42);
  });

  test("picks the filename up from Chrome's delta", async () => {
    sessionStore.siPendingDownload = true;
    onCreated({ id: 7, url: "https://x/p.png" }); // Chrome: no filename yet
    await flush();

    onChanged({ id: 7, filename: {} }); // delta without a current filename
    onChanged({ id: 7, filename: { current: "/dl/renamed.png" } });
    onChanged({ id: 7, state: { current: "complete", previous: "in_progress" } });
    await flush();

    expect(global.browser.notifications.create).toHaveBeenCalledWith(
      "7",
      expect.objectContaining({ message: "renamed.png" }),
    );
  });

  test("clears the success notification after notifyDuration", async () => {
    sessionStore.siPendingDownload = true;
    onCreated({ id: 7, filename: "/dl/pic.png", url: "https://x/p.png" });
    await flush();

    onChanged({ id: 7, state: { current: "complete", previous: "in_progress" } });
    await flush();

    expect(global.browser.notifications.clear).not.toHaveBeenCalled();
    jest.runAllTimers();
    expect(global.browser.notifications.clear).toHaveBeenCalledWith("7");
  });
});

describe("listener registration", () => {
  test("registers download and notification listeners at import (MV3 requirement)", async () => {
    jest.resetModules();
    setupGlobals({}, () => []);
    const Notification = (await import("../src/notification.js")).default;

    // Registered synchronously at module load with stable named handlers, so
    // a service worker woken BY one of these events still handles it
    expect(global.browser.downloads.onCreated.addListener).toHaveBeenCalledWith(
      Notification.onDownloadCreated,
    );
    expect(global.browser.downloads.onChanged.addListener).toHaveBeenCalledWith(
      Notification.onDownloadChanged,
    );
    expect(global.browser.notifications.onClicked.addListener).toHaveBeenCalledWith(
      Notification.onNotificationClicked,
    );
  });
});

describe("notification variants", () => {
  let sessionStore;
  let onCreated;
  let onChanged;

  const install = async (opts, searchResults = () => []) => {
    jest.resetModules();
    jest.useFakeTimers();
    sessionStore = {};
    setupGlobals(sessionStore, searchResults);
    global.options = opts;
    await import("../src/notification.js");
    [[onCreated]] = global.browser.downloads.onCreated.addListener.mock.calls;
    [[onChanged]] = global.browser.downloads.onChanged.addListener.mock.calls;
  };

  const startTracked = async (item) => {
    sessionStore.siPendingDownload = true;
    onCreated(item);
    await flush();
  };

  afterEach(() => {
    delete global.Log;
    jest.useRealTimers();
  });

  test("promptOnFailure re-prompts with saveAs", async () => {
    await install({ notifyOnFailure: false, promptOnFailure: true, notifyDuration: 1000 });
    await startTracked({ id: 7, filename: "/dl/pic.png", url: "https://x/p.png" });

    onChanged({ id: 7, error: { current: "NETWORK_FAILED" } });
    await flush();

    expect(global.browser.downloads.download).toHaveBeenCalledWith({
      url: "https://x/p.png",
      saveAs: true,
    });
    expect(global.browser.notifications.create).not.toHaveBeenCalled();
  });

  test("user-cancelled downloads are untracked without a notification", async () => {
    await install({ notifyOnSuccess: true, notifyOnFailure: true, notifyDuration: 1000 });
    await startTracked({ id: 7, filename: "/dl/pic.png", url: "https://x/p.png" });

    onChanged({ id: 7, error: { current: "USER_CANCELED" } });
    await flush();

    expect(global.browser.notifications.create).not.toHaveBeenCalled();
    expect(sessionStore.siTrackedDownloads).toEqual([]);
  });

  test("failures are logged when a Log global is present", async () => {
    await install({ notifyOnFailure: true, notifyDuration: 1000 });
    global.Log = { add: jest.fn() };
    await startTracked({ id: 7, filename: "/dl/pic.png", url: "https://x/p.png" });

    onChanged({ id: 7, error: { current: "NETWORK_FAILED" } });
    await flush();

    expect(global.Log.add).toHaveBeenCalledWith("download failed", {
      id: 7,
      error: "NETWORK_FAILED",
    });
  });

  test("Firefox interruptions fall back to a generic error message", async () => {
    await install({ notifyOnFailure: true, notifyDuration: 1000 });
    global.CURRENT_BROWSER = "FIREFOX";
    global.Log = { add: jest.fn() };
    await startTracked({ id: 7, filename: "/dl/pic.png", url: "https://x/p.png" });

    onChanged({ id: 7, state: { current: "interrupted", previous: "in_progress" } });
    await flush();

    expect(global.Log.add).toHaveBeenCalledWith("download failed", { id: 7, error: true });
    expect(global.browser.notifications.create).toHaveBeenCalledWith(
      "7",
      expect.objectContaining({ message: "Translated<genericUnknownError>" }),
    );
  });

  test("clears the failure notification after notifyDuration", async () => {
    await install({ notifyOnFailure: true, notifyDuration: 1000 });
    await startTracked({ id: 7, filename: "/dl/pic.png", url: "https://x/p.png" });

    onChanged({ id: 7, error: { current: "NETWORK_FAILED" } });
    await flush();

    expect(global.browser.notifications.clear).not.toHaveBeenCalled();
    jest.runAllTimers();
    expect(global.browser.notifications.clear).toHaveBeenCalledWith("7");
  });

  test("download id 0 never schedules a clear timer", async () => {
    await install({ notifyOnFailure: true, notifyDuration: 1000 });
    await startTracked({ id: 0, filename: "/dl/pic.png", url: "https://x/p.png" });

    onChanged({ id: 0, error: { current: "NETWORK_FAILED" } });
    await flush();

    expect(global.browser.notifications.create).toHaveBeenCalledWith("0", expect.anything());
    jest.runAllTimers();
    expect(global.browser.notifications.clear).not.toHaveBeenCalled();
  });

  test("successes are logged and show megabyte sizes", async () => {
    await install({ notifyOnSuccess: true, notifyDuration: 1000 }, () => [
      { id: 7, fileSize: 2500000, mime: "image/png" },
    ]);
    global.Log = { add: jest.fn() };
    await startTracked({ id: 7, filename: "/dl/pic.png", url: "https://x/p.png" });

    onChanged({ id: 7, state: { current: "complete", previous: "in_progress" } });
    await flush();

    expect(global.Log.add).toHaveBeenCalledWith("download complete", {
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

    onChanged({ id: 7, state: { current: "complete", previous: "in_progress" } });
    await flush();

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

    onChanged({ id: 7, state: { current: "complete", previous: "in_progress" } });
    await flush();

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

    onChanged({ id: 7, state: { current: "complete", previous: "in_progress" } });
    await flush();

    expect(global.browser.notifications.create).toHaveBeenCalledWith(
      "7",
      expect.objectContaining({ title: "Translated<notificationSuccessTitle>" }),
    );
  });

  test("notifyOnSuccess false suppresses the success notification", async () => {
    await install({ notifyOnSuccess: false, notifyOnFailure: true, notifyDuration: 1000 });
    await startTracked({ id: 7, filename: "/dl/pic.png", url: "https://x/p.png" });

    onChanged({ id: 7, state: { current: "complete", previous: "in_progress" } });
    await flush();

    expect(global.browser.notifications.create).not.toHaveBeenCalled();
    expect(sessionStore.siTrackedDownloads).toEqual([]);
  });

  test("debug mode logs listener decisions", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    window.SI_DEBUG = 1;
    try {
      // The "Bad notify duration" preamble died with addNotifications;
      // per-event debug logging remains
      await install({ notifyOnSuccess: true, notifyOnFailure: true });

      await startTracked({ id: 7, filename: "/dl/pic.png", url: "https://x/p.png" });
      onChanged({ id: 7, error: { current: "NETWORK_FAILED" } });
      await flush();

      await startTracked({ id: 8, filename: "/dl/pic2.png", url: "https://x/p2.png" });
      onChanged({ id: 8, state: { current: "complete", previous: "in_progress" } });
      await flush();

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

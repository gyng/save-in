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

    Notification = (await import("../src/notification.js")).default;
    Notification.addNotifications({
      notifyOnSuccess: true,
      notifyOnFailure: true,
      notifyDuration: 1000,
      promptOnFailure: false,
    });

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
});

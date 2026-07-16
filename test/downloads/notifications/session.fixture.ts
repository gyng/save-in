// storage.session download tracking: notifications must survive MV3 service
// worker restarts between download start and completion

// SessionState and DownloadState are the real modules under test (session
// persistence + record hydration/pruning); notification.ts is re-imported per
// test for its module-load side effects, and its other deps are imported real
// alongside it.
import { BackgroundState } from "../../../src/background/application-state.ts";

const downloadState = BackgroundState.downloads;

// chrome-detector now exports setCurrentBrowser, but this suite resetModules +
// re-imports notification.ts per test (re-binding a fresh chrome-detector each
// time), so a hoisted-holder getter stays the stable control point across the
// re-binds (BROWSERS is a plain constant). A couple of tests flip the holder.
const browserState = vi.hoisted(() => ({ current: "CHROME" }));
vi.mock("../../../src/platform/chrome-detector.ts", () => ({
  BROWSERS: { CHROME: "CHROME", FIREFOX: "FIREFOX", UNKNOWN: "UNKNOWN" },
  get CURRENT_BROWSER() {
    return browserState.current;
  },
  get WEB_EXTENSION_CAPABILITIES() {
    return {
      downloadDeltaFilename: browserState.current === "CHROME",
      // Mirrors production: the Undo button is Chrome-only enhancement
      notificationButtons: browserState.current === "CHROME",
    };
  },
}));

const retryHolder = vi.hoisted(() => ({
  retry: vi.fn((downloadId: any) => {
    void downloadId;
    return Promise.resolve(false);
  }),
}));
// notification.ts and its remaining deps (option, log) are re-imported after
// each resetModules; grab the fresh singletons the notifier binds to so the
// tests mutate/assert the same instances.
let Notifier: any;
let options: any;
let Log: any;
let SaveHistory: any;
let Runtime: any;

const loadNotification = async () => {
  const mod = await import("../../../src/downloads/notification.ts");
  const events = await import("../../../src/downloads/notification-events.ts");
  await mod.recoverNotificationState();
  // notification-events.ts holds onDownloadCreated/onDownloadChanged/
  // onNotificationClicked; merged onto the same Notifier facade the tests
  // already import from this fixture so call sites don't need to know which
  // file a given export physically lives in.
  Notifier = { ...mod, ...events };
  ({ options } = await import("../../../src/config/options-data.ts"));
  Log = await import("../../../src/background/log.ts");
  SaveHistory = await import("../../../src/background/history.ts");
  const { backgroundRuntime } = await import("../../../src/background/runtime.ts");
  Runtime = backgroundRuntime;
  const { configureDownloadPorts } = await import("../../../src/downloads/ports.ts");
  configureDownloadPorts({
    runtime: backgroundRuntime,
    history: {
      add: (...a: unknown[]) => SaveHistory.addHistoryEntry(...a),
      patch: (...a: unknown[]) => SaveHistory.patchHistoryEntry(...a),
      setDownloadId: (...a: unknown[]) => SaveHistory.setHistoryDownloadId(...a),
      setStatus: (...a: unknown[]) => SaveHistory.setHistoryStatus(...a),
      entries: () => SaveHistory.getHistoryEntries(),
      anchorStartTime: (...a: unknown[]) => SaveHistory.anchorHistoryDownloadStartTime(...a),
    },
    log: { add: (...args: unknown[]) => Log.addLogEntry(...args) },
    retry: (downloadId) => retryHolder.retry(downloadId),
    sourceSidecar: () => Promise.resolve(),
  });
  // Reset the real options bag to empty; each test sets the fields it needs
  for (const k of Object.keys(options)) delete options[k];
  // Log is defensive (typeof Log !== "undefined"); spy it so its calls are
  // assertable and it never writes to the session store
  vi.spyOn(Log, "addLogEntry").mockImplementation(() => Promise.resolve());
  // Mirror the entry's synchronous listener registration against the browser
  // stubs installed above.
  mod.registerNotifier();
  return Notifier;
};

const makeSessionMock = (store: Record<string, any>) => ({
  get: vi.fn((key: string) => Promise.resolve(key == null ? { ...store } : { [key]: store[key] })),
  set: vi.fn((obj: Record<string, any>) => {
    Object.assign(store, obj);
    return Promise.resolve();
  }),
  remove: vi.fn((keys: string | string[]) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
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
  (global.browser.downloads as any).search = vi.fn((query: any) =>
    Promise.resolve(searchResults(query)),
  );
  (global.browser.downloads as any).onCreated = {
    addListener: vi.fn(),
    removeListener: vi.fn(),
    hasListener: vi.fn(() => true),
  };
  (global.browser.downloads as any).onChanged = {
    addListener: vi.fn(),
    removeListener: vi.fn(),
    hasListener: vi.fn(() => true),
  };
  (global.browser.downloads as any).show = vi.fn();
  (global.browser.downloads as any).download = vi.fn();
  (global.browser.downloads as any).cancel = vi.fn(() => Promise.resolve());
  // Echo the queried id like a real browser erasing an existing item; undo
  // treats an empty erase result as failure, so [] would fail every test.
  (global.browser.downloads as any).erase = vi.fn((query: any) =>
    Promise.resolve(query?.id != null ? [query.id] : []),
  );
  (global.browser.downloads as any).removeFile = vi.fn(() => Promise.resolve());
  (global.browser as any).notifications = {
    create: vi.fn(),
    clear: vi.fn(),
    onClicked: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn(() => true),
    },
    // Chrome-only in production (Firefox has no notification buttons); present
    // here so registerNotifier's runtime probe finds and registers it.
    onButtonClicked: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn(() => true),
    },
  };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

export {
  downloadState,
  browserState,
  retryHolder,
  Notifier,
  options,
  Log,
  SaveHistory,
  Runtime,
  loadNotification,
  makeSessionMock,
  adoptedIds,
  setupGlobals,
};

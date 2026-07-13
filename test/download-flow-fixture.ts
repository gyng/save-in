// renameAndDownload end-to-end flow: Chrome vs Firefox entry points, prompt
// combinations, routing, the browserDownload/fetchDownload closures,
// notification triggers, and the onDeterminingFilename sync path.
//
// The MV3 data-URL fallbacks and the onDeterminingFilename async
// session-recovery path are covered by test/download-mv3.test.ts and are not
// duplicated here.

// DownloadState / OffscreenClient / SessionState / Log / SaveHistory are real
// shared singletons the test drives directly (these modules don't pull download.ts
// in, so importing them at the top can't force it to load early); the rest of
// download.ts's dependency graph is imported below, after the host globals are in
// place, so download.ts registers its onDeterminingFilename listener against them.
import { BackgroundState } from "../src/background/state.ts";
import * as SessionState from "../src/shared/session-state.ts";
import { OffscreenClient } from "../src/platform/offscreen-client.ts";
import { Log } from "../src/background/log.ts";
import { SaveHistory } from "../src/background/history.ts";
import { getFilenameFromContentDispositionHeader } from "../src/vendor/content-disposition.ts";
import { extensionSessionStorage } from "../src/platform/storage-areas.ts";
import { RULE_TYPES } from "../src/shared/constants.ts";
import type { RoutingRule, RuleClause } from "../src/routing/router.ts";
import { configureDownloadPorts } from "../src/downloads/ports.ts";
import { backgroundRuntime } from "../src/background/runtime.ts";

const downloadState = BackgroundState.downloads;
const routingRule = (name = "rule"): RoutingRule => {
  const clauses = [
    { name, value: /.*/, type: RULE_TYPES.MATCHER, matcher: () => null },
    { name: "into", value: "routed", type: RULE_TYPES.DESTINATION },
  ] satisfies RuleClause[];
  // This fixture supplies post-parse rules while the routing service itself is mocked.
  return clauses as RoutingRule;
};

// chrome-detector's CURRENT_BROWSER is a load-time-detected constant, but this
// suite flips it per test via the real setCurrentBrowser setter (grabbed below,
// after download.ts pulls chrome-detector into the module graph). download.ts
// reads CURRENT_BROWSER at call time, so the live-binding reassignment takes
// effect for the next handler call.

// content-disposition exports a bare function (not a method that can be spied),
// so the filename it returns is controlled through this mock.
vi.mock("../src/vendor/content-disposition.ts", () => ({
  getFilenameFromContentDispositionHeader: vi.fn(() => null),
}));

// storage.session-backed store the tests assert against; SessionState.update is
// spied to write here synchronously so assertions can inspect the store directly.
const sessionStore: Record<string, any> = {};

// download.ts registers its onDeterminingFilename listener and reads
// chrome.downloads at load, so the host globals must exist before it is imported.
global.chrome = {
  downloads: {
    onDeterminingFilename: { addListener: vi.fn() },
  },
} as any;
const hostBrowser = global.browser;
Object.assign(hostBrowser, {
  runtime: { id: "self-extension-id" },
  i18n: { getMessage: vi.fn((key: string) => key) },
  downloads: {
    download: vi.fn(() => Promise.resolve(101)),
    onChanged: { addListener: vi.fn() },
  },
} as any);

// Importing download.ts loads the rest of the (real) cyclic module graph;
// grab the same singleton instances it binds to.
const { Download, registerDownloadListener } = await import("../src/downloads/download.ts");
const { ActiveTransfers } = await import("../src/downloads/active-transfers.ts");
const { options } = await import("../src/config/options-data.ts");
const router = await import("../src/routing/router.ts");
const Variable = await import("../src/routing/variable.ts");
const { Notifier } = await import("../src/downloads/notification.ts");
const Path = await import("../src/routing/path.ts");
const { configureDownloadEvents } = await import("../src/downloads/download-events.ts");
let downloaded = vi.fn();
// download.ts already loaded chrome-detector into the graph; this is the same
// instance it reads CURRENT_BROWSER from. global.browser (above) has no
// getBrowserInfo, so its load-time detection settled on Chrome.
const { setCurrentBrowser: setDetectedBrowser } =
  await import("../src/platform/chrome-detector.ts");
const determiningFilenameEvent = (global.chrome as any).downloads.onDeterminingFilename;
const setCurrentBrowser = (browser: string) => {
  // Keep the test host capability surface consistent with the selected host.
  // Firefox exposes chrome.* callbacks, but not onDeterminingFilename.
  (global.chrome as any).downloads.onDeterminingFilename =
    browser === "FIREFOX" ? undefined : determiningFilenameEvent;
  setDetectedBrowser(browser);
};

// The entry owns listener registration, so attach it explicitly against the
// chrome.downloads stub before capturing it.
registerDownloadListener();
const [[capturedListener]] = vi.mocked(
  (global.chrome as any).downloads.onDeterminingFilename.addListener,
).mock.calls;
const [[capturedDownloadChangedListener]] = vi.mocked(
  (hostBrowser.downloads as any).onChanged.addListener,
).mock.calls;

const makeState = (overrides: Record<string, any> = {}): any => ({
  path: { finalize: () => "downloads" },
  scratch: {},
  ...overrides,
  info: {
    url: "https://example.com/dir/file.png",
    ...overrides.info,
  },
});

beforeEach(() => {
  configureDownloadPorts({
    runtime: backgroundRuntime,
    history: SaveHistory,
    log: Log,
    retry: Download.retryViaFetch,
  });
  setCurrentBrowser("FIREFOX");
  Download.pendingStates.clear();
  Download.finalFilenamesByDownloadId.clear();
  Download.generatedObjectUrls.clear();
  Download.ownedObjectUrls.clear();
  ActiveTransfers.clear();

  // Reset the real options bag to exactly the fields this suite controls
  for (const k of Object.keys(options)) Reflect.deleteProperty(options, k);
  Object.assign(options, {
    filenamePatterns: [],
    prompt: false,
    promptIfNoExtension: false,
    promptOnShift: false,
    routeFailurePrompt: false,
    routeExclusive: false,
    notifyOnRuleMatch: false,
    notifyOnFailure: false,
    conflictAction: "uniquify",
    fetchViaFetch: false,
    includeFetchCredentials: false,
    truncateLength: 240,
    // Off by default here; a dedicated suite exercises the MIME-append path
    appendMimeExtension: false,
  });

  // Path.Path is used real (its finalize is identity for these test routes);
  // only sanitizeFilename is controlled/asserted.
  vi.spyOn(Path, "sanitizeFilename").mockImplementation((name: any) => name);
  vi.spyOn(router, "matchRules").mockReturnValue(null);
  // applyVariables stays real (a never-asserted passthrough that leaves
  // a bufless path unchanged); resolveMime/mimeToExtension are spied per MIME test.

  vi.spyOn(Notifier, "createExtensionNotification").mockImplementation(() => {});
  vi.spyOn(Notifier, "reportFailure").mockImplementation(() => {});
  vi.spyOn(Notifier, "expectDownload").mockImplementation((url?: string) => ({ url }));

  for (const k of Object.keys(sessionStore)) delete sessionStore[k];
  vi.spyOn(SessionState, "setSession").mockImplementation((_storage: any, obj: any) => {
    Object.assign(sessionStore, obj);
    return Promise.resolve();
  });
  vi.spyOn(SessionState, "getSession").mockImplementation((_storage: any, key: any) =>
    Promise.resolve(key in sessionStore ? { [key]: sessionStore[key] } : {}),
  );
  vi.spyOn(SessionState, "updateSession").mockImplementation(
    (_writes: any, _storage: any, key: any, fn: any) => {
      sessionStore[key] = fn(sessionStore[key]);
      return Promise.resolve();
    },
  );

  // setDownloadId is never asserted; add returns a stable id so the started
  // record carries a truthy historyEntryId
  vi.spyOn(SaveHistory, "add").mockReturnValue("h-test");
  vi.spyOn(SaveHistory, "patch").mockImplementation(() => Promise.resolve());
  vi.spyOn(SaveHistory, "setDownloadId").mockImplementation(() => Promise.resolve());
  vi.spyOn(SaveHistory, "setStatus").mockImplementation(() => Promise.resolve());
  vi.spyOn(Log, "add").mockImplementation(() => Promise.resolve());

  // Reset the emit stub between tests (it is a mock-factory vi.fn, not a spy)
  downloaded = vi.fn();
  configureDownloadEvents({ downloaded });

  vi.mocked(getFilenameFromContentDispositionHeader).mockReset();
  vi.mocked(getFilenameFromContentDispositionHeader).mockReturnValue("");

  // getMessage is never asserted; it only needs to echo the key
  (global.browser.i18n as any).getMessage = (key: string) => key;
  (global.browser.downloads as any).download = vi.fn(() => Promise.resolve(101));

  global.fetch = vi.fn(() =>
    Promise.resolve({ headers: { has: () => false, get: () => null } }),
  ) as any;

  backgroundRuntime.debug = false;
  delete backgroundRuntime.lastDownloadState;
  downloadState.records.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Vitest does not reliably preserve re-exported imported bindings across this
// fixture's top-level-await boundary. Local aliases keep the shared singleton
// references intact for each focused suite.
const fixtureBackgroundRuntime = backgroundRuntime;
const fixtureExtensionSessionStorage = extensionSessionStorage;
const fixtureFilenameFromContentDisposition = getFilenameFromContentDispositionHeader;
const fixtureLog = Log;
const fixtureOffscreenClient = OffscreenClient;
const fixtureSaveHistory = SaveHistory;
const fixtureSessionState = SessionState;

export {
  ActiveTransfers,
  fixtureBackgroundRuntime as backgroundRuntime,
  capturedDownloadChangedListener,
  capturedListener,
  Download,
  downloaded,
  downloadState,
  fixtureExtensionSessionStorage as extensionSessionStorage,
  fixtureFilenameFromContentDisposition as getFilenameFromContentDispositionHeader,
  hostBrowser,
  fixtureLog as Log,
  makeState,
  Notifier,
  fixtureOffscreenClient as OffscreenClient,
  options,
  Path,
  router,
  routingRule,
  fixtureSaveHistory as SaveHistory,
  fixtureSessionState as SessionState,
  sessionStore,
  setCurrentBrowser,
  Variable,
};

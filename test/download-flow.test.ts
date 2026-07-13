// renameAndDownload end-to-end flow: Chrome vs Firefox entry points, prompt
// combinations, routing, the browserDownload/fetchDownload closures,
// notification triggers, and the onDeterminingFilename sync path.
//
// The MV3 data-URL fallbacks and the onDeterminingFilename async
// session-recovery path are covered by test/download-mv3.test.js and are not
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
import type { RoutingRule } from "../src/routing/router.ts";
import type { SaveInOptions } from "../src/config/option-schema.ts";
import { configureDownloadPorts } from "../src/downloads/ports.ts";
import { backgroundRuntime } from "../src/background/runtime.ts";

const downloadState = BackgroundState.downloads;
const routingRule = (name = "rule"): RoutingRule => [
  { name, value: ".*", type: RULE_TYPES.MATCHER },
];

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

// Import-time side effects are deferred (Task #2): download.ts no longer
// registers onDeterminingFilename at load — the entry does, so call it here to
// attach the listener against the chrome.downloads stub, then capture it.
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
  backgroundRuntime.lastDownloadState = undefined;
  downloadState.records.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pipeline stages", () => {
  test("marks saves from an incognito tab as private at the history boundary", () => {
    const state = makeState({ info: { currentTab: { incognito: true } } });

    Download.createDownloadPlan(state);

    expect(SaveHistory.add).toHaveBeenCalledWith(expect.any(Object), {
      privateContext: true,
    });
  });

  test("runs RESOLVE, ACQUIRE, and DOWNLOAD in order with explicit values", async () => {
    const calls: string[] = [];
    const state = makeState();
    const plan = {
      state,
      finalFullPath: "downloads/file.png",
      prompt: false,
      historyEntryId: "h-test",
    };
    const acquired = {
      url: "blob:resolved",
      source: "fetched" as const,
      ownedObjectUrl: "blob:resolved",
    };

    vi.spyOn(Download, "resolveDownloadPlan").mockImplementation(async () => {
      calls.push("resolve");
      return plan;
    });
    vi.spyOn(Download, "acquireDownloadUrl").mockImplementation(async (received) => {
      calls.push("acquire");
      expect(received).toBe(plan);
      return acquired;
    });
    vi.spyOn(Download, "executeBrowserDownload").mockImplementation(
      async (receivedPlan, receivedAcquired) => {
        calls.push("download");
        expect(receivedPlan).toBe(plan);
        expect(receivedAcquired).toBe(acquired);
        return { status: "started", downloadId: 101 };
      },
    );

    await Download.renameAndDownload(state);

    expect(calls).toEqual(["resolve", "acquire", "download"]);
  });

  test("reports and cleans up a rejected acquisition", async () => {
    const state = makeState({
      info: { contentPromise: Promise.reject(new Error("content unavailable")) },
    });

    const result = await Download.renameAndDownload(state);

    expect(result).toEqual({ status: "failed" });
    expect(global.browser.downloads.download).not.toHaveBeenCalled();
    expect(Download.pendingStates.get(state.info.url) || []).not.toContain(state);
    expect(SaveHistory.setStatus).toHaveBeenCalledWith("h-test", "DOWNLOAD_PREPARATION_FAILED");
    expect(Notifier.reportFailure).toHaveBeenCalledWith(
      "downloads/file.png",
      expect.stringContaining("content unavailable"),
    );
  });

  test("does not fetch-retry a Firefox download after attaching Referer", async () => {
    setCurrentBrowser("FIREFOX");
    options.setRefererHeader = true;
    options.setRefererHeaderFilter = "*://example.com/*";
    options.fallbackFetch = true;
    const state = makeState({ info: { pageUrl: "https://gallery.example/view" } });
    vi.mocked(global.browser.downloads.download).mockRejectedValueOnce(new Error("network"));
    const fetchSpy = vi.mocked(global.fetch);

    const result = await Download.renameAndDownload(state);

    expect(result).toEqual({ status: "failed" });
    expect(fetchSpy).not.toHaveBeenCalledWith(state.info.url, { credentials: "include" });
  });

  test("preserves Firefox Referer when extension fetch falls back to the original URL", async () => {
    setCurrentBrowser("FIREFOX");
    options.setRefererHeader = true;
    options.setRefererHeaderFilter = "*://example.com/*";
    options.fetchViaFetch = true;
    const state = makeState({ info: { pageUrl: "https://gallery.example/view" } });
    global.fetch = vi.fn((url, init) => {
      if ((init as RequestInit | undefined)?.method === "HEAD") {
        return Promise.resolve({ headers: { has: () => false, get: () => null } });
      }
      return Promise.reject(new Error(`fetch blocked: ${url}`));
    }) as any;

    const result = await Download.renameAndDownload(state);

    expect(result).toEqual({ status: "started", downloadId: 101 });
    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({
        url: state.info.url,
        headers: [{ name: "Referer", value: "https://gallery.example/view" }],
      }),
    );
    expect(downloadState.records.get(101)?.allowOriginalUrlFallback).toBe(false);
  });

  test("correlates fetched URLs with Chrome's filename event", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState({ info: { suggestedFilename: "fetched.png" } });
    Download.rememberPendingState(state);
    const plan = {
      state,
      finalFullPath: "downloads/fetched.png",
      prompt: false,
      historyEntryId: "h-test",
    };

    await Download.executeBrowserDownload(plan, {
      url: "blob:fetched-file",
      source: "fetched",
    });

    expect(SaveHistory.patch).toHaveBeenCalledWith("h-test", {
      mechanism: "fetch-downloads-api",
    });

    expect(Download.pendingStates.get(state.info.url)).toBeUndefined();
    expect(Download.pendingStates.get("blob:fetched-file")).toEqual([state]);

    const suggest = vi.fn();
    capturedListener(
      {
        byExtensionId: global.browser.runtime.id,
        url: "blob:fetched-file",
        filename: "file",
      },
      suggest,
    );
    expect(suggest).toHaveBeenCalledWith({
      filename: "downloads/fetched.png",
      conflictAction: "uniquify",
    });
  });
});

describe("getFilenameFromContentDisposition", () => {
  test("returns null for non-string input", () => {
    expect(Download.getFilenameFromContentDisposition(undefined)).toBe(null);
    expect(Download.getFilenameFromContentDisposition(123)).toBe(null);
    expect(Download.getFilenameFromContentDisposition(null)).toBe(null);
  });

  test("double-decodes the value returned by the library", () => {
    // "na me.txt" URI-encoded twice
    vi.mocked(getFilenameFromContentDispositionHeader).mockReturnValue("na%2520me.txt");
    expect(Download.getFilenameFromContentDisposition("attachment; filename=whatever")).toBe(
      "na me.txt",
    );
  });

  test("keeps filenames with a literal % that is not an escape", () => {
    vi.mocked(getFilenameFromContentDispositionHeader).mockReturnValue("50%.txt");
    expect(Download.getFilenameFromContentDisposition("attachment; filename=whatever")).toBe(
      "50%.txt",
    );
  });

  test("stops decoding when a second pass would fail", () => {
    // one valid decode, then the result is no longer a valid escape sequence
    vi.mocked(getFilenameFromContentDispositionHeader).mockReturnValue("%2550%25.txt");
    expect(Download.getFilenameFromContentDisposition("attachment; filename=whatever")).toBe(
      "%50%.txt",
    );
  });

  test("returns null when the library returns a falsy value", () => {
    vi.mocked(getFilenameFromContentDispositionHeader).mockReturnValue(null as any);
    expect(Download.getFilenameFromContentDisposition("attachment")).toBe(null);

    vi.mocked(getFilenameFromContentDispositionHeader).mockReturnValue("");
    expect(Download.getFilenameFromContentDisposition("attachment")).toBe(null);
  });
});

describe("getRoutingMatches", () => {
  test("returns null when there are no filename patterns", () => {
    (options as Partial<SaveInOptions>).filenamePatterns = undefined;
    expect(Download.getRoutingMatches({ info: {} })).toBe(null);

    options.filenamePatterns = [];
    expect(Download.getRoutingMatches({ info: {} })).toBe(null);

    expect(router.matchRules).not.toHaveBeenCalled();
  });

  test("delegates to matchRules when patterns exist", () => {
    options.filenamePatterns = [routingRule()];
    vi.mocked(router.matchRules).mockReturnValue("the/route");
    const state = { info: { url: "x" } };

    expect(Download.getRoutingMatches(state)).toBe("the/route");
    expect(router.matchRules).toHaveBeenCalledWith(options.filenamePatterns, state.info);
  });
});

describe("finalizeFullPath", () => {
  test("strips a leading ./ and uses the sanitized filename when there is no route", () => {
    vi.mocked(Path.sanitizeFilename).mockReturnValue("sanitized.txt");
    const state = {
      path: { finalize: () => "./some/dir" },
      info: { filename: "raw.txt" },
    };

    expect(Download.finalizeFullPath(state)).toBe("some/dir/sanitized.txt");
    expect(Path.sanitizeFilename).toHaveBeenCalledWith("raw.txt");
  });

  test("strips a leading / and prefers the route's finalized filename", () => {
    const state = {
      path: { finalize: () => "/abs/dir" },
      route: { finalize: () => "route-file.txt" },
      info: { filename: "raw.txt" },
    };

    expect(Download.finalizeFullPath(state)).toBe("abs/dir/route-file.txt");
  });
});

describe("renameAndDownload: MIME extension append (§8.1)", () => {
  test("appends the Content-Type extension to an extensionless filename", async () => {
    setCurrentBrowser("CHROME");
    options.appendMimeExtension = true;
    vi.spyOn(Variable, "resolveMime").mockResolvedValue("image/jpeg");
    vi.spyOn(Variable, "mimeToExtension").mockImplementation((mime: any) =>
      mime === "image/jpeg" ? "jpg" : "",
    );

    const state = makeState({ info: { url: "https://cdn.example.com/img/12345" } });
    await Download.renameAndDownload(state);

    expect(Variable.resolveMime).toHaveBeenCalledWith(state.info);
    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ filename: expect.stringMatching(/12345\.jpg$/) }),
    );
  });

  test("skips the HEAD and leaves a filename that already has an extension", async () => {
    setCurrentBrowser("CHROME");
    options.appendMimeExtension = true;
    vi.spyOn(Variable, "resolveMime").mockResolvedValue("image/jpeg");
    vi.spyOn(Variable, "mimeToExtension").mockReturnValue("jpg");

    const state = makeState({ info: { url: "https://cdn.example.com/img/photo.png" } });
    await Download.renameAndDownload(state);

    expect(Variable.resolveMime).not.toHaveBeenCalled();
    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ filename: expect.stringMatching(/photo\.png$/) }),
    );
  });
});

describe("renameAndDownload: shared :sha256: fetch reuse", () => {
  test("reuses the already-fetched download URL instead of fetching the file again", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState({
      info: {
        contentPromise: Promise.resolve({
          downloadUrl: "data:application/octet-stream;base64,eA==",
        }),
      },
    });

    await Download.renameAndDownload(state);

    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ url: "data:application/octet-stream;base64,eA==" }),
    );
  });

  test("falls back to the normal download when the shared fetch failed (null content)", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState({ info: { contentPromise: Promise.resolve(null) } });

    await Download.renameAndDownload(state);

    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ url: state.info.url }),
    );
  });
});

describe("renameAndDownload: folder-only route (§8.1)", () => {
  test("a trailing-slash into: routes into the folder and keeps the real filename", async () => {
    setCurrentBrowser("CHROME");
    options.filenamePatterns = [routingRule()];
    vi.mocked(router.matchRules).mockReturnValue("pdfs/");

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(state.routeIsFolder).toBe(true);
    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "downloads/pdfs/file.png" }),
    );
  });

  test("a route without a trailing slash sets the whole name (unchanged)", async () => {
    setCurrentBrowser("CHROME");
    options.filenamePatterns = [routingRule()];
    vi.mocked(router.matchRules).mockReturnValue("renamed.png");

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(state.routeIsFolder).toBe(false);
    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "downloads/renamed.png" }),
    );
  });
});

describe("renameAndDownload: Chrome vs Firefox entry", () => {
  test("Chrome path skips the HEAD request and downloads immediately", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState();

    await Download.renameAndDownload(state);
    expect(global.fetch).not.toHaveBeenCalled();

    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ url: state.info.url }),
    );
  });

  test("Firefox path performs a HEAD request and applies the Content-Disposition filename", async () => {
    setCurrentBrowser("FIREFOX");
    vi.mocked(getFilenameFromContentDispositionHeader).mockReturnValue("server-name.pdf");
    global.fetch = vi.fn(() =>
      Promise.resolve({
        headers: { has: () => true, get: () => 'attachment; filename="server-name.pdf"' },
      }),
    ) as any;

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(global.fetch).toHaveBeenCalledWith(
      state.info.url,
      expect.objectContaining({
        method: "HEAD",
        credentials: "omit",
        redirect: "follow",
      }),
    );

    expect(state.info.filename).toBe("server-name.pdf");
    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ filename: expect.stringContaining("server-name.pdf") }),
    );
  });

  test("Firefox matches filename rules after resolving Content-Disposition", async () => {
    setCurrentBrowser("FIREFOX");
    options.filenamePatterns = [routingRule()];
    vi.mocked(getFilenameFromContentDispositionHeader).mockReturnValue("server-name.pdf");
    global.fetch = vi.fn(() =>
      Promise.resolve({
        headers: { has: () => true, get: () => 'attachment; filename="server-name.pdf"' },
      }),
    ) as any;
    vi.mocked(router.matchRules).mockImplementation((_rules, info) =>
      info.filename === "server-name.pdf" ? "pdf/:filename:" : null,
    );

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(router.matchRules).toHaveBeenCalledWith(options.filenamePatterns, state.info);
    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "downloads/pdf/server-name.pdf" }),
    );
  });

  test("Firefox path keeps the original filename when the Content-Disposition has no usable name", async () => {
    setCurrentBrowser("FIREFOX");
    vi.mocked(getFilenameFromContentDispositionHeader).mockReturnValue(null as any);
    global.fetch = vi.fn(() =>
      Promise.resolve({ headers: { has: () => true, get: () => "attachment" } }),
    ) as any;

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(state.info.filename).toBe("file.png");
    expect(global.browser.downloads.download).toHaveBeenCalled();
  });

  test("Firefox path keeps the original filename when Content-Disposition is absent", async () => {
    setCurrentBrowser("FIREFOX");
    global.fetch = vi.fn(() =>
      Promise.resolve({ headers: { has: () => false, get: () => null } }),
    ) as any;

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(state.info.filename).toBe("file.png");
    expect(getFilenameFromContentDispositionHeader).not.toHaveBeenCalled();
    expect(global.browser.downloads.download).toHaveBeenCalled();
  });

  test("Firefox path downloads anyway when the HEAD request rejects", async () => {
    setCurrentBrowser("FIREFOX");
    global.fetch = vi.fn(() => Promise.reject(new Error("network down"))) as any;

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(global.browser.downloads.download).toHaveBeenCalled();
  });
});

describe("renameAndDownload: initial filename resolution", () => {
  test("rejects a state without a download URL", async () => {
    await expect(
      Download.renameAndDownload(makeState({ info: { url: undefined } })),
    ).rejects.toThrow("Download URL is required");
  });

  test("prefers info.suggestedFilename over the URL-derived filename", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState({ info: { suggestedFilename: "suggested.txt" } });

    await Download.renameAndDownload(state);

    expect(state.info.naiveFilename).toBe("file.png");
    expect(state.info.initialFilename).toBe("suggested.txt");
    expect(state.info.filename).toBe("suggested.txt");
  });

  test("falls back to the full URL when the URL has no filename component", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState({ info: { url: "https://example.com/" } });

    await Download.renameAndDownload(state);

    expect(state.info.naiveFilename).toBe("");
    expect(state.info.initialFilename).toBe("https://example.com/");
  });
});

describe("renameAndDownload: needRouteMatch", () => {
  test("returns early without downloading when no route matched", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState({ needRouteMatch: true });

    await Download.renameAndDownload(state);

    expect(global.browser.downloads.download).not.toHaveBeenCalled();
    expect(downloaded).not.toHaveBeenCalled();
    expect(SaveHistory.add).not.toHaveBeenCalled();
    expect(Download.pendingStates.get(state.info.url) || []).not.toContain(state);
  });

  test("revokes content acquired during planning when route-exclusive skips", async () => {
    setCurrentBrowser("CHROME");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const state = makeState({
      needRouteMatch: true,
      info: {
        contentPromise: Promise.resolve({
          sha256: "hash",
          downloadUrl: "blob:unused-content",
          ownedObjectUrl: "blob:unused-content",
        }),
      },
    });

    await expect(Download.renameAndDownload(state)).resolves.toEqual({ status: "skipped" });

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:unused-content");
    expect(state.info.contentPromise).toBeUndefined();
  });

  test("cleans pending state and generated URLs when planning throws", async () => {
    setCurrentBrowser("CHROME");
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:abandoned-plan");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const url = Download.makeObjectUrl("content");
    const state = makeState({ info: { url } });
    vi.spyOn(Variable, "applyVariables").mockRejectedValueOnce(new Error("bad variable"));

    await expect(Download.renameAndDownload(state)).rejects.toThrow("bad variable");

    expect(Download.pendingStates.get(url) || []).not.toContain(state);
    expect(Download.generatedObjectUrls.has(url)).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
  });

  test("revokes content acquired during planning when planning throws", async () => {
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const state = makeState({
      info: {
        contentPromise: Promise.resolve({
          sha256: "hash",
          downloadUrl: "blob:abandoned-content",
          ownedObjectUrl: "blob:abandoned-content",
        }),
      },
    });
    vi.spyOn(Variable, "applyVariables").mockRejectedValueOnce(new Error("bad variable"));

    await expect(Download.renameAndDownload(state)).rejects.toThrow("bad variable");

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:abandoned-content");
    expect(state.info.contentPromise).toBeUndefined();
  });

  test("proceeds when needRouteMatch is true and a route matched", async () => {
    setCurrentBrowser("CHROME");
    options.filenamePatterns = [routingRule()];
    vi.mocked(router.matchRules).mockReturnValue("matched/route.txt");

    const state = makeState({ needRouteMatch: true });
    await Download.renameAndDownload(state);

    expect(global.browser.downloads.download).toHaveBeenCalled();
  });

  test("proceeds when needRouteMatch is false even without a route", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState({ needRouteMatch: false });

    await Download.renameAndDownload(state);

    expect(global.browser.downloads.download).toHaveBeenCalled();
  });
});

describe("renameAndDownload: route matching", () => {
  test("builds state.route from matchRules and uses it in the final path", async () => {
    setCurrentBrowser("CHROME");
    options.filenamePatterns = [routingRule()];
    vi.mocked(router.matchRules).mockReturnValue("matched/route.txt");

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(router.matchRules).toHaveBeenCalledWith(options.filenamePatterns, state.info);
    expect(state.route).toBeDefined();
    expect(String(state.route.finalize())).toBe("matched/route.txt");

    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ filename: expect.stringContaining("matched/route.txt") }),
    );
  });
});

describe("renameAndDownload: prompt combinations", () => {
  const expectSaveAs = async (state: any, expected: boolean) => {
    await Download.renameAndDownload(state);
    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ saveAs: expected }),
    );
  };

  test("options.prompt forces saveAs", async () => {
    setCurrentBrowser("CHROME");
    options.prompt = true;
    await expectSaveAs(makeState(), true);
  });

  test("promptIfNoExtension prompts when the final filename has no extension", async () => {
    setCurrentBrowser("CHROME");
    options.promptIfNoExtension = true;
    const state = makeState({ info: { url: "https://example.com/dir/noext" } });
    await expectSaveAs(state, true);
  });

  test("promptOnShift prompts when the Shift modifier was held", async () => {
    setCurrentBrowser("CHROME");
    options.promptOnShift = true;
    const state = makeState({ info: { modifiers: ["Shift"] } });
    await expectSaveAs(state, true);
  });

  test("routeFailurePrompt prompts when no rule matched", async () => {
    setCurrentBrowser("CHROME");
    options.routeFailurePrompt = true;
    await expectSaveAs(makeState(), true);
  });

  test("saveAs is falsy when no prompt condition is met", async () => {
    setCurrentBrowser("CHROME");
    await expectSaveAs(makeState(), false);
  });
});

describe("renameAndDownload: browserDownload", () => {
  test("passes Firefox private context without a conflicting cookie store", async () => {
    setCurrentBrowser("FIREFOX");
    const state = makeState({
      info: { currentTab: { incognito: true, cookieStoreId: "firefox-private" } },
    });

    await Download.renameAndDownload(state);

    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({
        url: state.info.url,
        incognito: true,
      }),
    );
    const [downloadOptions] = vi.mocked(global.browser.downloads.download).mock.calls[0]!;
    expect(downloadOptions).not.toHaveProperty("cookieStoreId");
  });

  test("persists session state, downloads, and tracks the result", async () => {
    setCurrentBrowser("CHROME");
    (global.browser.downloads as any).download = vi.fn(() => Promise.resolve(555));

    const state = makeState();
    await Download.renameAndDownload(state);

    // pending counter + per-URL filename map are updated (see the session-
    // restart recovery tests for the values)
    expect(SessionState.updateSession).toHaveBeenCalledWith(
      expect.anything(),
      extensionSessionStorage,
      "siPendingDownloads",
      expect.any(Function),
    );
    expect(SessionState.updateSession).toHaveBeenCalledWith(
      expect.anything(),
      extensionSessionStorage,
      "siFinalFilenames",
      expect.any(Function),
    );
    expect(global.browser.downloads.download).toHaveBeenCalledWith({
      url: state.info.url,
      filename: expect.any(String),
      saveAs: false,
      conflictAction: "uniquify",
    });
    // download.js adopts its own download (the record is what the notifier
    // watches for a completion toast)
    expect(downloadState.records.get(555)).toMatchObject({ adopted: true });
    // incremented then cleared -> back to 0, and the filename key removed
    await vi.waitFor(() => expect(sessionStore.siPendingDownloads).toBe(0));
    expect(sessionStore.siFinalFilenames).toEqual({});
  });

  test("logs a downloads.download rejection and still clears the pending flag", async () => {
    setCurrentBrowser("CHROME");
    (global.browser.downloads as any).download = vi.fn(() =>
      Promise.reject(new Error("disk full")),
    );

    const state = makeState();
    await Download.renameAndDownload(state);

    // a fully failed download registers no adopted record
    expect([...downloadState.records.values()].some((r: any) => r.adopted)).toBe(false);
    expect(Log.add).toHaveBeenCalledWith("downloads.download failed", "Error: disk full");
    await vi.waitFor(() => expect(sessionStore.siPendingDownloads).toBe(0));
  });

  test("a downloads.download rejection does not throw and clears the pending flag", async () => {
    setCurrentBrowser("CHROME");
    (global.browser.downloads as any).download = vi.fn(() =>
      Promise.reject(new Error("disk full")),
    );

    const state = makeState();
    await expect(Download.renameAndDownload(state)).resolves.toEqual({ status: "failed" });

    expect([...downloadState.records.values()].some((r: any) => r.adopted)).toBe(false);
    await vi.waitFor(() => expect(sessionStore.siPendingDownloads).toBe(0));
    expect([...Download.pendingStates.values()].flat()).not.toContain(state);
  });

  test("does not fetch-retry a generated object URL after browser rejection", async () => {
    setCurrentBrowser("FIREFOX");
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:generated-download");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const url = Download.makeObjectUrl("generated content");
    const state = makeState({ info: { url, suggestedFilename: "generated.txt" } });
    vi.mocked(global.browser.downloads.download).mockRejectedValueOnce(new Error("disk full"));
    const fetchSpy = vi.mocked(global.fetch);

    await expect(Download.renameAndDownload(state)).resolves.toEqual({ status: "failed" });

    expect(global.browser.downloads.download).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalledWith(url, { credentials: "include" });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
  });

  test("substitutes _ for an empty final path", async () => {
    setCurrentBrowser("CHROME");
    vi.mocked(Path.sanitizeFilename).mockReturnValue(null as any);

    const state = makeState({ path: { finalize: () => null } });
    await Download.renameAndDownload(state);

    // the filename-map update stores "_" for this download's URL
    const fnameUpdate = vi
      .mocked(SessionState.updateSession)
      .mock.calls.find((c: any) => c[2] === "siFinalFilenames");
    expect(fnameUpdate![3]({})).toEqual({ [state.info.url]: "_" });
    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "_" }),
    );
  });

  test("emits downloaded, records lastDownloadState, and saves history", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState();

    await Download.renameAndDownload(state);

    expect(downloaded).toHaveBeenCalledWith(state);
    expect(backgroundRuntime.lastDownloadState).toBe(state);
    expect(SaveHistory.add).toHaveBeenCalledWith(
      expect.objectContaining({
        url: state.info.url,
        routed: false,
        initiatedAt: state.info.now?.toISOString(),
        info: expect.objectContaining({ sourceUrl: state.info.sourceUrl }),
        variables: expect.objectContaining({
          filename: "file.png",
          initialfilename: "file.png",
        }),
      }),
      { privateContext: false },
    );
  });
});

describe("renameAndDownload: fetchViaFetch", () => {
  test("keeps a fetched blob associated with Firefox private downloads", async () => {
    setCurrentBrowser("FIREFOX");
    options.fetchViaFetch = true;
    global.fetch = vi.fn(() =>
      Promise.resolve({ blob: () => Promise.resolve(new Blob(["file contents"])) }),
    ) as any;
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fetched-content");

    const state = makeState({
      info: { currentTab: { incognito: true, cookieStoreId: "firefox-private" } },
    });
    await Download.renameAndDownload(state);

    const [downloadOptions] = vi.mocked(global.browser.downloads.download).mock.calls[0]!;
    expect(downloadOptions).toHaveProperty("incognito", true);
    expect(downloadOptions).not.toHaveProperty("cookieStoreId");
  });

  test("fetches the URL, converts the blob to an object URL, then downloads it", async () => {
    setCurrentBrowser("CHROME");
    options.fetchViaFetch = true;
    global.fetch = vi.fn(() =>
      Promise.resolve({ blob: () => Promise.resolve(new Blob(["file contents"])) }),
    ) as any;
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fetched-content");

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(global.fetch).toHaveBeenCalledWith(
      state.info.url,
      expect.objectContaining({ credentials: "omit", redirect: "follow" }),
    );
    expect(Log.add).not.toHaveBeenCalledWith("fetch download failed", expect.anything());
    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringMatching(/^blob:/) }),
    );
  });

  test("Chrome offscreen: fetches via the offscreen document and downloads the blob URL", async () => {
    setCurrentBrowser("CHROME");
    options.fetchViaFetch = true;
    const origCanUse = OffscreenClient.canUse;
    const origFetch = OffscreenClient.fetch;
    OffscreenClient.canUse = vi.fn(() => true);
    OffscreenClient.fetch = vi.fn(() => Promise.resolve("blob:offscreen-url"));
    try {
      const state = makeState();
      await Download.renameAndDownload(state);

      expect(OffscreenClient.fetch).toHaveBeenCalledWith(state.info.url, "omit");
      expect(global.browser.downloads.download).toHaveBeenCalledWith(
        expect.objectContaining({ url: "blob:offscreen-url" }),
      );
    } finally {
      OffscreenClient.canUse = origCanUse;
      OffscreenClient.fetch = origFetch;
    }
  });

  test("Chrome offscreen: falls back to a direct download when the offscreen fetch fails", async () => {
    setCurrentBrowser("CHROME");
    options.fetchViaFetch = true;
    const origCanUse = OffscreenClient.canUse;
    const origFetch = OffscreenClient.fetch;
    OffscreenClient.canUse = vi.fn(() => true);
    OffscreenClient.fetch = vi.fn(() => Promise.reject(new Error("offscreen boom")));
    try {
      const state = makeState();
      await Download.renameAndDownload(state);

      expect(Log.add).toHaveBeenCalledWith(
        "offscreen fetch failed",
        expect.stringContaining("offscreen boom"),
      );
      expect(global.browser.downloads.download).toHaveBeenCalledWith(
        expect.objectContaining({ url: state.info.url }),
      );
    } finally {
      OffscreenClient.canUse = origCanUse;
      OffscreenClient.fetch = origFetch;
    }
  });
});

describe("renameAndDownload: notification triggers", () => {
  test("notifies on rule match when a route was found and notifyOnRuleMatch is enabled", async () => {
    setCurrentBrowser("CHROME");
    options.filenamePatterns = [routingRule()];
    vi.mocked(router.matchRules).mockReturnValue("matched/route.txt");
    options.notifyOnRuleMatch = true;

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(Notifier.createExtensionNotification).toHaveBeenCalledWith(
      "notificationRuleMatchedTitle",
      "file.png\n⬇\nmatched/route.txt",
      false,
      "route-match",
    );
  });

  test("does not notify on rule match when notifyOnRuleMatch is disabled", async () => {
    setCurrentBrowser("CHROME");
    options.filenamePatterns = [routingRule()];
    vi.mocked(router.matchRules).mockReturnValue("matched/route.txt");
    options.notifyOnRuleMatch = false;

    await Download.renameAndDownload(makeState());
    expect(Notifier.createExtensionNotification).not.toHaveBeenCalled();
  });

  test("notifies failure when routeExclusive+notifyOnFailure are enabled and no route matched", async () => {
    setCurrentBrowser("CHROME");
    options.routeExclusive = true;
    options.notifyOnFailure = true;

    const state = makeState();
    await expect(Download.renameAndDownload(state)).resolves.toEqual({ status: "skipped" });

    expect(Notifier.createExtensionNotification).toHaveBeenCalledWith(
      "notificationRuleMatchFailedExclusiveTitle",
      "notificationRuleMatchFailedExclusiveMessage",
      true,
      "route-miss",
    );
    expect(global.browser.downloads.download).not.toHaveBeenCalled();
  });

  test("does not notify failure when routeExclusive is disabled", async () => {
    setCurrentBrowser("CHROME");
    options.routeExclusive = false;
    options.notifyOnFailure = true;

    await Download.renameAndDownload(makeState());
    expect(Notifier.createExtensionNotification).not.toHaveBeenCalled();
  });
});

describe("renameAndDownload: Log integration", () => {
  test("logs 'download requested' when Log is defined", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState();

    await Download.renameAndDownload(state);

    expect(Log.add).toHaveBeenCalledWith(
      "download requested",
      expect.objectContaining({ url: expect.any(String), path: expect.any(String), route: null }),
    );
  });

  test("does not throw when the download pipeline runs", async () => {
    setCurrentBrowser("CHROME");

    const state = makeState();
    await expect(Download.renameAndDownload(state)).resolves.toEqual({
      status: "started",
      downloadId: 101,
    });

    expect(global.browser.downloads.download).toHaveBeenCalled();
  });
});

describe("renameAndDownload: backgroundRuntime.debug", () => {
  test("logs debug info when backgroundRuntime.debug is set", async () => {
    setCurrentBrowser("CHROME");
    backgroundRuntime.debug = true;
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await Download.renameAndDownload(makeState());

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
    backgroundRuntime.debug = false;
  });
});

describe("onDeterminingFilename listener: sync path", () => {
  test("suggests the finalized path from the URL-correlated state", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState();

    await Download.renameAndDownload(state);

    const suggest = vi.fn();
    const returned = capturedListener(
      {
        byExtensionId: global.browser.runtime.id,
        url: state.info.url,
        filename: "from-download-item.bin",
      },
      suggest,
    );

    expect(returned).toBe(false);
    expect(suggest).toHaveBeenCalledWith({
      filename: Download.finalizeFullPath(state),
      conflictAction: options.conflictAction,
    });
  });

  test("prefers the state's suggestedFilename over the download item's filename", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState({ info: { suggestedFilename: "suggested.txt" } });

    await Download.renameAndDownload(state);

    const suggest = vi.fn();
    capturedListener(
      {
        byExtensionId: global.browser.runtime.id,
        url: state.info.url,
        filename: "from-download-item.bin",
      },
      suggest,
    );

    expect(suggest).toHaveBeenCalledWith({
      filename: "downloads/suggested.txt",
      conflictAction: "uniquify",
    });
  });

  test("reevaluates filename rules with Chrome's actual filename", async () => {
    setCurrentBrowser("CHROME");
    options.filenamePatterns = [routingRule()];
    vi.mocked(router.matchRules).mockImplementation((_rules, info) =>
      info.filename === "server-name.pdf" ? "pdf/:filename:" : null,
    );
    const state = makeState({ path: new Path.Path("downloads") });
    await Download.renameAndDownload(state);

    const suggest = vi.fn();
    const returned = capturedListener(
      {
        id: 101,
        byExtensionId: global.browser.runtime.id,
        url: state.info.url,
        filename: "server-name.pdf",
      },
      suggest,
    );
    expect(returned).toBe(true);
    await vi.waitFor(() =>
      expect(suggest).toHaveBeenCalledWith(
        expect.objectContaining({ filename: "downloads/pdf/server-name.pdf" }),
      ),
    );
    await vi.waitFor(() =>
      expect(downloadState.records.get(101)?.filename).toBe("downloads/pdf/server-name.pdf"),
    );
  });

  test("keeps the state's filename when the download item has none", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState();

    await Download.renameAndDownload(state);

    const suggest = vi.fn();
    capturedListener(
      { byExtensionId: global.browser.runtime.id, url: state.info.url, filename: undefined },
      suggest,
    );

    expect(suggest).toHaveBeenCalledWith({
      filename: "downloads/file.png",
      conflictAction: "uniquify",
    });
  });

  test("recreates missing state info from the download item", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState();

    await Download.renameAndDownload(state);

    const url = state.info.url;
    // Clearing info simulates a queued state that lost its metadata before the event.
    delete state.info;

    const suggest = vi.fn();
    const returned = capturedListener(
      { byExtensionId: global.browser.runtime.id, url, filename: "item.bin" },
      suggest,
    );

    expect(returned).toBe(false);
    expect(state.info).toEqual({ filename: "item.bin" });
    expect(suggest).toHaveBeenCalledWith({
      filename: "downloads/item.bin",
      conflictAction: "uniquify",
    });
  });
});

describe("concurrent downloads (pendingStates)", () => {
  let concurrentDownload: any;
  let listener: any;

  beforeEach(async () => {
    vi.resetModules();
    setCurrentBrowser("CHROME");
    global.chrome = {
      downloads: { onDeterminingFilename: { addListener: vi.fn() } },
    } as any;
    Object.assign(hostBrowser, {
      runtime: { id: "self-extension-id" },
      downloads: { download: vi.fn(() => Promise.resolve(1)) },
      // The file-level beforeEach of earlier describes touches these
      i18n: { getMessage: vi.fn((k: string) => k) },
      // No storage.session: SessionState.available() is false, so the real
      // session wrapper no-ops (these tests don't assert persistence)
      storage: { local: {} },
    } as any);
    global.browser = hostBrowser;

    // A fresh module graph (real deps at their defaults): filenamePatterns "" so
    // nothing routes, conflictAction "uniquify", and the identity-ish real Path.
    // Side effects are deferred (Task #2): register onDeterminingFilename from
    // this fresh instance before capturing it.
    const dl = await import("../src/downloads/download.ts");
    const { configureDownloadPorts: configureFreshDownloadPorts } =
      await import("../src/downloads/ports.ts");
    const { backgroundRuntime: freshRuntime } = await import("../src/background/runtime.ts");
    const { SaveHistory: freshHistory } = await import("../src/background/history.ts");
    const { Log: freshLog } = await import("../src/background/log.ts");
    configureFreshDownloadPorts({
      runtime: freshRuntime,
      history: freshHistory,
      log: freshLog,
      retry: dl.Download.retryViaFetch,
    });
    concurrentDownload = dl.Download;
    dl.registerDownloadListener();
    [[listener]] = vi.mocked(
      (global.chrome as any).downloads.onDeterminingFilename.addListener,
    ).mock.calls;
  });

  const makeConcurrentState = (url: string, dir: string, name: string) => ({
    path: { finalize: () => dir },
    scratch: {},
    info: { url, suggestedFilename: name, pageUrl: `https://page/${dir}`, modifiers: [] },
  });

  test("overlapping downloads each resolve to their own filename", () => {
    // B starts before A's onDeterminingFilename fires: with a single global
    // slot, A would be suggested B's path
    concurrentDownload.renameAndDownload(makeConcurrentState("https://x/a.png", "dirA", "a.png"));
    concurrentDownload.renameAndDownload(makeConcurrentState("https://x/b.png", "dirB", "b.png"));

    const suggestA = vi.fn();
    listener({ byExtensionId: "self-extension-id", url: "https://x/a.png" }, suggestA);
    expect(suggestA).toHaveBeenCalledWith(expect.objectContaining({ filename: "dirA/a.png" }));

    const suggestB = vi.fn();
    listener({ byExtensionId: "self-extension-id", url: "https://x/b.png" }, suggestB);
    expect(suggestB).toHaveBeenCalledWith(expect.objectContaining({ filename: "dirB/b.png" }));
  });

  test("same-URL downloads are consumed in request order", () => {
    concurrentDownload.rememberPendingState(
      makeConcurrentState("https://x/same.png", "dirA", "a.png"),
    );
    concurrentDownload.rememberPendingState(
      makeConcurrentState("https://x/same.png", "dirB", "b.png"),
    );

    const suggestA = vi.fn();
    listener(
      { byExtensionId: "self-extension-id", url: "https://x/same.png", filename: "a.png" },
      suggestA,
    );
    expect(suggestA).toHaveBeenCalledWith(expect.objectContaining({ filename: "dirA/a.png" }));

    const suggestB = vi.fn();
    listener(
      { byExtensionId: "self-extension-id", url: "https://x/same.png", filename: "b.png" },
      suggestB,
    );
    expect(suggestB).toHaveBeenCalledWith(expect.objectContaining({ filename: "dirB/b.png" }));
  });

  test("consumed entries are removed and the map stays bounded", () => {
    concurrentDownload.renameAndDownload(makeConcurrentState("https://x/a.png", "dirA", "a.png"));
    listener({ byExtensionId: "self-extension-id", url: "https://x/a.png" }, vi.fn());
    expect(concurrentDownload.pendingStates.has("https://x/a.png")).toBe(false);

    for (let i = 0; i < 60; i += 1) {
      concurrentDownload.rememberPendingState(
        makeConcurrentState(`https://x/${i}.png`, "d", `${i}.png`),
      );
    }
    expect(concurrentDownload.pendingStates.size).toBeLessThanOrEqual(50);
  });

  test("bounds queued attempts even when every request uses the same URL", () => {
    for (let i = 0; i < 60; i += 1) {
      concurrentDownload.rememberPendingState(
        makeConcurrentState("https://x/same.png", "d", `${i}.png`),
      );
    }
    expect(concurrentDownload.pendingStates.get("https://x/same.png")?.length).toBeLessThanOrEqual(
      50,
    );
  });
});

describe("Download.launch (fire-and-forget with a user-facing failure)", () => {
  test("swallows a pipeline rejection, logging and reporting it to the user", async () => {
    const orig = Download.renameAndDownload;
    Download.renameAndDownload = vi.fn(() => Promise.reject(new Error("kaboom")));
    try {
      await expect(
        Download.launch(makeState({ info: { suggestedFilename: "x.png" } })),
      ).resolves.toEqual({ status: "failed" });

      expect(Log.add).toHaveBeenCalledWith(
        "renameAndDownload failed",
        expect.stringContaining("kaboom"),
      );
      expect(Notifier.reportFailure).toHaveBeenCalledWith(
        "x.png",
        expect.stringContaining("kaboom"),
      );
    } finally {
      Download.renameAndDownload = orig;
    }
  });

  test("reports nothing on a successful pipeline run", async () => {
    const orig = Download.renameAndDownload;
    Download.renameAndDownload = vi.fn(() =>
      Promise.resolve({ status: "started" as const, downloadId: 1 }),
    );
    try {
      await Download.launch(makeState());
      expect(Notifier.reportFailure).not.toHaveBeenCalled();
    } finally {
      Download.renameAndDownload = orig;
    }
  });
});

describe("terminal browserDownload failure surfaces to the user", () => {
  test("reports a failure when downloads.download rejects and the fallback is off", async () => {
    setCurrentBrowser("CHROME");
    options.fallbackFetch = false;
    (global.browser.downloads as any).download = vi.fn(() =>
      Promise.reject(new Error("disk full")),
    );

    await Download.renameAndDownload(makeState());

    expect(Notifier.reportFailure).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("disk full"),
    );
    expect(SaveHistory.setStatus).toHaveBeenCalledWith("h-test", "DOWNLOAD_API_FAILED");
  });

  test("does not report a rule match after a terminal browser rejection", async () => {
    setCurrentBrowser("CHROME");
    options.fallbackFetch = false;
    options.notifyOnRuleMatch = true;
    options.filenamePatterns = [routingRule()];
    vi.mocked(router.matchRules).mockReturnValue("matched/file.png");
    (global.browser.downloads as any).download = vi.fn(() => Promise.reject(new Error("denied")));

    await Download.renameAndDownload(makeState());

    expect(Notifier.createExtensionNotification).not.toHaveBeenCalled();
  });
});

describe("owned object URL lifecycle", () => {
  test("revokes an owned object URL when its browser download terminates", () => {
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    Download.ownedObjectUrls.set(404, "blob:owned-download");

    capturedDownloadChangedListener({ id: 404, state: { current: "complete" } });

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:owned-download");
    expect(Download.ownedObjectUrls.has(404)).toBe(false);
  });
});

describe("automatic fetch fallback (retryViaFetch)", () => {
  const seedStartedDownload = async () => {
    const state = makeState({
      info: { url: "https://example.com/dir/file.png", pageUrl: "https://example.com/page" },
    });
    await Download.renameAndDownload(state);
  };

  beforeEach(() => {
    downloadState.records.clear();
    Download.pendingRetryFilenames.clear();
    options.fallbackFetch = true;
  });

  test("started downloads are recorded with what a retry needs", async () => {
    await seedStartedDownload();

    expect(downloadState.records.get(101)).toMatchObject({
      url: "https://example.com/dir/file.png",
      pageUrl: "https://example.com/page",
      filename: "downloads/file.png",
      conflictAction: "uniquify",
      viaFetch: false,
      retried: false,
    });
  });

  test("does not fetch-retry an original URL whose protection cannot be preserved", async () => {
    await seedStartedDownload();
    await Download.rememberStartedDownload(101, { allowOriginalUrlFallback: false });
    vi.mocked(global.fetch).mockClear();

    await expect(Download.retryViaFetch(101)).resolves.toBe(false);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("retries a failed download once via a background fetch", async () => {
    await seedStartedDownload();
    options.includeFetchCredentials = true;

    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["bytes"])) }),
    ) as any;
    (global.browser.downloads as any).download = vi.fn(() => Promise.resolve(202));

    const retried = await Download.retryViaFetch(101);

    expect(retried).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://example.com/dir/file.png",
      expect.objectContaining({ credentials: "include", redirect: "follow" }),
    );
    expect(global.browser.downloads.download).toHaveBeenCalledWith({
      url: expect.stringMatching(/^blob:/),
      filename: "downloads/file.png",
      conflictAction: "uniquify",
    });
    // The retry is adopted as its own download and marks itself so a second
    // failure cannot loop
    expect(downloadState.records.get(202)).toMatchObject({ viaFetch: true, adopted: true });
    expect(Object.values(sessionStore.siFinalFilenames || {}).flat()).toContain(
      "downloads/file.png",
    );

    // Only one retry per download
    await expect(Download.retryViaFetch(101)).resolves.toBe(false);
  });

  test("keeps a Firefox private retry private and clears its transient filename", async () => {
    setCurrentBrowser("FIREFOX");
    const state = makeState({
      info: {
        url: "https://example.com/private/file.png",
        pageUrl: "https://example.com/private",
        currentTab: { incognito: true },
      },
    });
    await Download.renameAndDownload(state);
    options.includeFetchCredentials = true;
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:private-retry");
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["bytes"])) }),
    ) as any;
    (global.browser.downloads as any).download = vi.fn(() => Promise.resolve(202));

    await expect(Download.retryViaFetch(101)).resolves.toBe(true);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://example.com/private/file.png",
      expect.objectContaining({ credentials: "omit", redirect: "follow" }),
    );
    expect(global.browser.downloads.download).toHaveBeenCalledWith({
      url: "blob:private-retry",
      filename: "downloads/file.png",
      conflictAction: "uniquify",
      incognito: true,
    });
    expect(Download.pendingRetryFilenames.has("blob:private-retry")).toBe(false);
    expect(sessionStore.siDownloads?.[202]).toBeUndefined();
  });

  test("omits credentials from fallback fetching unless enabled", async () => {
    await seedStartedDownload();
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["bytes"])) }),
    ) as any;
    (global.browser.downloads as any).download = vi.fn(() => Promise.resolve(203));

    await expect(Download.retryViaFetch(101)).resolves.toBe(true);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://example.com/dir/file.png",
      expect.objectContaining({ credentials: "omit", redirect: "follow" }),
    );
  });

  test("cleans pending retry state when the browser rejects the retry", async () => {
    await seedStartedDownload();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:retry-rejected");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["bytes"])) }),
    ) as any;
    (global.browser.downloads as any).download = vi.fn(() => Promise.reject(new Error("denied")));

    await expect(Download.retryViaFetch(101)).resolves.toBe(false);

    expect(sessionStore.siPendingDownloads).toBe(0);
    expect(sessionStore.siFinalFilenames).toEqual({});
    expect(Download.pendingRetryFilenames.has("blob:retry-rejected")).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:retry-rejected");
  });

  test("does not save an HTTP error body as fetched content", async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 503, blob: vi.fn() })) as any;

    await expect(Download.acquireFetchedUrl("https://x/error")).resolves.toEqual({
      url: "https://x/error",
      source: "fetch-fallback-direct",
    });
    expect(Log.add).toHaveBeenCalledWith("fetch download failed", "Error: HTTP 503");
  });

  test("survives a service worker restart: retry works from the persisted record", async () => {
    await seedStartedDownload();

    // the record is persisted to storage.session alongside the in-memory map
    expect(sessionStore.siDownloads[101]).toMatchObject({
      url: "https://example.com/dir/file.png",
      filename: "downloads/file.png",
    });

    // a restart wipes the in-memory map; storage.session survives
    downloadState.records.clear();
    expect(await Download.getStartedDownload(101)).toMatchObject({
      url: "https://example.com/dir/file.png",
    });

    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["bytes"])) }),
    ) as any;
    (global.browser.downloads as any).download = vi.fn(() => Promise.resolve(303));

    // the fetch-retry still works even though the in-memory record is gone
    await expect(Download.retryViaFetch(101)).resolves.toBe(true);
    expect(global.browser.downloads.download).toHaveBeenCalled();
  });

  test("never retries downloads that already went through a fetch", async () => {
    downloadState.records.set(7, {
      url: "https://x/y.png",
      filename: "y.png",
      viaFetch: true,
      retried: false,
    });
    global.fetch = vi.fn() as any;

    await expect(Download.retryViaFetch(7)).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("does nothing when the option is disabled", async () => {
    await seedStartedDownload();
    options.fallbackFetch = false;
    global.fetch = vi.fn() as any;

    await expect(Download.retryViaFetch(101)).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("an HTTP error response does not start a second download", async () => {
    await seedStartedDownload();
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 403 })) as any;
    (global.browser.downloads as any).download = vi.fn();

    await expect(Download.retryViaFetch(101)).resolves.toBe(false);
    expect(global.browser.downloads.download).not.toHaveBeenCalled();
  });

  test("unknown download ids resolve false", async () => {
    await expect(Download.retryViaFetch(999)).resolves.toBe(false);
  });

  test("does not retry an incomplete persisted record", async () => {
    downloadState.records.set(101, { pageUrl: "https://example.com/page" });
    global.fetch = vi.fn() as any;

    await expect(Download.retryViaFetch(101)).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("an immediately rejected downloads.download falls back to fetch once", async () => {
    setCurrentBrowser("CHROME");
    (global.browser.downloads as any).download = vi
      .fn()
      .mockRejectedValueOnce(new Error("data: URLs are not supported"))
      .mockResolvedValue(303);
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["bytes"])) }),
    ) as any;

    await Download.renameAndDownload(makeState());

    expect(global.browser.downloads.download).toHaveBeenCalledTimes(2);
    expect(vi.mocked(global.browser.downloads.download).mock.calls[1][0].url).toMatch(/^blob:/);
    expect(downloadState.records.get(303)).toMatchObject({ viaFetch: true });
  });

  test("immediate rejection does not fall back when disabled", async () => {
    setCurrentBrowser("CHROME");
    options.fallbackFetch = false;
    (global.browser.downloads as any).download = vi.fn(() => Promise.reject(new Error("nope")));
    global.fetch = vi.fn() as any;

    await Download.renameAndDownload(makeState());

    expect(global.browser.downloads.download).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("private browsing persistence", () => {
  test("keeps private save metadata out of local and session storage", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState({ info: { currentTab: { incognito: true } } });

    await Download.renameAndDownload(state);

    expect(SaveHistory.add).toHaveBeenCalledWith(expect.any(Object), {
      privateContext: true,
    });
    expect(sessionStore.siPendingDownloads).toBeUndefined();
    expect(sessionStore.siFinalFilenames).toBeUndefined();
    expect(sessionStore.siDownloads?.[101]).toBeUndefined();
    expect(downloadState.records.get(101)).toMatchObject({
      privateContext: true,
      adopted: true,
    });
    expect(Log.add).not.toHaveBeenCalledWith("download requested", expect.anything());
    expect(downloaded).not.toHaveBeenCalled();
    expect(backgroundRuntime.lastDownloadState).toBeUndefined();
  });
});

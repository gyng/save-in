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
import { DownloadState } from "../src/download-state.ts";
import { OffscreenClient } from "../src/offscreen-client.ts";
import { SessionState } from "../src/session-state.ts";
import { Log } from "../src/log.ts";
import { SaveHistory } from "../src/history.ts";
import { getFilenameFromContentDispositionHeader } from "../src/vendor/content-disposition.ts";

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
global.browser = {
  runtime: { id: "self-extension-id" },
  i18n: { getMessage: vi.fn((key: string) => key) },
  downloads: { download: vi.fn(() => Promise.resolve(101)) },
} as any;

// Importing download.ts loads the rest of the (real) cyclic module graph;
// grab the same singleton instances it binds to.
const { Download, registerDownloadListener } = await import("../src/download.ts");
const { options } = await import("../src/options-data.ts");
const { Router } = await import("../src/router.ts");
const { Variable } = await import("../src/variable.ts");
const { Notifier } = await import("../src/notification.ts");
const { Path } = await import("../src/path.ts");
const { RequestHeaders } = await import("../src/headers.ts");
const { DownloadEvents } = await import("../src/download-events.ts");
// download.ts already loaded chrome-detector into the graph; this is the same
// instance it reads CURRENT_BROWSER from. global.browser (above) has no
// getBrowserInfo, so its load-time detection settled on Chrome.
const { setCurrentBrowser } = await import("../src/chrome-detector.ts");

// Import-time side effects are deferred (Task #2): download.ts no longer
// registers onDeterminingFilename at load — the entry does, so call it here to
// attach the listener against the chrome.downloads stub, then capture it.
registerDownloadListener();
const [[capturedListener]] = vi.mocked(
  (global.chrome as any).downloads.onDeterminingFilename.addListener,
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
  setCurrentBrowser("FIREFOX");

  // Reset the real options bag to exactly the fields this suite controls
  for (const k of Object.keys(options)) delete options[k];
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
    // Off by default here; a dedicated suite exercises the MIME-append path
    appendMimeExtension: false,
  });

  // Path.Path is used real (its finalize is identity for these test routes);
  // only sanitizeFilename is controlled/asserted.
  vi.spyOn(Path, "sanitizeFilename").mockImplementation((name: any) => name);
  vi.spyOn(Router, "matchRules").mockReturnValue(null);
  // Variable.applyVariables stays real (a never-asserted passthrough that leaves
  // a bufless path unchanged); resolveMime/mimeToExtension are spied per MIME test.

  vi.spyOn(Notifier, "createExtensionNotification").mockImplementation(() => {});
  vi.spyOn(Notifier, "reportFailure").mockImplementation(() => {});
  vi.spyOn(Notifier, "expectDownload").mockImplementation(() => {});

  vi.spyOn(RequestHeaders, "prepareReferer").mockResolvedValue(undefined);

  for (const k of Object.keys(sessionStore)) delete sessionStore[k];
  vi.spyOn(SessionState, "set").mockImplementation((obj: any) => {
    Object.assign(sessionStore, obj);
    return Promise.resolve();
  });
  vi.spyOn(SessionState, "get").mockImplementation((key: any) =>
    Promise.resolve(key in sessionStore ? { [key]: sessionStore[key] } : {}),
  );
  vi.spyOn(SessionState, "update").mockImplementation((key: any, fn: any) => {
    sessionStore[key] = fn(sessionStore[key]);
    return Promise.resolve();
  });

  // setDownloadId is never asserted; add returns a stable id so the started
  // record carries a truthy historyEntryId
  vi.spyOn(SaveHistory, "add").mockReturnValue("h-test");
  vi.spyOn(SaveHistory, "setDownloadId").mockImplementation(() => Promise.resolve());
  vi.spyOn(Log, "add").mockImplementation(() => Promise.resolve());

  // Reset the emit stub between tests (it is a mock-factory vi.fn, not a spy)
  DownloadEvents.downloaded = vi.fn();

  vi.mocked(getFilenameFromContentDispositionHeader).mockReset();
  vi.mocked(getFilenameFromContentDispositionHeader).mockReturnValue(null);

  // getMessage is never asserted; it only needs to echo the key
  (global.browser.i18n as any).getMessage = (key: string) => key;
  (global.browser.downloads as any).download = vi.fn(() => Promise.resolve(101));

  global.fetch = vi.fn(() =>
    Promise.resolve({ headers: { has: () => false, get: () => null } }),
  ) as any;

  window.SI_DEBUG = false;
  window.lastDownloadState = undefined;
  DownloadState.records.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
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
    options.filenamePatterns = undefined;
    expect(Download.getRoutingMatches({ info: {} })).toBe(null);

    options.filenamePatterns = [];
    expect(Download.getRoutingMatches({ info: {} })).toBe(null);

    expect(Router.matchRules).not.toHaveBeenCalled();
  });

  test("delegates to Router.matchRules when patterns exist", () => {
    options.filenamePatterns = [["rule"]];
    vi.mocked(Router.matchRules).mockReturnValue("the/route");
    const state = { info: { url: "x" } };

    expect(Download.getRoutingMatches(state)).toBe("the/route");
    expect(Router.matchRules).toHaveBeenCalledWith(options.filenamePatterns, state.info);
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
    options.filenamePatterns = [["rule"]];
    vi.mocked(Router.matchRules).mockReturnValue("pdfs/");

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(state.routeIsFolder).toBe(true);
    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "downloads/pdfs/file.png" }),
    );
  });

  test("a route without a trailing slash sets the whole name (unchanged)", async () => {
    setCurrentBrowser("CHROME");
    options.filenamePatterns = [["rule"]];
    vi.mocked(Router.matchRules).mockReturnValue("renamed.png");

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

    expect(global.fetch).toHaveBeenCalledWith(state.info.url, {
      method: "HEAD",
      credentials: "include",
    });

    expect(state.info.filename).toBe("server-name.pdf");
    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ filename: expect.stringContaining("server-name.pdf") }),
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
    expect(DownloadEvents.downloaded).not.toHaveBeenCalled();
    expect(SaveHistory.add).not.toHaveBeenCalled();
  });

  test("proceeds when needRouteMatch is true and a route matched", async () => {
    setCurrentBrowser("CHROME");
    options.filenamePatterns = [["rule"]];
    vi.mocked(Router.matchRules).mockReturnValue("matched/route.txt");

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
  test("builds state.route from Router.matchRules and uses it in the final path", async () => {
    setCurrentBrowser("CHROME");
    options.filenamePatterns = [["rule"]];
    vi.mocked(Router.matchRules).mockReturnValue("matched/route.txt");

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(Router.matchRules).toHaveBeenCalledWith(options.filenamePatterns, state.info);
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
  test("prepares the referer, persists session state, downloads, and tracks the result", async () => {
    setCurrentBrowser("CHROME");
    (global.browser.downloads as any).download = vi.fn(() => Promise.resolve(555));

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(RequestHeaders.prepareReferer).toHaveBeenCalledWith(state);
    // pending counter + per-URL filename map are updated (see the session-
    // restart recovery tests for the values)
    expect(SessionState.update).toHaveBeenCalledWith("siPendingDownloads", expect.any(Function));
    expect(SessionState.update).toHaveBeenCalledWith("siFinalFilenames", expect.any(Function));
    expect(global.browser.downloads.download).toHaveBeenCalledWith({
      url: state.info.url,
      filename: expect.any(String),
      saveAs: false,
      conflictAction: "uniquify",
    });
    // download.js adopts its own download (the record is what the notifier
    // watches for a completion toast)
    expect(DownloadState.records.get(555)).toMatchObject({ adopted: true });
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
    expect([...DownloadState.records.values()].some((r: any) => r.adopted)).toBe(false);
    expect(Log.add).toHaveBeenCalledWith("downloads.download failed", "Error: disk full");
    await vi.waitFor(() => expect(sessionStore.siPendingDownloads).toBe(0));
  });

  test("a downloads.download rejection does not throw and clears the pending flag", async () => {
    setCurrentBrowser("CHROME");
    (global.browser.downloads as any).download = vi.fn(() =>
      Promise.reject(new Error("disk full")),
    );

    const state = makeState();
    await expect(Download.renameAndDownload(state)).resolves.toBeUndefined();

    expect([...DownloadState.records.values()].some((r: any) => r.adopted)).toBe(false);
    await vi.waitFor(() => expect(sessionStore.siPendingDownloads).toBe(0));
  });

  test("substitutes _ for an empty final path", async () => {
    setCurrentBrowser("CHROME");
    vi.mocked(Path.sanitizeFilename).mockReturnValue(null as any);

    const state = makeState({ path: { finalize: () => null } });
    await Download.renameAndDownload(state);

    // the filename-map update stores "_" for this download's URL
    const fnameUpdate = vi
      .mocked(SessionState.update)
      .mock.calls.find((c: any) => c[0] === "siFinalFilenames");
    expect(fnameUpdate![1]({})).toEqual({ [state.info.url]: "_" });
    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "_" }),
    );
  });

  test("emits downloaded, records lastDownloadState, and saves history", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState();

    await Download.renameAndDownload(state);

    expect(DownloadEvents.downloaded).toHaveBeenCalledWith(state);
    expect(window.lastDownloadState).toBe(state);
    expect(SaveHistory.add).toHaveBeenCalledWith(
      expect.objectContaining({
        url: state.info.url,
        routed: false,
        info: expect.objectContaining({ sourceUrl: state.info.sourceUrl }),
      }),
    );
  });
});

describe("renameAndDownload: fetchViaFetch", () => {
  test("fetches the URL, converts the blob to an object URL, then downloads it", async () => {
    setCurrentBrowser("CHROME");
    options.fetchViaFetch = true;
    global.fetch = vi.fn(() =>
      Promise.resolve({ blob: () => Promise.resolve(new Blob(["file contents"])) }),
    ) as any;

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(global.fetch).toHaveBeenCalledWith(state.info.url, { credentials: "include" });
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

      expect(OffscreenClient.fetch).toHaveBeenCalledWith(state.info.url);
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
    options.filenamePatterns = [["rule"]];
    vi.mocked(Router.matchRules).mockReturnValue("matched/route.txt");
    options.notifyOnRuleMatch = true;

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(Notifier.createExtensionNotification).toHaveBeenCalledWith(
      "notificationRuleMatchedTitle",
      "file.png\n⬇\nmatched/route.txt",
      false,
    );
  });

  test("does not notify on rule match when notifyOnRuleMatch is disabled", async () => {
    setCurrentBrowser("CHROME");
    options.filenamePatterns = [["rule"]];
    vi.mocked(Router.matchRules).mockReturnValue("matched/route.txt");
    options.notifyOnRuleMatch = false;

    await Download.renameAndDownload(makeState());
    expect(Notifier.createExtensionNotification).not.toHaveBeenCalled();
  });

  test("notifies failure when routeExclusive+notifyOnFailure are enabled and no route matched", async () => {
    setCurrentBrowser("CHROME");
    options.routeExclusive = true;
    options.notifyOnFailure = true;

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(Notifier.createExtensionNotification).toHaveBeenCalledWith(
      "notificationRuleMatchFailedExclusiveTitle",
      "notificationRuleMatchFailedExclusiveMessage",
      true,
    );
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
    await expect(Download.renameAndDownload(state)).resolves.toBeUndefined();

    expect(global.browser.downloads.download).toHaveBeenCalled();
  });
});

describe("renameAndDownload: window.SI_DEBUG", () => {
  test("logs debug info when window.SI_DEBUG is set", async () => {
    setCurrentBrowser("CHROME");
    window.SI_DEBUG = true;
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await Download.renameAndDownload(makeState());

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
    window.SI_DEBUG = false;
  });
});

describe("onDeterminingFilename listener: sync path", () => {
  test("suggests the finalized path when globalChromeState already has a path", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState();

    // Drives globalChromeState (module-local) via renameAndDownload
    await Download.renameAndDownload(state);

    const suggest = vi.fn();
    const returned = capturedListener(
      { byExtensionId: global.browser.runtime.id, filename: "from-download-item.bin" },
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
      { byExtensionId: global.browser.runtime.id, filename: "from-download-item.bin" },
      suggest,
    );

    expect(suggest).toHaveBeenCalledWith({
      filename: "downloads/suggested.txt",
      conflictAction: "uniquify",
    });
  });

  test("keeps the state's filename when the download item has none", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState();

    await Download.renameAndDownload(state);

    const suggest = vi.fn();
    capturedListener({ byExtensionId: global.browser.runtime.id, filename: undefined }, suggest);

    expect(suggest).toHaveBeenCalledWith({
      filename: "downloads/file.png",
      conflictAction: "uniquify",
    });
  });

  test("recreates missing state info from the download item", async () => {
    setCurrentBrowser("CHROME");
    const state = makeState();

    await Download.renameAndDownload(state);

    // globalChromeState is a reference to this same state object: clearing
    // info here simulates a state that lost it before the event fired
    delete state.info;

    const suggest = vi.fn();
    const returned = capturedListener(
      { byExtensionId: global.browser.runtime.id, filename: "item.bin" },
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
  let Download: any;
  let listener: any;

  beforeEach(async () => {
    vi.resetModules();
    setCurrentBrowser("CHROME");
    global.chrome = {
      downloads: { onDeterminingFilename: { addListener: vi.fn() } },
    } as any;
    global.browser = {
      runtime: { id: "self-extension-id" },
      downloads: { download: vi.fn(() => Promise.resolve(1)) },
      // The file-level beforeEach of earlier describes touches these
      i18n: { getMessage: vi.fn((k: string) => k) },
      // No storage.session: SessionState.available() is false, so the real
      // session wrapper no-ops (these tests don't assert persistence)
      storage: { local: {} },
    } as any;

    // A fresh module graph (real deps at their defaults): filenamePatterns "" so
    // nothing routes, conflictAction "uniquify", and the identity-ish real Path.
    // Side effects are deferred (Task #2): register onDeterminingFilename from
    // this fresh instance before capturing it.
    const dl = await import("../src/download.ts");
    Download = dl.Download;
    dl.registerDownloadListener();
    [[listener]] = vi.mocked(
      (global.chrome as any).downloads.onDeterminingFilename.addListener,
    ).mock.calls;
  });

  const makeState = (url: string, dir: string, name: string) => ({
    path: { finalize: () => dir },
    scratch: {},
    info: { url, suggestedFilename: name, pageUrl: `https://page/${dir}`, modifiers: [] },
  });

  test("overlapping downloads each resolve to their own filename", () => {
    // B starts before A's onDeterminingFilename fires: with a single global
    // slot, A would be suggested B's path
    Download.renameAndDownload(makeState("https://x/a.png", "dirA", "a.png"));
    Download.renameAndDownload(makeState("https://x/b.png", "dirB", "b.png"));

    const suggestA = vi.fn();
    listener({ byExtensionId: "self-extension-id", url: "https://x/a.png" }, suggestA);
    expect(suggestA).toHaveBeenCalledWith(expect.objectContaining({ filename: "dirA/a.png" }));

    const suggestB = vi.fn();
    listener({ byExtensionId: "self-extension-id", url: "https://x/b.png" }, suggestB);
    expect(suggestB).toHaveBeenCalledWith(expect.objectContaining({ filename: "dirB/b.png" }));
  });

  test("consumed entries are removed and the map stays bounded", () => {
    Download.renameAndDownload(makeState("https://x/a.png", "dirA", "a.png"));
    listener({ byExtensionId: "self-extension-id", url: "https://x/a.png" }, vi.fn());
    expect(Download.pendingStates.has("https://x/a.png")).toBe(false);

    for (let i = 0; i < 60; i += 1) {
      Download.rememberPendingState(makeState(`https://x/${i}.png`, "d", `${i}.png`));
    }
    expect(Download.pendingStates.size).toBeLessThanOrEqual(50);
  });
});

describe("Download.launch (fire-and-forget with a user-facing failure)", () => {
  test("swallows a pipeline rejection, logging and reporting it to the user", async () => {
    const orig = Download.renameAndDownload;
    Download.renameAndDownload = vi.fn(() => Promise.reject(new Error("kaboom")));
    try {
      await expect(
        Download.launch(makeState({ info: { suggestedFilename: "x.png" } })),
      ).resolves.toBeUndefined();

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
    Download.renameAndDownload = vi.fn(() => Promise.resolve());
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
    DownloadState.records.clear();
    Download.pendingRetryFilenames.clear();
    options.fallbackFetch = true;
  });

  test("started downloads are recorded with what a retry needs", async () => {
    await seedStartedDownload();

    expect(DownloadState.records.get(101)).toMatchObject({
      url: "https://example.com/dir/file.png",
      pageUrl: "https://example.com/page",
      filename: "downloads/file.png",
      conflictAction: "uniquify",
      viaFetch: false,
      retried: false,
    });
  });

  test("retries a failed download once via a background fetch", async () => {
    await seedStartedDownload();

    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["bytes"])) }),
    ) as any;
    (global.browser.downloads as any).download = vi.fn(() => Promise.resolve(202));

    const retried = await Download.retryViaFetch(101);

    expect(retried).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith("https://example.com/dir/file.png", {
      credentials: "include",
    });
    // The referer rule is re-armed for the retry
    expect(RequestHeaders.prepareReferer).toHaveBeenCalledWith({
      info: { url: "https://example.com/dir/file.png", pageUrl: "https://example.com/page" },
    });
    expect(global.browser.downloads.download).toHaveBeenCalledWith({
      url: expect.stringMatching(/^blob:/),
      filename: "downloads/file.png",
      conflictAction: "uniquify",
    });
    // The retry is adopted as its own download and marks itself so a second
    // failure cannot loop
    expect(DownloadState.records.get(202)).toMatchObject({ viaFetch: true, adopted: true });

    // Only one retry per download
    await expect(Download.retryViaFetch(101)).resolves.toBe(false);
  });

  test("survives a service worker restart: retry works from the persisted record", async () => {
    await seedStartedDownload();

    // the record is persisted to storage.session alongside the in-memory map
    expect(sessionStore.siDownloads[101]).toMatchObject({
      url: "https://example.com/dir/file.png",
      filename: "downloads/file.png",
    });

    // a restart wipes the in-memory map; storage.session survives
    DownloadState.records.clear();
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
    DownloadState.records.set(7, {
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
    expect(DownloadState.records.get(303)).toMatchObject({ viaFetch: true });
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

// renameAndDownload end-to-end flow: Chrome vs Firefox entry points, prompt
// combinations, routing, the browserDownload/fetchDownload closures,
// notification triggers, and the onDeterminingFilename sync path.
//
// The MV3 data-URL fallbacks and the onDeterminingFilename async
// session-recovery path are covered by test/download-mv3.test.js and are not
// duplicated here.

const flush = async (times = 10) => {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
};

// download.ts's dependencies are bridged to the (stubbed) globals this test
// seeds per-test; DownloadState and OffscreenClient are the real singletons the
// test manipulates directly, so they are imported, not mocked.
import { DownloadState } from "../src/download-state.ts";
import { OffscreenClient } from "../src/offscreen-client.ts";

// The vi.mock getter-bridges read the globals the test seeds. The @types
// (firefox-webext-browser/chrome/node) don't type these ad-hoc globals, so the
// globalThis read is cast at this mock boundary.
vi.mock("../src/option.ts", () => ({
  get options() {
    return (globalThis as any).options;
  },
  OptionsManagement: {},
}));
vi.mock("../src/chrome-detector.ts", () => ({
  BROWSERS: { CHROME: "CHROME", FIREFOX: "FIREFOX", UNKNOWN: "UNKNOWN" },
  get CURRENT_BROWSER() {
    return (globalThis as any).CURRENT_BROWSER;
  },
}));
vi.mock("../src/path.ts", () => ({
  get Path() {
    return (globalThis as any).Path;
  },
}));
vi.mock("../src/router.ts", () => ({
  get Router() {
    return (globalThis as any).Router;
  },
}));
vi.mock("../src/variable.ts", () => ({
  get Variable() {
    return (globalThis as any).Variable;
  },
}));
vi.mock("../src/messaging.ts", () => ({
  get Messaging() {
    return (globalThis as any).Messaging;
  },
}));
vi.mock("../src/notification.ts", () => ({
  get Notifier() {
    return (globalThis as any).Notifier;
  },
}));
vi.mock("../src/headers.ts", () => ({
  get RequestHeaders() {
    return (globalThis as any).RequestHeaders;
  },
}));
vi.mock("../src/session-state.ts", () => {
  const noop = {
    available: () => false,
    get: () => Promise.resolve({}),
    set: () => Promise.resolve(),
    update: () => Promise.resolve(),
  };
  return {
    get SessionState() {
      return (globalThis as any).SessionState || noop;
    },
  };
});
vi.mock("../src/history.ts", () => ({
  get SaveHistory() {
    return (globalThis as any).SaveHistory;
  },
}));
vi.mock("../src/log.ts", () => ({
  get Log() {
    return (globalThis as any).Log;
  },
}));
vi.mock("../src/vendor/content-disposition.ts", () => ({
  get getFilenameFromContentDispositionHeader() {
    return (globalThis as any).getFilenameFromContentDispositionHeader;
  },
}));

// The ad-hoc globals the source reads through the bridges above aren't on the
// @types-provided globalThis; route every seed/read through one loosely-typed
// handle (the mock boundary) instead of casting each access.
const g: any = global;

// These are read at module-import time (chrome.downloads.onDeterminingFilename
// presence) as well as at call time, so they must exist before the import.
g.BROWSERS = { CHROME: "CHROME", FIREFOX: "FIREFOX", UNKNOWN: "UNKNOWN" };
g.CURRENT_BROWSER = "FIREFOX";

g.chrome = {
  downloads: {
    onDeterminingFilename: { addListener: jest.fn() },
  },
};
g.browser = {
  runtime: { id: "self-extension-id" },
  i18n: { getMessage: jest.fn((key: string) => key) },
  downloads: { download: jest.fn(() => Promise.resolve(101)) },
};

const Download = (await import("../src/download.ts")).Download;

const [[capturedListener]] = g.chrome.downloads.onDeterminingFilename.addListener.mock.calls;

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
  g.CURRENT_BROWSER = "FIREFOX";

  g.options = {
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
  };

  g.Path = {
    Path: class MockPath {
      val: any;

      constructor(val: any) {
        this.val = val;
      }

      finalize() {
        return this.val;
      }

      toString() {
        return String(this.val);
      }
    },
    sanitizeFilename: jest.fn((name) => name),
  };

  g.Router = { matchRules: jest.fn(() => null) };
  // applyVariables is a never-asserted passthrough — a plain stub, not a spy
  g.Variable = { applyVariables: (path: any) => path };

  g.Messaging = {
    emit: { downloaded: jest.fn() },
  };

  g.Notifier = {
    createExtensionNotification: jest.fn(),
    expectDownload: jest.fn(),
    reportFailure: jest.fn(),
  };

  g.RequestHeaders = { prepareReferer: jest.fn(() => Promise.resolve()) };
  g.sessionStore = {};
  g.SessionState = {
    set: jest.fn((obj) => {
      Object.assign(g.sessionStore, obj);
      return Promise.resolve();
    }),
    get: jest.fn((key) =>
      Promise.resolve(key in g.sessionStore ? { [key]: g.sessionStore[key] } : {}),
    ),
    update: jest.fn((key, fn) => {
      g.sessionStore[key] = fn(g.sessionStore[key]);
      return Promise.resolve();
    }),
  };
  // setDownloadId is never asserted — a plain stub, not a spy
  g.SaveHistory = { add: jest.fn(() => Promise.resolve()), setDownloadId: () => {} };
  g.Log = { add: jest.fn() };

  // getMessage is never asserted; it only needs to echo the key
  g.browser.i18n.getMessage = (key: string) => key;
  g.browser.downloads.download = jest.fn(() => Promise.resolve(101));

  g.getFilenameFromContentDispositionHeader = jest.fn(() => null);
  g.fetch = jest.fn(() => Promise.resolve({ headers: { has: () => false, get: () => null } }));

  window.SI_DEBUG = false;
  window.lastDownloadState = undefined;
  DownloadState.records.clear();
});

describe("getFilenameFromContentDisposition", () => {
  test("returns null for non-string input", () => {
    expect(Download.getFilenameFromContentDisposition(undefined)).toBe(null);
    expect(Download.getFilenameFromContentDisposition(123)).toBe(null);
    expect(Download.getFilenameFromContentDisposition(null)).toBe(null);
  });

  test("double-decodes the value returned by the library", () => {
    // "na me.txt" URI-encoded twice
    g.getFilenameFromContentDispositionHeader = jest.fn(() => "na%2520me.txt");
    expect(Download.getFilenameFromContentDisposition("attachment; filename=whatever")).toBe(
      "na me.txt",
    );
  });

  test("keeps filenames with a literal % that is not an escape", () => {
    g.getFilenameFromContentDispositionHeader = jest.fn(() => "50%.txt");
    expect(Download.getFilenameFromContentDisposition("attachment; filename=whatever")).toBe(
      "50%.txt",
    );
  });

  test("stops decoding when a second pass would fail", () => {
    // one valid decode, then the result is no longer a valid escape sequence
    g.getFilenameFromContentDispositionHeader = jest.fn(() => "%2550%25.txt");
    expect(Download.getFilenameFromContentDisposition("attachment; filename=whatever")).toBe(
      "%50%.txt",
    );
  });

  test("returns null when the library returns a falsy value", () => {
    g.getFilenameFromContentDispositionHeader = jest.fn(() => null);
    expect(Download.getFilenameFromContentDisposition("attachment")).toBe(null);

    g.getFilenameFromContentDispositionHeader = jest.fn(() => "");
    expect(Download.getFilenameFromContentDisposition("attachment")).toBe(null);
  });
});

describe("getRoutingMatches", () => {
  test("returns null when there are no filename patterns", () => {
    g.options.filenamePatterns = undefined;
    expect(Download.getRoutingMatches({ info: {} })).toBe(null);

    g.options.filenamePatterns = [];
    expect(Download.getRoutingMatches({ info: {} })).toBe(null);

    expect(g.Router.matchRules).not.toHaveBeenCalled();
  });

  test("delegates to Router.matchRules when patterns exist", () => {
    g.options.filenamePatterns = [["rule"]];
    g.Router.matchRules = jest.fn(() => "the/route");
    const state = { info: { url: "x" } };

    expect(Download.getRoutingMatches(state)).toBe("the/route");
    expect(g.Router.matchRules).toHaveBeenCalledWith(g.options.filenamePatterns, state.info);
  });
});

describe("finalizeFullPath", () => {
  test("strips a leading ./ and uses the sanitized filename when there is no route", () => {
    g.Path.sanitizeFilename = jest.fn(() => "sanitized.txt");
    const state = {
      path: { finalize: () => "./some/dir" },
      info: { filename: "raw.txt" },
    };

    expect(Download.finalizeFullPath(state)).toBe("some/dir/sanitized.txt");
    expect(g.Path.sanitizeFilename).toHaveBeenCalledWith("raw.txt");
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
    g.CURRENT_BROWSER = "CHROME";
    g.options.appendMimeExtension = true;
    g.Variable.resolveMime = jest.fn(() => Promise.resolve("image/jpeg"));
    g.Variable.mimeToExtension = jest.fn((mime) => (mime === "image/jpeg" ? "jpg" : ""));

    const state = makeState({ info: { url: "https://cdn.example.com/img/12345" } });
    await Download.renameAndDownload(state);
    await flush();

    expect(g.Variable.resolveMime).toHaveBeenCalledWith(state.info);
    expect(g.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ filename: expect.stringMatching(/12345\.jpg$/) }),
    );
  });

  test("skips the HEAD and leaves a filename that already has an extension", async () => {
    g.CURRENT_BROWSER = "CHROME";
    g.options.appendMimeExtension = true;
    g.Variable.resolveMime = jest.fn(() => Promise.resolve("image/jpeg"));
    g.Variable.mimeToExtension = jest.fn(() => "jpg");

    const state = makeState({ info: { url: "https://cdn.example.com/img/photo.png" } });
    await Download.renameAndDownload(state);
    await flush();

    expect(g.Variable.resolveMime).not.toHaveBeenCalled();
    expect(g.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ filename: expect.stringMatching(/photo\.png$/) }),
    );
  });
});

describe("renameAndDownload: shared :sha256: fetch reuse", () => {
  test("reuses the already-fetched download URL instead of fetching the file again", async () => {
    g.CURRENT_BROWSER = "CHROME";
    const state = makeState({
      info: {
        contentPromise: Promise.resolve({
          downloadUrl: "data:application/octet-stream;base64,eA==",
        }),
      },
    });

    await Download.renameAndDownload(state);
    await flush();

    expect(g.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ url: "data:application/octet-stream;base64,eA==" }),
    );
  });

  test("falls back to the normal download when the shared fetch failed (null content)", async () => {
    g.CURRENT_BROWSER = "CHROME";
    const state = makeState({ info: { contentPromise: Promise.resolve(null) } });

    await Download.renameAndDownload(state);
    await flush();

    expect(g.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ url: state.info.url }),
    );
  });
});

describe("renameAndDownload: folder-only route (§8.1)", () => {
  test("a trailing-slash into: routes into the folder and keeps the real filename", async () => {
    g.CURRENT_BROWSER = "CHROME";
    g.options.filenamePatterns = [["rule"]];
    g.Router.matchRules = jest.fn(() => "pdfs/");

    const state = makeState();
    await Download.renameAndDownload(state);
    await flush();

    expect(state.routeIsFolder).toBe(true);
    expect(g.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "downloads/pdfs/file.png" }),
    );
  });

  test("a route without a trailing slash sets the whole name (unchanged)", async () => {
    g.CURRENT_BROWSER = "CHROME";
    g.options.filenamePatterns = [["rule"]];
    g.Router.matchRules = jest.fn(() => "renamed.png");

    const state = makeState();
    await Download.renameAndDownload(state);
    await flush();

    expect(state.routeIsFolder).toBe(false);
    expect(g.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "downloads/renamed.png" }),
    );
  });
});

describe("renameAndDownload: Chrome vs Firefox entry", () => {
  test("Chrome path skips the HEAD request and downloads immediately", async () => {
    g.CURRENT_BROWSER = "CHROME";
    const state = makeState();

    await Download.renameAndDownload(state);
    expect(g.fetch).not.toHaveBeenCalled();

    await flush();
    expect(g.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ url: state.info.url }),
    );
  });

  test("Firefox path performs a HEAD request and applies the Content-Disposition filename", async () => {
    g.CURRENT_BROWSER = "FIREFOX";
    g.getFilenameFromContentDispositionHeader = jest.fn(() => "server-name.pdf");
    g.fetch = jest.fn(() =>
      Promise.resolve({
        headers: { has: () => true, get: () => 'attachment; filename="server-name.pdf"' },
      }),
    );

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(g.fetch).toHaveBeenCalledWith(state.info.url, {
      method: "HEAD",
      credentials: "include",
    });

    await flush();
    expect(state.info.filename).toBe("server-name.pdf");
    expect(g.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ filename: expect.stringContaining("server-name.pdf") }),
    );
  });

  test("Firefox path keeps the original filename when the Content-Disposition has no usable name", async () => {
    g.CURRENT_BROWSER = "FIREFOX";
    g.getFilenameFromContentDispositionHeader = jest.fn(() => null);
    g.fetch = jest.fn(() =>
      Promise.resolve({ headers: { has: () => true, get: () => "attachment" } }),
    );

    const state = makeState();
    await Download.renameAndDownload(state);
    await flush();

    expect(state.info.filename).toBe("file.png");
    expect(g.browser.downloads.download).toHaveBeenCalled();
  });

  test("Firefox path keeps the original filename when Content-Disposition is absent", async () => {
    g.CURRENT_BROWSER = "FIREFOX";
    g.fetch = jest.fn(() => Promise.resolve({ headers: { has: () => false, get: () => null } }));

    const state = makeState();
    await Download.renameAndDownload(state);
    await flush();

    expect(state.info.filename).toBe("file.png");
    expect(g.getFilenameFromContentDispositionHeader).not.toHaveBeenCalled();
    expect(g.browser.downloads.download).toHaveBeenCalled();
  });

  test("Firefox path downloads anyway when the HEAD request rejects", async () => {
    g.CURRENT_BROWSER = "FIREFOX";
    g.fetch = jest.fn(() => Promise.reject(new Error("network down")));

    const state = makeState();
    await Download.renameAndDownload(state);
    await flush();

    expect(g.browser.downloads.download).toHaveBeenCalled();
  });
});

describe("renameAndDownload: initial filename resolution", () => {
  test("prefers info.suggestedFilename over the URL-derived filename", async () => {
    g.CURRENT_BROWSER = "CHROME";
    const state = makeState({ info: { suggestedFilename: "suggested.txt" } });

    await Download.renameAndDownload(state);
    await flush();

    expect(state.info.naiveFilename).toBe("file.png");
    expect(state.info.initialFilename).toBe("suggested.txt");
    expect(state.info.filename).toBe("suggested.txt");
  });

  test("falls back to the full URL when the URL has no filename component", async () => {
    g.CURRENT_BROWSER = "CHROME";
    const state = makeState({ info: { url: "https://example.com/" } });

    await Download.renameAndDownload(state);
    await flush();

    expect(state.info.naiveFilename).toBe("");
    expect(state.info.initialFilename).toBe("https://example.com/");
  });
});

describe("renameAndDownload: needRouteMatch", () => {
  test("returns early without downloading when no route matched", async () => {
    g.CURRENT_BROWSER = "CHROME";
    const state = makeState({ needRouteMatch: true });

    await Download.renameAndDownload(state);
    await flush();

    expect(g.browser.downloads.download).not.toHaveBeenCalled();
    expect(g.Messaging.emit.downloaded).not.toHaveBeenCalled();
    expect(g.SaveHistory.add).not.toHaveBeenCalled();
  });

  test("proceeds when needRouteMatch is true and a route matched", async () => {
    g.CURRENT_BROWSER = "CHROME";
    g.options.filenamePatterns = [["rule"]];
    g.Router.matchRules = jest.fn(() => "matched/route.txt");

    const state = makeState({ needRouteMatch: true });
    await Download.renameAndDownload(state);
    await flush();

    expect(g.browser.downloads.download).toHaveBeenCalled();
  });

  test("proceeds when needRouteMatch is false even without a route", async () => {
    g.CURRENT_BROWSER = "CHROME";
    const state = makeState({ needRouteMatch: false });

    await Download.renameAndDownload(state);
    await flush();

    expect(g.browser.downloads.download).toHaveBeenCalled();
  });
});

describe("renameAndDownload: route matching", () => {
  test("builds state.route from Router.matchRules and uses it in the final path", async () => {
    g.CURRENT_BROWSER = "CHROME";
    g.options.filenamePatterns = [["rule"]];
    g.Router.matchRules = jest.fn(() => "matched/route.txt");

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(g.Router.matchRules).toHaveBeenCalledWith(g.options.filenamePatterns, state.info);
    expect(state.route).toBeDefined();
    expect(String(state.route.finalize())).toBe("matched/route.txt");

    await flush();
    expect(g.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ filename: expect.stringContaining("matched/route.txt") }),
    );
  });
});

describe("renameAndDownload: prompt combinations", () => {
  const expectSaveAs = async (state: any, expected: boolean) => {
    await Download.renameAndDownload(state);
    await flush();
    expect(g.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ saveAs: expected }),
    );
  };

  test("options.prompt forces saveAs", async () => {
    g.CURRENT_BROWSER = "CHROME";
    g.options.prompt = true;
    await expectSaveAs(makeState(), true);
  });

  test("promptIfNoExtension prompts when the final filename has no extension", async () => {
    g.CURRENT_BROWSER = "CHROME";
    g.options.promptIfNoExtension = true;
    const state = makeState({ info: { url: "https://example.com/dir/noext" } });
    await expectSaveAs(state, true);
  });

  test("promptOnShift prompts when the Shift modifier was held", async () => {
    g.CURRENT_BROWSER = "CHROME";
    g.options.promptOnShift = true;
    const state = makeState({ info: { modifiers: ["Shift"] } });
    await expectSaveAs(state, true);
  });

  test("routeFailurePrompt prompts when no rule matched", async () => {
    g.CURRENT_BROWSER = "CHROME";
    g.options.routeFailurePrompt = true;
    await expectSaveAs(makeState(), true);
  });

  test("saveAs is falsy when no prompt condition is met", async () => {
    g.CURRENT_BROWSER = "CHROME";
    await expectSaveAs(makeState(), false);
  });
});

describe("renameAndDownload: browserDownload", () => {
  test("prepares the referer, persists session state, downloads, and tracks the result", async () => {
    g.CURRENT_BROWSER = "CHROME";
    g.browser.downloads.download = jest.fn(() => Promise.resolve(555));

    const state = makeState();
    await Download.renameAndDownload(state);
    await flush();

    expect(g.RequestHeaders.prepareReferer).toHaveBeenCalledWith(state);
    // pending counter + per-URL filename map are updated (see the session-
    // restart recovery tests for the values)
    expect(g.SessionState.update).toHaveBeenCalledWith("siPendingDownloads", expect.any(Function));
    expect(g.SessionState.update).toHaveBeenCalledWith("siFinalFilenames", expect.any(Function));
    expect(g.browser.downloads.download).toHaveBeenCalledWith({
      url: state.info.url,
      filename: expect.any(String),
      saveAs: false,
      conflictAction: "uniquify",
    });
    // download.js adopts its own download (the record is what the notifier
    // watches for a completion toast)
    expect(DownloadState.records.get(555)).toMatchObject({ adopted: true });
    // incremented then cleared -> back to 0, and the filename key removed
    expect(g.sessionStore.siPendingDownloads).toBe(0);
    expect(g.sessionStore.siFinalFilenames).toEqual({});
  });

  test("logs a downloads.download rejection and still clears the pending flag", async () => {
    g.CURRENT_BROWSER = "CHROME";
    g.browser.downloads.download = jest.fn(() => Promise.reject(new Error("disk full")));

    const state = makeState();
    await Download.renameAndDownload(state);
    await flush();

    // a fully failed download registers no adopted record
    expect([...DownloadState.records.values()].some((r) => r.adopted)).toBe(false);
    expect(g.Log.add).toHaveBeenCalledWith("downloads.download failed", "Error: disk full");
    expect(g.sessionStore.siPendingDownloads).toBe(0);
  });

  test("a downloads.download rejection does not throw when Log is undefined", async () => {
    g.CURRENT_BROWSER = "CHROME";
    g.browser.downloads.download = jest.fn(() => Promise.reject(new Error("disk full")));
    const originalLog = g.Log;
    delete g.Log;

    const state = makeState();
    expect(() => Download.renameAndDownload(state)).not.toThrow();
    await flush();

    expect([...DownloadState.records.values()].some((r) => r.adopted)).toBe(false);
    expect(g.sessionStore.siPendingDownloads).toBe(0);
    g.Log = originalLog;
  });

  test("substitutes _ for an empty final path", async () => {
    g.CURRENT_BROWSER = "CHROME";
    g.Path.sanitizeFilename = jest.fn(() => null);

    const state = makeState({ path: { finalize: () => null } });
    await Download.renameAndDownload(state);
    await flush();

    // the filename-map update stores "_" for this download's URL
    const fnameUpdate = g.SessionState.update.mock.calls.find((c) => c[0] === "siFinalFilenames");
    expect(fnameUpdate[1]({})).toEqual({ [state.info.url]: "_" });
    expect(g.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "_" }),
    );
  });

  test("emits downloaded, records lastDownloadState, and saves history", async () => {
    g.CURRENT_BROWSER = "CHROME";
    const state = makeState();

    await Download.renameAndDownload(state);

    expect(g.Messaging.emit.downloaded).toHaveBeenCalledWith(state);
    expect(window.lastDownloadState).toBe(state);
    expect(g.SaveHistory.add).toHaveBeenCalledWith(
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
    g.CURRENT_BROWSER = "CHROME";
    g.options.fetchViaFetch = true;
    g.fetch = jest.fn(() =>
      Promise.resolve({ blob: () => Promise.resolve(new Blob(["file contents"])) }),
    );

    const state = makeState();
    await Download.renameAndDownload(state);
    await flush();

    expect(g.fetch).toHaveBeenCalledWith(state.info.url, { credentials: "include" });
    expect(g.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringMatching(/^blob:/) }),
    );
  });

  test("Chrome offscreen: fetches via the offscreen document and downloads the blob URL", async () => {
    g.CURRENT_BROWSER = "CHROME";
    g.options.fetchViaFetch = true;
    const origCanUse = OffscreenClient.canUse;
    const origFetch = OffscreenClient.fetch;
    OffscreenClient.canUse = jest.fn(() => true);
    OffscreenClient.fetch = jest.fn(() => Promise.resolve("blob:offscreen-url"));
    try {
      const state = makeState();
      await Download.renameAndDownload(state);
      await flush();

      expect(OffscreenClient.fetch).toHaveBeenCalledWith(state.info.url);
      expect(g.browser.downloads.download).toHaveBeenCalledWith(
        expect.objectContaining({ url: "blob:offscreen-url" }),
      );
    } finally {
      OffscreenClient.canUse = origCanUse;
      OffscreenClient.fetch = origFetch;
    }
  });

  test("Chrome offscreen: falls back to a direct download when the offscreen fetch fails", async () => {
    g.CURRENT_BROWSER = "CHROME";
    g.options.fetchViaFetch = true;
    const origCanUse = OffscreenClient.canUse;
    const origFetch = OffscreenClient.fetch;
    OffscreenClient.canUse = jest.fn(() => true);
    OffscreenClient.fetch = jest.fn(() => Promise.reject(new Error("offscreen boom")));
    try {
      const state = makeState();
      await Download.renameAndDownload(state);
      await flush();

      expect(g.Log.add).toHaveBeenCalledWith(
        "offscreen fetch failed",
        expect.stringContaining("offscreen boom"),
      );
      expect(g.browser.downloads.download).toHaveBeenCalledWith(
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
    g.CURRENT_BROWSER = "CHROME";
    g.options.filenamePatterns = [["rule"]];
    g.Router.matchRules = jest.fn(() => "matched/route.txt");
    g.options.notifyOnRuleMatch = true;

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(g.Notifier.createExtensionNotification).toHaveBeenCalledWith(
      "notificationRuleMatchedTitle",
      "file.png\n⬇\nmatched/route.txt",
      false,
    );
  });

  test("does not notify on rule match when notifyOnRuleMatch is disabled", async () => {
    g.CURRENT_BROWSER = "CHROME";
    g.options.filenamePatterns = [["rule"]];
    g.Router.matchRules = jest.fn(() => "matched/route.txt");
    g.options.notifyOnRuleMatch = false;

    await Download.renameAndDownload(makeState());
    expect(g.Notifier.createExtensionNotification).not.toHaveBeenCalled();
  });

  test("notifies failure when routeExclusive+notifyOnFailure are enabled and no route matched", async () => {
    g.CURRENT_BROWSER = "CHROME";
    g.options.routeExclusive = true;
    g.options.notifyOnFailure = true;

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(g.Notifier.createExtensionNotification).toHaveBeenCalledWith(
      "notificationRuleMatchFailedExclusiveTitle",
      "notificationRuleMatchFailedExclusiveMessage",
      true,
    );
  });

  test("does not notify failure when routeExclusive is disabled", async () => {
    g.CURRENT_BROWSER = "CHROME";
    g.options.routeExclusive = false;
    g.options.notifyOnFailure = true;

    await Download.renameAndDownload(makeState());
    expect(g.Notifier.createExtensionNotification).not.toHaveBeenCalled();
  });
});

describe("renameAndDownload: Log integration", () => {
  test("logs 'download requested' when Log is defined", async () => {
    g.CURRENT_BROWSER = "CHROME";
    const state = makeState();

    await Download.renameAndDownload(state);

    expect(g.Log.add).toHaveBeenCalledWith(
      "download requested",
      expect.objectContaining({ url: expect.any(String), path: expect.any(String), route: null }),
    );
  });

  test("does not throw when Log is undefined", async () => {
    g.CURRENT_BROWSER = "CHROME";
    const originalLog = g.Log;
    delete g.Log;

    const state = makeState();
    expect(() => Download.renameAndDownload(state)).not.toThrow();
    await flush();

    expect(g.browser.downloads.download).toHaveBeenCalled();
    g.Log = originalLog;
  });
});

describe("renameAndDownload: window.SI_DEBUG", () => {
  test("logs debug info when window.SI_DEBUG is set", async () => {
    g.CURRENT_BROWSER = "CHROME";
    window.SI_DEBUG = true;
    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    await Download.renameAndDownload(makeState());

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
    window.SI_DEBUG = false;
  });
});

describe("onDeterminingFilename listener: sync path", () => {
  test("suggests the finalized path when globalChromeState already has a path", async () => {
    g.CURRENT_BROWSER = "CHROME";
    const state = makeState();

    // Drives globalChromeState (module-local) via renameAndDownload
    await Download.renameAndDownload(state);
    await flush();

    const suggest = jest.fn();
    const returned = capturedListener(
      { byExtensionId: g.browser.runtime.id, filename: "from-download-item.bin" },
      suggest,
    );

    expect(returned).toBe(false);
    expect(suggest).toHaveBeenCalledWith({
      filename: Download.finalizeFullPath(state),
      conflictAction: g.options.conflictAction,
    });
  });

  test("prefers the state's suggestedFilename over the download item's filename", async () => {
    g.CURRENT_BROWSER = "CHROME";
    const state = makeState({ info: { suggestedFilename: "suggested.txt" } });

    await Download.renameAndDownload(state);
    await flush();

    const suggest = jest.fn();
    capturedListener(
      { byExtensionId: g.browser.runtime.id, filename: "from-download-item.bin" },
      suggest,
    );

    expect(suggest).toHaveBeenCalledWith({
      filename: "downloads/suggested.txt",
      conflictAction: "uniquify",
    });
  });

  test("keeps the state's filename when the download item has none", async () => {
    g.CURRENT_BROWSER = "CHROME";
    const state = makeState();

    await Download.renameAndDownload(state);
    await flush();

    const suggest = jest.fn();
    capturedListener({ byExtensionId: g.browser.runtime.id, filename: undefined }, suggest);

    expect(suggest).toHaveBeenCalledWith({
      filename: "downloads/file.png",
      conflictAction: "uniquify",
    });
  });

  test("recreates missing state info from the download item", async () => {
    g.CURRENT_BROWSER = "CHROME";
    const state = makeState();

    await Download.renameAndDownload(state);
    await flush();

    // globalChromeState is a reference to this same state object: clearing
    // info here simulates a state that lost it before the event fired
    delete state.info;

    const suggest = jest.fn();
    const returned = capturedListener(
      { byExtensionId: g.browser.runtime.id, filename: "item.bin" },
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
  let sessionStore: any;

  beforeEach(async () => {
    vi.resetModules();
    sessionStore = {};
    g.chrome = {
      downloads: { onDeterminingFilename: { addListener: vi.fn() } },
    };
    g.browser = {
      runtime: { id: "self-extension-id" },
      downloads: { download: vi.fn(() => Promise.resolve(1)) },
      // The file-level beforeEach of earlier describes touches these
      i18n: { getMessage: vi.fn((k) => k) },
      storage: { local: {}, session: {} },
    };
    g.BROWSERS = { CHROME: "CHROME", FIREFOX: "FIREFOX" };
    g.CURRENT_BROWSER = "CHROME";
    g.window = global;
    g.options = { conflictAction: "uniquify", filenamePatterns: [] };
    g.Path = {
      Path: function FakePath(raw) {
        this.raw = raw;
      },
      sanitizeFilename: (v) => v,
    };
    g.Variable = { applyVariables: (p) => p };
    g.Router = { matchRules: () => null };
    g.RequestHeaders = { prepareReferer: vi.fn(() => Promise.resolve()) };
    g.Messaging = { emit: { downloaded: vi.fn() }, send: {} };
    g.Notifier = {
      createExtensionNotification: vi.fn(),
      expectDownload: vi.fn(),
    };
    g.SaveHistory = { add: vi.fn(), setDownloadId: vi.fn() };
    g.SessionState = {
      available: () => true,
      get: vi.fn((key) => Promise.resolve({ [key]: sessionStore[key] })),
      set: vi.fn((obj) => {
        Object.assign(sessionStore, obj);
        return Promise.resolve();
      }),
      update: vi.fn((key, fn) => {
        sessionStore[key] = fn(sessionStore[key]);
        return Promise.resolve();
      }),
    };
    delete g.Log;

    Download = (await import("../src/download.ts")).Download;
    [[listener]] = g.chrome.downloads.onDeterminingFilename.addListener.mock.calls;
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
    Download.renameAndDownload = jest.fn(() => Promise.reject(new Error("kaboom")));
    try {
      await expect(
        Download.launch(makeState({ info: { suggestedFilename: "x.png" } })),
      ).resolves.toBeUndefined();

      expect(g.Log.add).toHaveBeenCalledWith(
        "renameAndDownload failed",
        expect.stringContaining("kaboom"),
      );
      expect(g.Notifier.reportFailure).toHaveBeenCalledWith(
        "x.png",
        expect.stringContaining("kaboom"),
      );
    } finally {
      Download.renameAndDownload = orig;
    }
  });

  test("reports nothing on a successful pipeline run", async () => {
    const orig = Download.renameAndDownload;
    Download.renameAndDownload = jest.fn(() => Promise.resolve());
    try {
      await Download.launch(makeState());
      expect(g.Notifier.reportFailure).not.toHaveBeenCalled();
    } finally {
      Download.renameAndDownload = orig;
    }
  });
});

describe("terminal browserDownload failure surfaces to the user", () => {
  test("reports a failure when downloads.download rejects and the fallback is off", async () => {
    g.CURRENT_BROWSER = "CHROME";
    g.options.fallbackFetch = false;
    g.browser.downloads.download = jest.fn(() => Promise.reject(new Error("disk full")));

    await Download.renameAndDownload(makeState());
    await flush();

    expect(g.Notifier.reportFailure).toHaveBeenCalledWith(
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
    await flush();
  };

  beforeEach(() => {
    DownloadState.records.clear();
    Download.pendingRetryFilenames.clear();
    g.options.fallbackFetch = true;
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

    g.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["bytes"])) }),
    );
    g.browser.downloads.download = jest.fn(() => Promise.resolve(202));

    const retried = await Download.retryViaFetch(101);

    expect(retried).toBe(true);
    expect(g.fetch).toHaveBeenCalledWith("https://example.com/dir/file.png", {
      credentials: "include",
    });
    // The referer rule is re-armed for the retry
    expect(g.RequestHeaders.prepareReferer).toHaveBeenCalledWith({
      info: { url: "https://example.com/dir/file.png", pageUrl: "https://example.com/page" },
    });
    expect(g.browser.downloads.download).toHaveBeenCalledWith({
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
    expect(g.sessionStore.siDownloads[101]).toMatchObject({
      url: "https://example.com/dir/file.png",
      filename: "downloads/file.png",
    });

    // a restart wipes the in-memory map; storage.session survives
    DownloadState.records.clear();
    expect(await Download.getStartedDownload(101)).toMatchObject({
      url: "https://example.com/dir/file.png",
    });

    g.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["bytes"])) }),
    );
    g.browser.downloads.download = jest.fn(() => Promise.resolve(303));

    // the fetch-retry still works even though the in-memory record is gone
    await expect(Download.retryViaFetch(101)).resolves.toBe(true);
    expect(g.browser.downloads.download).toHaveBeenCalled();
  });

  test("never retries downloads that already went through a fetch", async () => {
    DownloadState.records.set(7, {
      url: "https://x/y.png",
      filename: "y.png",
      viaFetch: true,
      retried: false,
    });
    g.fetch = jest.fn();

    await expect(Download.retryViaFetch(7)).resolves.toBe(false);
    expect(g.fetch).not.toHaveBeenCalled();
  });

  test("does nothing when the option is disabled", async () => {
    await seedStartedDownload();
    g.options.fallbackFetch = false;
    g.fetch = jest.fn();

    await expect(Download.retryViaFetch(101)).resolves.toBe(false);
    expect(g.fetch).not.toHaveBeenCalled();
  });

  test("an HTTP error response does not start a second download", async () => {
    await seedStartedDownload();
    g.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 403 }));
    g.browser.downloads.download = jest.fn();

    await expect(Download.retryViaFetch(101)).resolves.toBe(false);
    expect(g.browser.downloads.download).not.toHaveBeenCalled();
  });

  test("unknown download ids resolve false", async () => {
    await expect(Download.retryViaFetch(999)).resolves.toBe(false);
  });

  test("an immediately rejected downloads.download falls back to fetch once", async () => {
    g.CURRENT_BROWSER = "CHROME";
    g.browser.downloads.download = jest
      .fn()
      .mockRejectedValueOnce(new Error("data: URLs are not supported"))
      .mockResolvedValue(303);
    g.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["bytes"])) }),
    );

    await Download.renameAndDownload(makeState());
    await flush(30);

    expect(g.browser.downloads.download).toHaveBeenCalledTimes(2);
    expect(g.browser.downloads.download.mock.calls[1][0].url).toMatch(/^blob:/);
    expect(DownloadState.records.get(303)).toMatchObject({ viaFetch: true });
  });

  test("immediate rejection does not fall back when disabled", async () => {
    g.CURRENT_BROWSER = "CHROME";
    g.options.fallbackFetch = false;
    g.browser.downloads.download = jest.fn(() => Promise.reject(new Error("nope")));
    g.fetch = jest.fn();

    await Download.renameAndDownload(makeState());
    await flush();

    expect(g.browser.downloads.download).toHaveBeenCalledTimes(1);
    expect(g.fetch).not.toHaveBeenCalled();
  });
});

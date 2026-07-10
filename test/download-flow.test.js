// renameAndDownload end-to-end flow: Chrome vs Firefox entry points, prompt
// combinations, routing, the browserDownload/fetchDownload/fetchViaContent
// closures, notification triggers, and the onDeterminingFilename sync path.
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

// These are read at module-import time (chrome.downloads.onDeterminingFilename
// presence) as well as at call time, so they must exist before the import.
global.BROWSERS = { CHROME: "CHROME", FIREFOX: "FIREFOX", UNKNOWN: "UNKNOWN" };
global.CURRENT_BROWSER = "FIREFOX";

global.chrome = {
  downloads: {
    onDeterminingFilename: { addListener: jest.fn() },
  },
};
global.browser = {
  runtime: { id: "self-extension-id" },
  i18n: { getMessage: jest.fn((key) => key) },
  downloads: { download: jest.fn(() => Promise.resolve(101)) },
};

const Download = (await import("../src/download.js")).default;

const [[capturedListener]] = global.chrome.downloads.onDeterminingFilename.addListener.mock.calls;

const makeState = (overrides = {}) => ({
  path: { finalize: () => "downloads" },
  scratch: {},
  ...overrides,
  info: {
    url: "https://example.com/dir/file.png",
    ...overrides.info,
  },
});

beforeEach(() => {
  global.CURRENT_BROWSER = "FIREFOX";

  global.options = {
    filenamePatterns: [],
    prompt: false,
    promptIfNoExtension: false,
    promptOnShift: false,
    routeFailurePrompt: false,
    routeExclusive: false,
    notifyOnRuleMatch: false,
    notifyOnFailure: false,
    conflictAction: "uniquify",
    fetchViaContent: false,
    fetchViaFetch: false,
  };

  global.Path = {
    Path: class MockPath {
      constructor(val) {
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

  global.Router = { matchRules: jest.fn(() => null) };
  global.Variable = { applyVariables: jest.fn((path) => path) };

  global.Messaging = {
    send: {
      fetchViaContent: jest.fn(() => Promise.resolve({ body: { blob: new Blob(["x"]) } })),
    },
    emit: { downloaded: jest.fn() },
  };

  global.Notifier = {
    trackDownload: jest.fn(() => Promise.resolve()),
    createExtensionNotification: jest.fn(),
    expectDownload: jest.fn(),
  };

  global.RequestHeaders = { prepareReferer: jest.fn(() => Promise.resolve()) };
  global.sessionStore = {};
  global.SessionState = {
    set: jest.fn((obj) => {
      Object.assign(global.sessionStore, obj);
      return Promise.resolve();
    }),
    get: jest.fn((key) =>
      Promise.resolve(key in global.sessionStore ? { [key]: global.sessionStore[key] } : {}),
    ),
    update: jest.fn((key, fn) => {
      global.sessionStore[key] = fn(global.sessionStore[key]);
      return Promise.resolve();
    }),
  };
  global.SaveHistory = { add: jest.fn(() => Promise.resolve()) };
  global.Log = { add: jest.fn() };

  global.browser.i18n.getMessage = jest.fn((key) => key);
  global.browser.downloads.download = jest.fn(() => Promise.resolve(101));

  global.getFilenameFromContentDispositionHeader = jest.fn(() => null);
  global.fetch = jest.fn(() => Promise.resolve({ headers: { has: () => false, get: () => null } }));

  window.SI_DEBUG = false;
  window.lastDownloadState = undefined;
});

describe("getFilenameFromContentDisposition", () => {
  test("returns null for non-string input", () => {
    expect(Download.getFilenameFromContentDisposition(undefined)).toBe(null);
    expect(Download.getFilenameFromContentDisposition(123)).toBe(null);
    expect(Download.getFilenameFromContentDisposition(null)).toBe(null);
  });

  test("double-decodes the value returned by the library", () => {
    // "na me.txt" URI-encoded twice
    global.getFilenameFromContentDispositionHeader = jest.fn(() => "na%2520me.txt");
    expect(Download.getFilenameFromContentDisposition("attachment; filename=whatever")).toBe(
      "na me.txt",
    );
  });

  test("keeps filenames with a literal % that is not an escape", () => {
    global.getFilenameFromContentDispositionHeader = jest.fn(() => "50%.txt");
    expect(Download.getFilenameFromContentDisposition("attachment; filename=whatever")).toBe(
      "50%.txt",
    );
  });

  test("stops decoding when a second pass would fail", () => {
    // one valid decode, then the result is no longer a valid escape sequence
    global.getFilenameFromContentDispositionHeader = jest.fn(() => "%2550%25.txt");
    expect(Download.getFilenameFromContentDisposition("attachment; filename=whatever")).toBe(
      "%50%.txt",
    );
  });

  test("returns null when the library returns a falsy value", () => {
    global.getFilenameFromContentDispositionHeader = jest.fn(() => null);
    expect(Download.getFilenameFromContentDisposition("attachment")).toBe(null);

    global.getFilenameFromContentDispositionHeader = jest.fn(() => "");
    expect(Download.getFilenameFromContentDisposition("attachment")).toBe(null);
  });
});

describe("getRoutingMatches", () => {
  test("returns null when there are no filename patterns", () => {
    global.options.filenamePatterns = undefined;
    expect(Download.getRoutingMatches({ info: {} })).toBe(null);

    global.options.filenamePatterns = [];
    expect(Download.getRoutingMatches({ info: {} })).toBe(null);

    expect(global.Router.matchRules).not.toHaveBeenCalled();
  });

  test("delegates to Router.matchRules when patterns exist", () => {
    global.options.filenamePatterns = [["rule"]];
    global.Router.matchRules = jest.fn(() => "the/route");
    const state = { info: { url: "x" } };

    expect(Download.getRoutingMatches(state)).toBe("the/route");
    expect(global.Router.matchRules).toHaveBeenCalledWith(
      global.options.filenamePatterns,
      state.info,
    );
  });
});

describe("finalizeFullPath", () => {
  test("strips a leading ./ and uses the sanitized filename when there is no route", () => {
    global.Path.sanitizeFilename = jest.fn(() => "sanitized.txt");
    const state = {
      path: { finalize: () => "./some/dir" },
      info: { filename: "raw.txt" },
    };

    expect(Download.finalizeFullPath(state)).toBe("some/dir/sanitized.txt");
    expect(global.Path.sanitizeFilename).toHaveBeenCalledWith("raw.txt");
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

describe("renameAndDownload: Chrome vs Firefox entry", () => {
  test("Chrome path skips the HEAD request and downloads immediately", async () => {
    global.CURRENT_BROWSER = "CHROME";
    const state = makeState();

    await Download.renameAndDownload(state);
    expect(global.fetch).not.toHaveBeenCalled();

    await flush();
    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ url: state.info.url }),
    );
  });

  test("Firefox path performs a HEAD request and applies the Content-Disposition filename", async () => {
    global.CURRENT_BROWSER = "FIREFOX";
    global.getFilenameFromContentDispositionHeader = jest.fn(() => "server-name.pdf");
    global.fetch = jest.fn(() =>
      Promise.resolve({
        headers: { has: () => true, get: () => 'attachment; filename="server-name.pdf"' },
      }),
    );

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(global.fetch).toHaveBeenCalledWith(state.info.url, {
      method: "HEAD",
      credentials: "include",
    });

    await flush();
    expect(state.info.filename).toBe("server-name.pdf");
    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ filename: expect.stringContaining("server-name.pdf") }),
    );
  });

  test("Firefox path keeps the original filename when the Content-Disposition has no usable name", async () => {
    global.CURRENT_BROWSER = "FIREFOX";
    global.getFilenameFromContentDispositionHeader = jest.fn(() => null);
    global.fetch = jest.fn(() =>
      Promise.resolve({ headers: { has: () => true, get: () => "attachment" } }),
    );

    const state = makeState();
    await Download.renameAndDownload(state);
    await flush();

    expect(state.info.filename).toBe("file.png");
    expect(global.browser.downloads.download).toHaveBeenCalled();
  });

  test("Firefox path keeps the original filename when Content-Disposition is absent", async () => {
    global.CURRENT_BROWSER = "FIREFOX";
    global.fetch = jest.fn(() =>
      Promise.resolve({ headers: { has: () => false, get: () => null } }),
    );

    const state = makeState();
    await Download.renameAndDownload(state);
    await flush();

    expect(state.info.filename).toBe("file.png");
    expect(global.getFilenameFromContentDispositionHeader).not.toHaveBeenCalled();
    expect(global.browser.downloads.download).toHaveBeenCalled();
  });

  test("Firefox path downloads anyway when the HEAD request rejects", async () => {
    global.CURRENT_BROWSER = "FIREFOX";
    global.fetch = jest.fn(() => Promise.reject(new Error("network down")));

    const state = makeState();
    await Download.renameAndDownload(state);
    await flush();

    expect(global.browser.downloads.download).toHaveBeenCalled();
  });
});

describe("renameAndDownload: initial filename resolution", () => {
  test("prefers info.suggestedFilename over the URL-derived filename", async () => {
    global.CURRENT_BROWSER = "CHROME";
    const state = makeState({ info: { suggestedFilename: "suggested.txt" } });

    await Download.renameAndDownload(state);
    await flush();

    expect(state.info.naiveFilename).toBe("file.png");
    expect(state.info.initialFilename).toBe("suggested.txt");
    expect(state.info.filename).toBe("suggested.txt");
  });

  test("falls back to the full URL when the URL has no filename component", async () => {
    global.CURRENT_BROWSER = "CHROME";
    const state = makeState({ info: { url: "https://example.com/" } });

    await Download.renameAndDownload(state);
    await flush();

    expect(state.info.naiveFilename).toBe("");
    expect(state.info.initialFilename).toBe("https://example.com/");
  });
});

describe("renameAndDownload: needRouteMatch", () => {
  test("returns early without downloading when no route matched", async () => {
    global.CURRENT_BROWSER = "CHROME";
    const state = makeState({ needRouteMatch: true });

    await Download.renameAndDownload(state);
    await flush();

    expect(global.browser.downloads.download).not.toHaveBeenCalled();
    expect(global.Messaging.emit.downloaded).not.toHaveBeenCalled();
    expect(global.SaveHistory.add).not.toHaveBeenCalled();
  });

  test("proceeds when needRouteMatch is true and a route matched", async () => {
    global.CURRENT_BROWSER = "CHROME";
    global.options.filenamePatterns = [["rule"]];
    global.Router.matchRules = jest.fn(() => "matched/route.txt");

    const state = makeState({ needRouteMatch: true });
    await Download.renameAndDownload(state);
    await flush();

    expect(global.browser.downloads.download).toHaveBeenCalled();
  });

  test("proceeds when needRouteMatch is false even without a route", async () => {
    global.CURRENT_BROWSER = "CHROME";
    const state = makeState({ needRouteMatch: false });

    await Download.renameAndDownload(state);
    await flush();

    expect(global.browser.downloads.download).toHaveBeenCalled();
  });
});

describe("renameAndDownload: route matching", () => {
  test("builds state.route from Router.matchRules and uses it in the final path", async () => {
    global.CURRENT_BROWSER = "CHROME";
    global.options.filenamePatterns = [["rule"]];
    global.Router.matchRules = jest.fn(() => "matched/route.txt");

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(global.Router.matchRules).toHaveBeenCalledWith(
      global.options.filenamePatterns,
      state.info,
    );
    expect(state.route).toBeDefined();
    expect(String(state.route.finalize())).toBe("matched/route.txt");

    await flush();
    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ filename: expect.stringContaining("matched/route.txt") }),
    );
  });
});

describe("renameAndDownload: prompt combinations", () => {
  const expectSaveAs = async (state, expected) => {
    await Download.renameAndDownload(state);
    await flush();
    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ saveAs: expected }),
    );
  };

  test("options.prompt forces saveAs", async () => {
    global.CURRENT_BROWSER = "CHROME";
    global.options.prompt = true;
    await expectSaveAs(makeState(), true);
  });

  test("promptIfNoExtension prompts when the final filename has no extension", async () => {
    global.CURRENT_BROWSER = "CHROME";
    global.options.promptIfNoExtension = true;
    const state = makeState({ info: { url: "https://example.com/dir/noext" } });
    await expectSaveAs(state, true);
  });

  test("promptOnShift prompts when the Shift modifier was held", async () => {
    global.CURRENT_BROWSER = "CHROME";
    global.options.promptOnShift = true;
    const state = makeState({ info: { modifiers: ["Shift"] } });
    await expectSaveAs(state, true);
  });

  test("routeFailurePrompt prompts when no rule matched", async () => {
    global.CURRENT_BROWSER = "CHROME";
    global.options.routeFailurePrompt = true;
    await expectSaveAs(makeState(), true);
  });

  test("saveAs is falsy when no prompt condition is met", async () => {
    global.CURRENT_BROWSER = "CHROME";
    await expectSaveAs(makeState(), false);
  });
});

describe("renameAndDownload: browserDownload", () => {
  test("prepares the referer, persists session state, downloads, and tracks the result", async () => {
    global.CURRENT_BROWSER = "CHROME";
    global.browser.downloads.download = jest.fn(() => Promise.resolve(555));

    const state = makeState();
    await Download.renameAndDownload(state);
    await flush();

    expect(global.RequestHeaders.prepareReferer).toHaveBeenCalledWith(state);
    // pending counter + per-URL filename map are updated (see the session-
    // restart recovery tests for the values)
    expect(global.SessionState.update).toHaveBeenCalledWith(
      "siPendingDownloads",
      expect.any(Function),
    );
    expect(global.SessionState.update).toHaveBeenCalledWith(
      "siFinalFilenames",
      expect.any(Function),
    );
    expect(global.browser.downloads.download).toHaveBeenCalledWith({
      url: state.info.url,
      filename: expect.any(String),
      saveAs: false,
      conflictAction: "uniquify",
    });
    expect(global.Notifier.trackDownload).toHaveBeenCalledWith(555);
    // incremented then cleared -> back to 0, and the filename key removed
    expect(global.sessionStore.siPendingDownloads).toBe(0);
    expect(global.sessionStore.siFinalFilenames).toEqual({});
  });

  test("logs a downloads.download rejection and still clears the pending flag", async () => {
    global.CURRENT_BROWSER = "CHROME";
    global.browser.downloads.download = jest.fn(() => Promise.reject(new Error("disk full")));

    const state = makeState();
    await Download.renameAndDownload(state);
    await flush();

    expect(global.Notifier.trackDownload).not.toHaveBeenCalled();
    expect(global.Log.add).toHaveBeenCalledWith("downloads.download failed", "Error: disk full");
    expect(global.sessionStore.siPendingDownloads).toBe(0);
  });

  test("a downloads.download rejection does not throw when Log is undefined", async () => {
    global.CURRENT_BROWSER = "CHROME";
    global.browser.downloads.download = jest.fn(() => Promise.reject(new Error("disk full")));
    const originalLog = global.Log;
    delete global.Log;

    const state = makeState();
    expect(() => Download.renameAndDownload(state)).not.toThrow();
    await flush();

    expect(global.Notifier.trackDownload).not.toHaveBeenCalled();
    expect(global.sessionStore.siPendingDownloads).toBe(0);
    global.Log = originalLog;
  });

  test("substitutes _ for an empty final path", async () => {
    global.CURRENT_BROWSER = "CHROME";
    global.Path.sanitizeFilename = jest.fn(() => null);

    const state = makeState({ path: { finalize: () => null } });
    await Download.renameAndDownload(state);
    await flush();

    // the filename-map update stores "_" for this download's URL
    const fnameUpdate = global.SessionState.update.mock.calls.find(
      (c) => c[0] === "siFinalFilenames",
    );
    expect(fnameUpdate[1]({})).toEqual({ [state.info.url]: "_" });
    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "_" }),
    );
  });

  test("emits downloaded, records lastDownloadState, and saves history", async () => {
    global.CURRENT_BROWSER = "CHROME";
    const state = makeState();

    await Download.renameAndDownload(state);

    expect(global.Messaging.emit.downloaded).toHaveBeenCalledWith(state);
    expect(window.lastDownloadState).toBe(state);
    expect(global.SaveHistory.add).toHaveBeenCalledWith(
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
    global.CURRENT_BROWSER = "CHROME";
    global.options.fetchViaFetch = true;
    global.fetch = jest.fn(() =>
      Promise.resolve({ blob: () => Promise.resolve(new Blob(["file contents"])) }),
    );

    const state = makeState();
    await Download.renameAndDownload(state);
    await flush();

    expect(global.fetch).toHaveBeenCalledWith(state.info.url, { credentials: "include" });
    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringMatching(/^blob:/) }),
    );
  });
});

describe("renameAndDownload: fetchViaContent", () => {
  test("uses the content-script-fetched blob when it resolves", async () => {
    global.CURRENT_BROWSER = "CHROME";
    global.options.fetchViaContent = true;
    global.Messaging.send.fetchViaContent = jest.fn(() =>
      Promise.resolve({ body: { blob: new Blob(["from content script"]) } }),
    );

    const state = makeState();
    await Download.renameAndDownload(state);
    await flush();

    expect(global.Messaging.send.fetchViaContent).toHaveBeenCalledWith(state);
    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringMatching(/^blob:/) }),
    );
  });

  test("falls back to a direct browser download when fetchViaContent rejects", async () => {
    global.CURRENT_BROWSER = "CHROME";
    global.options.fetchViaContent = true;
    window.SI_DEBUG = false;
    global.Messaging.send.fetchViaContent = jest.fn(() =>
      Promise.reject(new Error("no content script")),
    );
    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    const state = makeState();
    await Download.renameAndDownload(state);
    await flush();

    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ url: state.info.url }),
    );
    expect(consoleSpy).not.toHaveBeenCalledWith("Failed to fetch via content", expect.anything());
    consoleSpy.mockRestore();
  });

  test("logs the failure when SI_DEBUG is enabled before falling back", async () => {
    global.CURRENT_BROWSER = "CHROME";
    global.options.fetchViaContent = true;
    window.SI_DEBUG = true;
    global.Messaging.send.fetchViaContent = jest.fn(() =>
      Promise.reject(new Error("no content script")),
    );
    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    const state = makeState();
    await Download.renameAndDownload(state);
    await flush();

    expect(consoleSpy).toHaveBeenCalledWith("Failed to fetch via content", expect.any(Error));
    expect(global.browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ url: state.info.url }),
    );
    consoleSpy.mockRestore();
  });
});

describe("renameAndDownload: notification triggers", () => {
  test("notifies on rule match when a route was found and notifyOnRuleMatch is enabled", async () => {
    global.CURRENT_BROWSER = "CHROME";
    global.options.filenamePatterns = [["rule"]];
    global.Router.matchRules = jest.fn(() => "matched/route.txt");
    global.options.notifyOnRuleMatch = true;

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(global.Notifier.createExtensionNotification).toHaveBeenCalledWith(
      "notificationRuleMatchedTitle",
      "file.png\n⬇\nmatched/route.txt",
      false,
    );
  });

  test("does not notify on rule match when notifyOnRuleMatch is disabled", async () => {
    global.CURRENT_BROWSER = "CHROME";
    global.options.filenamePatterns = [["rule"]];
    global.Router.matchRules = jest.fn(() => "matched/route.txt");
    global.options.notifyOnRuleMatch = false;

    await Download.renameAndDownload(makeState());
    expect(global.Notifier.createExtensionNotification).not.toHaveBeenCalled();
  });

  test("notifies failure when routeExclusive+notifyOnFailure are enabled and no route matched", async () => {
    global.CURRENT_BROWSER = "CHROME";
    global.options.routeExclusive = true;
    global.options.notifyOnFailure = true;

    const state = makeState();
    await Download.renameAndDownload(state);

    expect(global.Notifier.createExtensionNotification).toHaveBeenCalledWith(
      "notificationRuleMatchFailedExclusiveTitle",
      "notificationRuleMatchFailedExclusiveMessage",
      true,
    );
  });

  test("does not notify failure when routeExclusive is disabled", async () => {
    global.CURRENT_BROWSER = "CHROME";
    global.options.routeExclusive = false;
    global.options.notifyOnFailure = true;

    await Download.renameAndDownload(makeState());
    expect(global.Notifier.createExtensionNotification).not.toHaveBeenCalled();
  });
});

describe("renameAndDownload: Log integration", () => {
  test("logs 'download requested' when Log is defined", async () => {
    global.CURRENT_BROWSER = "CHROME";
    const state = makeState();

    await Download.renameAndDownload(state);

    expect(global.Log.add).toHaveBeenCalledWith(
      "download requested",
      expect.objectContaining({ url: expect.any(String), path: expect.any(String), route: null }),
    );
  });

  test("does not throw when Log is undefined", async () => {
    global.CURRENT_BROWSER = "CHROME";
    const originalLog = global.Log;
    delete global.Log;

    const state = makeState();
    expect(() => Download.renameAndDownload(state)).not.toThrow();
    await flush();

    expect(global.browser.downloads.download).toHaveBeenCalled();
    global.Log = originalLog;
  });
});

describe("renameAndDownload: window.SI_DEBUG", () => {
  test("logs debug info when window.SI_DEBUG is set", async () => {
    global.CURRENT_BROWSER = "CHROME";
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
    global.CURRENT_BROWSER = "CHROME";
    const state = makeState();

    // Drives globalChromeState (module-local) via renameAndDownload
    await Download.renameAndDownload(state);
    await flush();

    const suggest = jest.fn();
    const returned = capturedListener(
      { byExtensionId: global.browser.runtime.id, filename: "from-download-item.bin" },
      suggest,
    );

    expect(returned).toBe(false);
    expect(suggest).toHaveBeenCalledWith({
      filename: Download.finalizeFullPath(state),
      conflictAction: global.options.conflictAction,
    });
  });

  test("prefers the state's suggestedFilename over the download item's filename", async () => {
    global.CURRENT_BROWSER = "CHROME";
    const state = makeState({ info: { suggestedFilename: "suggested.txt" } });

    await Download.renameAndDownload(state);
    await flush();

    const suggest = jest.fn();
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
    global.CURRENT_BROWSER = "CHROME";
    const state = makeState();

    await Download.renameAndDownload(state);
    await flush();

    const suggest = jest.fn();
    capturedListener({ byExtensionId: global.browser.runtime.id, filename: undefined }, suggest);

    expect(suggest).toHaveBeenCalledWith({
      filename: "downloads/file.png",
      conflictAction: "uniquify",
    });
  });

  test("recreates missing state info from the download item", async () => {
    global.CURRENT_BROWSER = "CHROME";
    const state = makeState();

    await Download.renameAndDownload(state);
    await flush();

    // globalChromeState is a reference to this same state object: clearing
    // info here simulates a state that lost it before the event fired
    delete state.info;

    const suggest = jest.fn();
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
  let Download;
  let listener;
  let sessionStore;

  beforeEach(async () => {
    vi.resetModules();
    sessionStore = {};
    global.chrome = {
      downloads: { onDeterminingFilename: { addListener: vi.fn() } },
    };
    global.browser = {
      runtime: { id: "self-extension-id" },
      downloads: { download: vi.fn(() => Promise.resolve(1)) },
      // The file-level beforeEach of earlier describes touches these
      i18n: { getMessage: vi.fn((k) => k) },
      storage: { local: {}, session: {} },
    };
    global.BROWSERS = { CHROME: "CHROME", FIREFOX: "FIREFOX" };
    global.CURRENT_BROWSER = "CHROME";
    global.window = global;
    global.options = { conflictAction: "uniquify", filenamePatterns: [] };
    global.Path = {
      Path: function FakePath(raw) {
        this.raw = raw;
      },
      sanitizeFilename: (v) => v,
    };
    global.Variable = { applyVariables: (p) => p };
    global.Router = { matchRules: () => null };
    global.RequestHeaders = { prepareReferer: vi.fn(() => Promise.resolve()) };
    global.Messaging = { emit: { downloaded: vi.fn() }, send: {} };
    global.Notifier = {
      trackDownload: vi.fn(),
      createExtensionNotification: vi.fn(),
      expectDownload: vi.fn(),
    };
    global.SaveHistory = { add: vi.fn() };
    global.SessionState = {
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
    delete global.Log;

    Download = (await import("../src/download.js")).default;
    [[listener]] = global.chrome.downloads.onDeterminingFilename.addListener.mock.calls;
  });

  const makeState = (url, dir, name) => ({
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

describe("automatic fetch fallback (retryViaFetch)", () => {
  const seedStartedDownload = async () => {
    const state = makeState({
      info: { url: "https://example.com/dir/file.png", pageUrl: "https://example.com/page" },
    });
    await Download.renameAndDownload(state);
    await flush();
  };

  beforeEach(() => {
    Download.startedDownloads.clear();
    Download.pendingRetryFilenames.clear();
    global.options.fallbackFetch = true;
  });

  test("started downloads are recorded with what a retry needs", async () => {
    await seedStartedDownload();

    expect(Download.startedDownloads.get(101)).toMatchObject({
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

    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["bytes"])) }),
    );
    global.browser.downloads.download = jest.fn(() => Promise.resolve(202));

    const retried = await Download.retryViaFetch(101);

    expect(retried).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith("https://example.com/dir/file.png", {
      credentials: "include",
    });
    // The referer rule is re-armed for the retry
    expect(global.RequestHeaders.prepareReferer).toHaveBeenCalledWith({
      info: { url: "https://example.com/dir/file.png", pageUrl: "https://example.com/page" },
    });
    expect(global.browser.downloads.download).toHaveBeenCalledWith({
      url: expect.stringMatching(/^blob:/),
      filename: "downloads/file.png",
      conflictAction: "uniquify",
    });
    expect(global.Notifier.trackDownload).toHaveBeenCalledWith(202);
    // The retry marks itself so a second failure cannot loop
    expect(Download.startedDownloads.get(202)).toMatchObject({ viaFetch: true });

    // Only one retry per download
    await expect(Download.retryViaFetch(101)).resolves.toBe(false);
  });

  test("never retries downloads that already went through a fetch", async () => {
    Download.startedDownloads.set(7, {
      url: "https://x/y.png",
      filename: "y.png",
      viaFetch: true,
      retried: false,
    });
    global.fetch = jest.fn();

    await expect(Download.retryViaFetch(7)).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("does nothing when the option is disabled", async () => {
    await seedStartedDownload();
    global.options.fallbackFetch = false;
    global.fetch = jest.fn();

    await expect(Download.retryViaFetch(101)).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("an HTTP error response does not start a second download", async () => {
    await seedStartedDownload();
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 403 }));
    global.browser.downloads.download = jest.fn();

    await expect(Download.retryViaFetch(101)).resolves.toBe(false);
    expect(global.browser.downloads.download).not.toHaveBeenCalled();
  });

  test("unknown download ids resolve false", async () => {
    await expect(Download.retryViaFetch(999)).resolves.toBe(false);
  });

  test("an immediately rejected downloads.download falls back to fetch once", async () => {
    global.CURRENT_BROWSER = "CHROME";
    global.browser.downloads.download = jest
      .fn()
      .mockRejectedValueOnce(new Error("data: URLs are not supported"))
      .mockResolvedValue(303);
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["bytes"])) }),
    );

    await Download.renameAndDownload(makeState());
    await flush(30);

    expect(global.browser.downloads.download).toHaveBeenCalledTimes(2);
    expect(global.browser.downloads.download.mock.calls[1][0].url).toMatch(/^blob:/);
    expect(Download.startedDownloads.get(303)).toMatchObject({ viaFetch: true });
  });

  test("immediate rejection does not fall back when disabled", async () => {
    global.CURRENT_BROWSER = "CHROME";
    global.options.fallbackFetch = false;
    global.browser.downloads.download = jest.fn(() => Promise.reject(new Error("nope")));
    global.fetch = jest.fn();

    await Download.renameAndDownload(makeState());
    await flush();

    expect(global.browser.downloads.download).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

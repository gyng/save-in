// Background messaging: routes messages from content scripts, the options
// page, and external extensions to options/downloads

const constants = (await import("../src/constants.js")).default;
Object.assign(global, constants);

// Capture the listeners registered at import time (jest-webextension-mock's
// runtime events dispatch through their own internal lists, so replace them)
global.browser.runtime.onMessage = { addListener: vi.fn() };
global.browser.runtime.onMessageExternal = { addListener: vi.fn() };

const Messaging = (await import("../src/messaging.js")).default;

const [[onMessage]] = global.browser.runtime.onMessage.addListener.mock.calls;
const [[onMessageExternal]] = global.browser.runtime.onMessageExternal.addListener.mock.calls;

function FakePath(raw) {
  this.raw = raw;
}

const setupGlobals = () => {
  global.currentTab = { id: 1, title: "Tracked Tab" };
  global.requestedDownloadFlag = 0;
  global.options = { conflictAction: "uniquify" };
  global.Path = { Path: FakePath };
  global.Download = { renameAndDownload: vi.fn() };
  global.Router = { matcherFunctions: { fileext: () => {}, pageurl: () => {} } };
  global.Variable = {
    transformers: { ":date:": () => {}, ":year:": () => {} },
    applyVariables: vi.fn((path) => ({ finalize: () => `interp:${path.raw}` })),
  };
  global.OptionsManagement = {
    OPTION_KEYS: [{ name: "prompt", type: "BOOL", default: false }],
    OPTION_TYPES: { BOOL: "BOOL", VALUE: "VALUE" },
    checkRoutes: vi.fn(() => ({ path: "routed/dir", captures: null })),
  };
  global.window.reset = vi.fn();
  global.window.optionErrors = { paths: [], filenamePatterns: [] };
  delete global.window.lastDownloadState;
  delete global.window.SI_DEBUG;
  global.browser.runtime.sendMessage = vi.fn();
  global.browser.tabs.query = vi.fn(() => Promise.resolve([{ id: 42 }]));
  global.browser.tabs.sendMessage = vi.fn(() => Promise.resolve());
};

beforeEach(() => {
  setupGlobals();
});

describe("listener registration", () => {
  test("registers onMessage and onMessageExternal listeners at import", () => {
    expect(global.browser.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
    expect(global.browser.runtime.onMessageExternal.addListener).toHaveBeenCalledTimes(1);
    expect(onMessage).toEqual(expect.any(Function));
    expect(onMessageExternal).toEqual(expect.any(Function));
  });
});

describe("onMessage", () => {
  test("WAKE_WARM responds OK", () => {
    const sendResponse = vi.fn();
    onMessage({ type: MESSAGE_TYPES.WAKE_WARM }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ type: MESSAGE_TYPES.OK });
  });

  test("OPTIONS_LOADED resets the background page and responds OK", () => {
    const sendResponse = vi.fn();
    onMessage({ type: MESSAGE_TYPES.OPTIONS_LOADED }, {}, sendResponse);
    expect(global.window.reset).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({ type: MESSAGE_TYPES.OK });
  });

  test("OPTIONS responds with the current options", () => {
    const sendResponse = vi.fn();
    onMessage({ type: MESSAGE_TYPES.OPTIONS }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.OPTIONS,
      body: global.options,
    });
  });

  test("OPTIONS_SCHEMA responds with option keys and types", () => {
    const sendResponse = vi.fn();
    onMessage({ type: MESSAGE_TYPES.OPTIONS_SCHEMA }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.OPTIONS_SCHEMA,
      body: {
        keys: global.OptionsManagement.OPTION_KEYS,
        types: global.OptionsManagement.OPTION_TYPES,
      },
    });
  });

  test("GET_KEYWORDS responds with matcher and variable names", () => {
    const sendResponse = vi.fn();
    onMessage({ type: MESSAGE_TYPES.GET_KEYWORDS }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.KEYWORD_LIST,
      body: {
        matchers: ["fileext", "pageurl"],
        variables: [":date:", ":year:"],
      },
    });
  });

  test("unknown message types are a no-op", () => {
    const sendResponse = vi.fn();
    onMessage({ type: "SOMETHING_ELSE" }, {}, sendResponse);
    onMessageExternal({ type: "SOMETHING_ELSE" }, {}, sendResponse);
    expect(sendResponse).not.toHaveBeenCalled();
  });
});

describe("onMessage CHECK_ROUTES", () => {
  test("uses the state supplied in the request body", () => {
    const state = { info: { filename: "f.png" } };
    const sendResponse = vi.fn();

    onMessage({ type: MESSAGE_TYPES.CHECK_ROUTES, body: { state } }, {}, sendResponse);

    expect(global.OptionsManagement.checkRoutes).toHaveBeenCalledWith(state);
    expect(global.Variable.applyVariables).toHaveBeenCalledWith(expect.any(FakePath), state.info);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.CHECK_ROUTES_RESPONSE,
      body: {
        optionErrors: global.window.optionErrors,
        routeInfo: { path: "routed/dir", captures: null },
        lastDownload: undefined,
        interpolatedVariables: { ":date:": "interp::date:", ":year:": "interp::year:" },
      },
    });
  });

  test("falls back to window.lastDownloadState without a state in the body", () => {
    const lastState = { info: { filename: "last.png" } };
    global.window.lastDownloadState = lastState;
    const sendResponse = vi.fn();

    onMessage({ type: MESSAGE_TYPES.CHECK_ROUTES, body: {} }, {}, sendResponse);

    expect(global.OptionsManagement.checkRoutes).toHaveBeenCalledWith(lastState);
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          lastDownload: lastState,
          interpolatedVariables: { ":date:": "interp::date:", ":year:": "interp::year:" },
        }),
      }),
    );
  });

  test("responds with null interpolations when there is no state at all", () => {
    global.window.lastDownloadState = null;
    const sendResponse = vi.fn();

    onMessage({ type: MESSAGE_TYPES.CHECK_ROUTES }, {}, sendResponse);

    expect(global.OptionsManagement.checkRoutes).toHaveBeenCalledWith(false);
    expect(global.Variable.applyVariables).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          lastDownload: null,
          interpolatedVariables: null,
        }),
      }),
    );
  });
});

describe("handleDownloadMessage", () => {
  const request = (overrides = {}) => ({
    type: MESSAGE_TYPES.DOWNLOAD,
    body: Object.assign(
      {
        url: "https://x/file.png",
        info: { pageUrl: "https://x/", srcUrl: "https://x/file.png" },
      },
      overrides,
    ),
  });

  test("tolerates an external message with no info object", () => {
    const sendResponse = vi.fn();
    expect(() =>
      onMessage(
        { type: MESSAGE_TYPES.DOWNLOAD, body: { url: "https://x/file.png" } },
        {},
        sendResponse,
      ),
    ).not.toThrow();
    expect(global.Download.renameAndDownload).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: { status: MESSAGE_TYPES.OK },
    });
  });

  test("downloads with defaults when no previous download state exists", () => {
    const sendResponse = vi.fn();
    onMessage(request(), {}, sendResponse);

    expect(Number(global.requestedDownloadFlag)).toBeGreaterThan(0);
    expect(global.Download.renameAndDownload).toHaveBeenCalledTimes(1);

    const state = global.Download.renameAndDownload.mock.calls[0][0];
    expect(state.path).toEqual(new FakePath("."));
    expect(state.scratch).toEqual({});
    expect(state.info.url).toBe("https://x/file.png");
    expect(state.info.pageUrl).toBe("https://x/");
    expect(state.info.sourceUrl).toBe("https://x/file.png");
    expect(state.info.context).toBe(DOWNLOAD_TYPES.CLICK);
    expect(state.info.now).toEqual(expect.any(Date));

    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: { status: MESSAGE_TYPES.OK },
    });
  });

  test("reuses the last path and routing metadata, never filenames or routes", () => {
    const lastPath = new FakePath("images/cats");
    global.window.lastDownloadState = {
      path: lastPath,
      scratch: { hasExtension: true },
      route: new FakePath("stale/route/from/other.png"),
      info: {
        comment: "0last",
        menuIndex: "1",
        suggestedFilename: "previous-download.png",
        filename: "previous-download.png",
      },
    };

    onMessage(request(), {}, vi.fn());

    const state = global.Download.renameAndDownload.mock.calls[0][0];
    expect(state.path).toBe(lastPath);
    // Inheriting the previous route, filename, or scratch would name this
    // download after the previous one (found live by the alt+click e2e)
    expect(state).not.toHaveProperty("route");
    expect(state.info.suggestedFilename).toBeUndefined();
    expect(state.info.filename).toBeUndefined();
    expect(state.scratch).toEqual({});
    // Routing metadata is kept so comment/menuindex rules stay usable
    expect(state.info.menuIndex).toBe("1");
    expect(state.info.comment).toBe("0last");
    expect(state.info.url).toBe("https://x/file.png");
  });

  test("falls back to the default path when the last state has none", () => {
    global.window.lastDownloadState = { scratch: {}, info: {} };

    onMessage(request(), {}, vi.fn());

    const state = global.Download.renameAndDownload.mock.calls[0][0];
    expect(state.path).toEqual(new FakePath("."));
  });

  test("prefers the sender's tab over the tracked global tab (#172)", () => {
    const senderTab = { id: 5, title: "Sender Tab" };
    onMessage(request(), { tab: senderTab }, vi.fn());

    const state = global.Download.renameAndDownload.mock.calls[0][0];
    expect(state.info.currentTab).toBe(senderTab);
  });

  test("falls back to the tracked tab when the sender has none", () => {
    onMessage(request(), {}, vi.fn());

    const state = global.Download.renameAndDownload.mock.calls[0][0];
    expect(state.info.currentTab).toBe(global.currentTab);
  });

  test("passes through a comment for routing rules (external extensions)", () => {
    onMessage(request({ comment: "from-foxy-gestures" }), {}, vi.fn());

    const state = global.Download.renameAndDownload.mock.calls[0][0];
    expect(state.info.comment).toBe("from-foxy-gestures");
  });

  test("omits the comment when none is supplied", () => {
    onMessage(request(), {}, vi.fn());

    const state = global.Download.renameAndDownload.mock.calls[0][0];
    expect(state.info.comment).toBeUndefined();
  });

  test("is reachable from external extensions via onMessageExternal", () => {
    const sendResponse = vi.fn();
    onMessageExternal(request(), { tab: { id: 9 } }, sendResponse);

    expect(global.Download.renameAndDownload).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: { status: MESSAGE_TYPES.OK },
    });
  });
});

describe("emit.downloaded", () => {
  test("fires a DOWNLOADED message and swallows a no-receiver rejection", async () => {
    global.browser.runtime.sendMessage = vi.fn(() =>
      Promise.reject(new Error("Receiving end does not exist")),
    );
    const state = { info: { url: "https://x/file.png" } };

    expect(() => Messaging.emit.downloaded(state)).not.toThrow();
    expect(global.browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOADED,
      body: { state },
    });
    // The rejection is caught, not left unhandled
    await Promise.resolve();
  });
});

describe("send.fetchViaContent", () => {
  test("sends the state to the active tab and resolves with its response", async () => {
    global.browser.tabs.sendMessage = vi.fn(() => Promise.resolve("fetched"));
    const state = { info: { url: "https://x/file.png" } };

    await expect(Messaging.send.fetchViaContent(state)).resolves.toBe("fetched");

    expect(global.browser.tabs.query).toHaveBeenCalledWith({
      currentWindow: true,
      active: true,
    });
    expect(global.browser.tabs.sendMessage).toHaveBeenCalledWith(42, {
      type: MESSAGE_TYPES.FETCH_VIA_CONTENT,
      body: { state },
    });
  });

  test("rejects when the content script cannot be reached", async () => {
    const err = new Error("no receiving end");
    global.browser.tabs.sendMessage = vi.fn(() => Promise.reject(err));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(Messaging.send.fetchViaContent({})).rejects.toBe(err);
    expect(logSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
  });

  test("logs the rejection when debugging is on", async () => {
    const err = new Error("no receiving end");
    global.browser.tabs.sendMessage = vi.fn(() => Promise.reject(err));
    global.window.SI_DEBUG = 1;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(Messaging.send.fetchViaContent({})).rejects.toBe(err);
    expect(logSpy).toHaveBeenCalledWith(err);

    logSpy.mockRestore();
  });
});

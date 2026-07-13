// Background messaging: routes messages from content scripts, the options
// page, and external extensions to options/downloads.
//
// messaging.ts registers its onMessage/onMessageExternal listeners at eval, so
// the fake listener objects below are installed before it (and the real SCC it
// pulls in) evaluates — hence the dynamic imports. Its deps are then imported
// for real and controlled through vi.spyOn (methods) / Object.assign (data, and
// real Path values): the handlers assert against controlled shapes — a
// two-key option schema, a fixed matcher/variable set, a stubbed
// router/interpolator — that the real 40-key config and live routing wouldn't
// match.

import { MESSAGE_TYPES, DOWNLOAD_TYPES } from "../src/shared/constants.ts";
import type { CurrentTab } from "../src/platform/current-tab.ts";
import { clearPersistenceDiagnostics } from "../src/shared/persistence-diagnostics.ts";

// Capture the listeners registerMessaging() attaches (the shared host fixture's
// runtime events dispatch through their own internal lists, so replace them).
// These must exist before registerMessaging() runs.
(global.browser.runtime as any).onMessage = { addListener: vi.fn() };
(global.browser.runtime as any).onMessageExternal = { addListener: vi.fn() };

const { Messaging, registerMessaging } = await import("../src/background/messaging.ts");
// Imported after the fakes above: messaging.ts already pulled the whole real SCC
// into the module cache, so these return the same instances its handlers hold —
// spies / Object.assign on them reach the live code.
const { OptionsManagement } = await import("../src/config/option.ts");
const { options } = await import("../src/config/options-data.ts");
const { Download } = await import("../src/downloads/download.ts");
const { Notifier } = await import("../src/downloads/notification.ts");
const Menus = await import("../src/background/menu-build.ts");
const router = await import("../src/routing/router.ts");
const Variable = await import("../src/routing/variable.ts");
const { Path } = await import("../src/routing/path.ts");
const { setCurrentTab } = await import("../src/platform/current-tab.ts");
const { backgroundRuntime } = await import("../src/background/runtime.ts");
const { SaveHistory } = await import("../src/background/history.ts");
const { ExternalDownloadRejections } =
  await import("../src/background/external-download-rejections.ts");
const SourcePanelState = await import("../src/background/source-panel-state.ts");
const RoutePreview = await import("../src/background/route-preview.ts");

// The entry owns registration, so attach the listeners explicitly against the
// fakes above before capturing them.
registerMessaging();
const [[onMessage]] = (global.browser.runtime.onMessage.addListener as any).mock.calls;
const [[onMessageExternal]] = (global.browser.runtime.onMessageExternal.addListener as any).mock
  .calls;

// The tracked tab the handlers fall back to; a stable ref so `toBe` can assert
// identity against what setCurrentTab seeded this run.
let trackedTab: CurrentTab;

const setupGlobals = () => {
  vi.restoreAllMocks();
  clearPersistenceDiagnostics();

  trackedTab = { id: 1, title: "Tracked Tab" };
  setCurrentTab(trackedTab);
  Object.assign(options, {
    conflictAction: "uniquify",
    externalDownloadAllowlist: "trusted-extension",
  });
  vi.spyOn(Download, "renameAndDownload").mockResolvedValue({ status: "started", downloadId: 1 });
  // Download.launch stays real: it just calls renameAndDownload (the rejection
  // path it also handles is covered in download-flow.test).
  vi.spyOn(Notifier, "expectDownload").mockImplementation((url?: string) => ({ url }));
  vi.spyOn(Menus, "buildTree").mockImplementation((paths: string[]) => ({
    items: paths.map((path, index) => ({
      kind: "path",
      id: `save-in-${index}`,
      title: path,
      number: index,
      parsedDir: path,
      comment: "",
      menuIndex: String(index),
      depth: 0,
      parentId: "save-in-root",
      raw: path,
    })),
    errors: [],
  }));
  vi.spyOn(router, "parseRulesCollecting").mockReturnValue({ rules: [], errors: [] });
  vi.spyOn(router, "traceRules").mockResolvedValue({ selectedRule: null } as any);
  Object.keys(Variable.transformers).forEach((key) => delete Variable.transformers[key]);
  Object.assign(Variable.transformers, { ":date:": () => {}, ":year:": () => {} });
  vi.spyOn(Variable, "applyVariables").mockImplementation((path: any) =>
    Promise.resolve({
      buf: [],
      finalize: () => `interp:${path.raw}`,
      toString: () => `interp:${path.raw}`,
    }),
  );
  Object.assign(OptionsManagement, {
    OPTION_KEYS: [
      { name: "prompt", type: "BOOL", default: false },
      { name: "paths", type: "VALUE", default: ".", onSave: (value: string) => value.trim() },
    ],
    OPTION_TYPES: { BOOL: "BOOL", VALUE: "VALUE" },
    OPTION_DESCRIPTIONS: { prompt: "Always open Save As", paths: "The menu structure" },
  });
  vi.spyOn(RoutePreview, "previewRoutes").mockReturnValue({
    path: "routed/dir",
    captures: null,
  } as any);
  vi.spyOn(SaveHistory, "get").mockResolvedValue([]);
  vi.spyOn(SaveHistory, "clear").mockResolvedValue();
  vi.spyOn(ExternalDownloadRejections, "get").mockResolvedValue([]);
  vi.spyOn(ExternalDownloadRejections, "record").mockResolvedValue();
  vi.spyOn(ExternalDownloadRejections, "clear").mockResolvedValue();
  vi.spyOn(Notifier, "reportExternalDownloadRejection").mockResolvedValue();
  vi.spyOn(SourcePanelState, "syncSourcePanelToTab").mockResolvedValue();
  vi.spyOn(SourcePanelState, "setSourcePanelOpenState").mockResolvedValue();

  backgroundRuntime.reset = vi.fn();
  delete backgroundRuntime.ready;
  backgroundRuntime.optionErrors = { paths: [], filenamePatterns: [] };
  delete backgroundRuntime.lastDownloadState;
  backgroundRuntime.debug = false;
  global.browser.runtime.sendMessage = vi.fn();
  (global.browser as any).storage = {
    local: {
      get: vi.fn(() => Promise.resolve({})),
      set: vi.fn(() => Promise.resolve()),
    },
  };
  (global.browser.tabs as any).query = vi.fn(() => Promise.resolve([{ id: 42 }]));
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

  test("HISTORY_GET returns normalized history from its background owner", async () => {
    vi.mocked(SaveHistory.get).mockResolvedValue([{ id: "h1", url: "https://x.test/a" }]);
    const sendResponse = vi.fn();

    expect(onMessage({ type: MESSAGE_TYPES.HISTORY_GET }, {}, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.HISTORY_GET,
      body: { entries: [{ id: "h1", url: "https://x.test/a" }] },
    });
  });

  test("HISTORY_CLEAR waits for the serialized background clear", async () => {
    const sendResponse = vi.fn();
    expect(onMessage({ type: MESSAGE_TYPES.HISTORY_CLEAR }, {}, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(SaveHistory.clear).toHaveBeenCalledOnce();
    expect(sendResponse).toHaveBeenCalledWith({ type: MESSAGE_TYPES.OK });
  });

  test("lists and clears rejected external download callers", async () => {
    vi.mocked(ExternalDownloadRejections.get).mockResolvedValue([
      {
        senderId: "blocked-extension",
        attempts: 2,
        lastRejectedAt: "2026-07-13T10:00:00.000Z",
        requestType: "activeTab",
      },
    ]);
    const listResponse = vi.fn();

    expect(
      onMessage({ type: MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTIONS_GET }, {}, listResponse),
    ).toBe(true);
    await vi.waitFor(() => expect(listResponse).toHaveBeenCalled());
    expect(listResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTIONS_GET,
      body: {
        rejections: [expect.objectContaining({ senderId: "blocked-extension", attempts: 2 })],
      },
    });

    const clearResponse = vi.fn();
    expect(
      onMessage(
        {
          type: MESSAGE_TYPES.EXTERNAL_DOWNLOAD_REJECTION_CLEAR,
          body: { senderId: "blocked-extension" },
        },
        {},
        clearResponse,
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(clearResponse).toHaveBeenCalled());
    expect(ExternalDownloadRejections.clear).toHaveBeenCalledWith("blocked-extension");
    expect(clearResponse).toHaveBeenCalledWith({ type: MESSAGE_TYPES.OK });
  });

  test("SOURCE_PANEL_READY synchronizes state after the content listener exists", async () => {
    const sendResponse = vi.fn();
    expect(
      onMessage({ type: MESSAGE_TYPES.SOURCE_PANEL_READY }, { tab: { id: 12 } }, sendResponse),
    ).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(SourcePanelState.syncSourcePanelToTab).toHaveBeenCalledWith(12);
    expect(sendResponse).toHaveBeenCalledWith({ type: MESSAGE_TYPES.OK });
  });

  test("SOURCE_PANEL_STATE persists content-script close state", async () => {
    const sendResponse = vi.fn();
    expect(
      onMessage(
        { type: MESSAGE_TYPES.SOURCE_PANEL_STATE, body: { open: false } },
        {},
        sendResponse,
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(SourcePanelState.setSourcePanelOpenState).toHaveBeenCalledWith(false);
    expect(sendResponse).toHaveBeenCalledWith({ type: MESSAGE_TYPES.OK });
  });

  test("OPTIONS_LOADED responds only after the background reset completes", async () => {
    let finishReset!: () => void;
    backgroundRuntime.reset = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishReset = resolve;
        }),
    );
    const sendResponse = vi.fn();
    expect(onMessage({ type: MESSAGE_TYPES.OPTIONS_LOADED }, {}, sendResponse)).toBe(true);
    expect(backgroundRuntime.reset).toHaveBeenCalledTimes(1);
    expect(sendResponse).not.toHaveBeenCalled();

    finishReset();
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith({ type: MESSAGE_TYPES.OK });
  });

  test("OPTIONS responds with the current options", () => {
    const sendResponse = vi.fn();
    onMessage({ type: MESSAGE_TYPES.OPTIONS }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.OPTIONS,
      body: options,
    });
  });

  test("OPTIONS waits for cold-start initialization before exposing settings", async () => {
    let finish!: () => void;
    backgroundRuntime.ready = new Promise<void>((resolve) => {
      finish = () => {
        options.prompt = true;
        resolve();
      };
    });
    const sendResponse = vi.fn();

    expect(onMessage({ type: MESSAGE_TYPES.OPTIONS }, {}, sendResponse)).toBe(true);
    expect(sendResponse).not.toHaveBeenCalled();

    finish();
    await backgroundRuntime.ready;
    await Promise.resolve();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.OPTIONS,
      body: expect.objectContaining({ prompt: true }),
    });
  });

  test("OPTIONS_SCHEMA responds with option keys and types", () => {
    const sendResponse = vi.fn();
    onMessage({ type: MESSAGE_TYPES.OPTIONS_SCHEMA }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.OPTIONS_SCHEMA,
      body: {
        keys: OptionsManagement.OPTION_KEYS.map(({ name, type, default: defaultValue }) => ({
          name,
          type,
          default: defaultValue,
        })),
        types: OptionsManagement.OPTION_TYPES,
      },
    });
  });

  test("GET_KEYWORDS responds with matcher and variable names", () => {
    const sendResponse = vi.fn();
    onMessage({ type: MESSAGE_TYPES.GET_KEYWORDS }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.KEYWORD_LIST,
      body: {
        matchers: Object.keys(router.matcherFunctions),
        variables: [":date:", ":year:"],
      },
    });
  });

  test("PREVIEW_MENUS builds a tree from the supplied (unsaved) paths text", () => {
    const sendResponse = vi.fn();
    onMessage(
      { type: MESSAGE_TYPES.PREVIEW_MENUS, body: { paths: " dogs \n\n>cats\n" } },
      {},
      sendResponse,
    );

    // Lines are trimmed and blanks dropped, mirroring window.init
    expect(Menus.buildTree).toHaveBeenCalledWith(["dogs", ">cats"]);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.MENU_PREVIEW,
      body: {
        items: [
          expect.objectContaining({ kind: "path", id: "save-in-0", title: "dogs" }),
          expect.objectContaining({ kind: "path", id: "save-in-1", title: ">cats" }),
        ],
        errors: [],
      },
    });
  });

  test("PREVIEW_MENUS tolerates a missing body", () => {
    const sendResponse = vi.fn();
    onMessage({ type: MESSAGE_TYPES.PREVIEW_MENUS }, {}, sendResponse);
    expect(Menus.buildTree).toHaveBeenCalledWith([]);
    expect(sendResponse).toHaveBeenCalled();
  });

  test("an unknown internal message type is a no-op", () => {
    // (the external API instead replies UNKNOWN_TYPE — see the API v1 suite)
    const sendResponse = vi.fn();
    onMessage({ type: "SOMETHING_ELSE" }, {}, sendResponse);
    expect(sendResponse).not.toHaveBeenCalled();
  });
});

describe("onMessage CHECK_ROUTES", () => {
  // CHECK_ROUTES is now async (interpolation + checkRoutes await); let the
  // handler's microtasks settle before asserting the response
  const settle = () => new Promise((r) => setTimeout(r, 0));

  test("waits for cold-start initialization before previewing routes", async () => {
    let finish!: () => void;
    backgroundRuntime.ready = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const sendResponse = vi.fn();

    expect(onMessage({ type: MESSAGE_TYPES.CHECK_ROUTES }, {}, sendResponse)).toBe(true);
    expect(RoutePreview.previewRoutes).not.toHaveBeenCalled();

    finish();
    await backgroundRuntime.ready;
    await settle();
    expect(RoutePreview.previewRoutes).toHaveBeenCalledTimes(1);
  });

  test("uses the state supplied in the request body", async () => {
    const state = { info: { filename: "f.png" } };
    const sendResponse = vi.fn();

    const keepChannelOpen = onMessage(
      { type: MESSAGE_TYPES.CHECK_ROUTES, body: { state } },
      {},
      sendResponse,
    );
    expect(keepChannelOpen).toBe(true);
    await settle();

    expect(RoutePreview.previewRoutes).toHaveBeenCalledWith(state);
    // interpolation runs in preview mode (a copy of info with preview:true)
    expect(Variable.applyVariables).toHaveBeenCalledWith(
      expect.any(Path),
      expect.objectContaining({ filename: "f.png", preview: true }),
    );
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.CHECK_ROUTES_RESPONSE,
      body: {
        optionErrors: backgroundRuntime.optionErrors,
        routeInfo: { path: "routed/dir", captures: null },
        lastDownload: undefined,
        interpolatedVariables: { ":date:": "interp::date:", ":year:": "interp::year:" },
        persistenceErrors: [],
      },
    });
  });

  test("turns an async handler rejection into a protocol error", async () => {
    vi.mocked(RoutePreview.previewRoutes).mockRejectedValue(new Error("preview failed"));
    const sendResponse = vi.fn();

    const keepChannelOpen = onMessage({ type: MESSAGE_TYPES.CHECK_ROUTES }, {}, sendResponse);
    expect(keepChannelOpen).toBe(true);
    await settle();

    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.CHECK_ROUTES,
      body: {
        status: MESSAGE_TYPES.ERROR,
        error: "INTERNAL_ERROR",
        message: "Save In could not complete the request",
      },
    });
  });

  test("falls back to window.lastDownloadState without a state in the body", async () => {
    const lastState = { info: { filename: "last.png" } };
    backgroundRuntime.lastDownloadState = lastState as any;
    const sendResponse = vi.fn();

    onMessage({ type: MESSAGE_TYPES.CHECK_ROUTES, body: {} }, {}, sendResponse);
    await settle();

    expect(RoutePreview.previewRoutes).toHaveBeenCalledWith(lastState);
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          lastDownload: { info: { filename: "last.png" } },
          interpolatedVariables: { ":date:": "interp::date:", ":year:": "interp::year:" },
        }),
      }),
    );
  });

  test("responds with null interpolations when there is no state at all", async () => {
    backgroundRuntime.lastDownloadState = null;
    const sendResponse = vi.fn();

    onMessage({ type: MESSAGE_TYPES.CHECK_ROUTES }, {}, sendResponse);
    await settle();

    expect(RoutePreview.previewRoutes).toHaveBeenCalledWith(null);
    expect(Variable.applyVariables).not.toHaveBeenCalled();
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

  test("tolerates an external message with no info object", async () => {
    const sendResponse = vi.fn();
    expect(
      onMessage(
        { type: MESSAGE_TYPES.DOWNLOAD, body: { url: "https://x/file.png" } },
        {},
        sendResponse,
      ),
    ).toBe(true);
    expect(Download.renameAndDownload).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.DOWNLOAD,
        body: { status: MESSAGE_TYPES.OK, version: 1, url: "https://x/file.png" },
      }),
    );
  });

  test("downloads with defaults when no previous download state exists", async () => {
    const sendResponse = vi.fn();
    expect(onMessage(request(), {}, sendResponse)).toBe(true);

    expect(Download.renameAndDownload).toHaveBeenCalledTimes(1);

    const state = vi.mocked(Download.renameAndDownload).mock.calls[0]![0]!;
    expect(state.path).toMatchObject({ raw: "." });
    expect(state.path.finalize()).toBe(".");
    expect(state.scratch).toEqual({});
    expect(state.info.url).toBe("https://x/file.png");
    expect(state.info.pageUrl).toBe("https://x/");
    expect(state.info.sourceUrl).toBe("https://x/file.png");
    expect(state.info.context).toBe(DOWNLOAD_TYPES.CLICK);
    expect(state.info.now).toEqual(expect.any(Date));

    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.DOWNLOAD,
        body: { status: MESSAGE_TYPES.OK, version: 1, url: "https://x/file.png" },
      }),
    );
  });

  test("keeps the message channel alive until the browser accepts the download", async () => {
    let finish!: (value: { status: "started"; downloadId: number }) => void;
    vi.mocked(Download.renameAndDownload).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const sendResponse = vi.fn();

    expect(onMessage(request(), {}, sendResponse)).toBe(true);
    expect(sendResponse).not.toHaveBeenCalled();

    finish({ status: "started", downloadId: 7 });
    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.DOWNLOAD,
        body: { status: MESSAGE_TYPES.OK, version: 1, url: "https://x/file.png" },
      }),
    );
  });

  test("preserves a caller-supplied suggested filename", () => {
    onMessage(
      request({ info: { pageUrl: "https://x/", suggestedFilename: "caller-name.png" } }),
      {},
      vi.fn(),
    );

    const state = vi.mocked(Download.renameAndDownload).mock.calls[0]![0]!;
    expect(state.info.suggestedFilename).toBe("caller-name.png");
  });

  test("reuses the last path and routing metadata, never filenames or routes", () => {
    const lastPath = new Path("images/cats");
    backgroundRuntime.lastDownloadState = {
      path: lastPath,
      scratch: { hasExtension: true },
      route: new Path("stale/route/from/other.png"),
      info: {
        comment: "0last",
        menuIndex: "1",
        suggestedFilename: "previous-download.png",
        filename: "previous-download.png",
      },
    };

    onMessage(request(), {}, vi.fn());

    const state = vi.mocked(Download.renameAndDownload).mock.calls[0]![0]!;
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
    backgroundRuntime.lastDownloadState = { scratch: {}, info: {} } as any;

    onMessage(request(), {}, vi.fn());

    const state = vi.mocked(Download.renameAndDownload).mock.calls[0]![0]!;
    expect(state.path).toMatchObject({ raw: "." });
    expect(state.path.finalize()).toBe(".");
  });

  test("prefers the sender's tab over the tracked global tab (#172)", () => {
    const senderTab = { id: 5, title: "Sender Tab" };
    onMessage(request(), { tab: senderTab }, vi.fn());

    const state = vi.mocked(Download.renameAndDownload).mock.calls[0]![0]!;
    expect(state.info.currentTab).toBe(senderTab);
  });

  test("falls back to the tracked tab when the sender has none", () => {
    onMessage(request(), {}, vi.fn());

    const state = vi.mocked(Download.renameAndDownload).mock.calls[0]![0]!;
    expect(state.info.currentTab).toBe(trackedTab);
  });

  test("passes through a comment for routing rules (external extensions)", () => {
    onMessage(request({ comment: "from-foxy-gestures" }), {}, vi.fn());

    const state = vi.mocked(Download.renameAndDownload).mock.calls[0]![0]!;
    expect(state.info.comment).toBe("from-foxy-gestures");
  });

  test("does not let external info override pipeline-owned fields", () => {
    onMessage(
      request({
        info: {
          pageUrl: "https://x/",
          context: "forged",
          url: "javascript:forged",
          currentTab: { id: 99 },
        },
      }),
      {},
      vi.fn(),
    );

    const state = vi.mocked(Download.renameAndDownload).mock.calls[0]![0]!;
    expect(state.info.context).toBe(DOWNLOAD_TYPES.CLICK);
    expect(state.info.url).toBe("https://x/file.png");
    expect(state.info.currentTab).toBe(trackedTab);
  });

  test("omits the comment when none is supplied", () => {
    onMessage(request(), {}, vi.fn());

    const state = vi.mocked(Download.renameAndDownload).mock.calls[0]![0]!;
    expect(state.info.comment).toBeUndefined();
  });

  test("is reachable from external extensions via onMessageExternal", async () => {
    const sendResponse = vi.fn();
    expect(
      onMessageExternal(request(), { id: "trusted-extension", tab: { id: 9 } }, sendResponse),
    ).toBe(true);

    expect(Download.renameAndDownload).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.DOWNLOAD,
        body: { status: MESSAGE_TYPES.OK, version: 1, url: "https://x/file.png" },
      }),
    );
  });

  test("external downloads wait for cold-start initialization", async () => {
    let finish!: () => void;
    backgroundRuntime.ready = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const sendResponse = vi.fn();

    expect(
      onMessageExternal(request(), { id: "trusted-extension", tab: { id: 9 } }, sendResponse),
    ).toBe(true);
    expect(Download.renameAndDownload).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();

    finish();
    await backgroundRuntime.ready;
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(Download.renameAndDownload).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: { status: MESSAGE_TYPES.OK, version: 1, url: "https://x/file.png" },
    });
  });
});

// Official versioned external API (#110)
describe("external DOWNLOAD API v1", () => {
  const download = (body: Record<string, any>) => ({ type: MESSAGE_TYPES.DOWNLOAD, body });

  test("PING returns the version and capabilities on both listeners", () => {
    for (const listener of [onMessageExternal, onMessage]) {
      const sendResponse = vi.fn();
      listener({ type: MESSAGE_TYPES.PING }, {}, sendResponse);
      expect(sendResponse).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.PONG,
        body: { version: 1, capabilities: expect.arrayContaining(["download", "ping"]) },
      });
    }
  });

  test("echoes a caller-supplied version back", async () => {
    const sendResponse = vi.fn();
    expect(
      onMessageExternal(
        download({ url: "https://x/f.png", version: 1 }),
        { id: "trusted-extension" },
        sendResponse,
      ),
    ).toBe(true);
    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.DOWNLOAD,
        body: { status: MESSAGE_TYPES.OK, version: 1, url: "https://x/f.png" },
      }),
    );
  });

  test("rejects a missing url with BAD_REQUEST and does not download", () => {
    const sendResponse = vi.fn();
    onMessageExternal(download({ info: {} }), { id: "trusted-extension" }, sendResponse);
    expect(Download.renameAndDownload).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: {
        status: MESSAGE_TYPES.ERROR,
        error: "BAD_REQUEST",
        message: expect.any(String),
        version: 1,
      },
    });
  });

  test("rejects an unfetchable scheme with INVALID_URL", () => {
    const sendResponse = vi.fn();
    onMessageExternal(
      download({ url: "javascript:alert(1)" }),
      { id: "trusted-extension" },
      sendResponse,
    );
    expect(Download.renameAndDownload).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: {
        status: MESSAGE_TYPES.ERROR,
        error: "INVALID_URL",
        message: expect.any(String),
        version: 1,
      },
    });
  });

  test("isValidDownloadUrl accepts fetchable schemes and rejects the rest", () => {
    expect(Messaging.isValidDownloadUrl("https://x/f.png")).toBe(true);
    expect(Messaging.isValidDownloadUrl("http://x/f.png")).toBe(true);
    expect(Messaging.isValidDownloadUrl("ftp://x/f.png")).toBe(true);
    expect(Messaging.isValidDownloadUrl("data:text/plain,hi")).toBe(true);
    expect(Messaging.isValidDownloadUrl("blob:https://x/uuid")).toBe(true);
    expect(Messaging.isValidDownloadUrl("file:///etc/passwd")).toBe(false);
    expect(Messaging.isValidDownloadUrl("javascript:1")).toBe(false);
    expect(Messaging.isValidDownloadUrl("not a url")).toBe(false);
    expect(Messaging.isValidDownloadUrl(undefined)).toBe(false);
  });

  test("records and notifies downloads from extensions the user has not allowed", async () => {
    const sendResponse = vi.fn();
    vi.mocked(global.browser.tabs.query).mockResolvedValueOnce([
      { id: 7, url: "https://private.example/account?token=secret" },
    ] as any);

    expect(
      onMessageExternal(
        download({ target: "activeTab" }),
        { id: "untrusted-extension" },
        sendResponse,
      ),
    ).toBe(true);

    expect(Download.renameAndDownload).not.toHaveBeenCalled();
    expect(global.browser.tabs.query).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(ExternalDownloadRejections.record).toHaveBeenCalledWith("untrusted-extension", {
      target: "activeTab",
    });
    expect(Notifier.reportExternalDownloadRejection).toHaveBeenCalledWith("untrusted-extension");
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: {
        status: MESSAGE_TYPES.ERROR,
        error: "UNAUTHORIZED",
        message: expect.any(String),
        version: 1,
      },
    });
  });

  test("does not persist private rejected requests", async () => {
    const sendResponse = vi.fn();
    onMessageExternal(
      download({ url: "https://private.example/secret" }),
      { id: "untrusted-extension", tab: { incognito: true } },
      sendResponse,
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(ExternalDownloadRejections.record).not.toHaveBeenCalled();
    expect(Notifier.reportExternalDownloadRejection).not.toHaveBeenCalled();
  });

  test("matches external extension ids as trimmed, exact allowlist lines", async () => {
    options.externalDownloadAllowlist = "other-extension\n  trusted-extension  \n";
    const sendResponse = vi.fn();

    expect(
      onMessageExternal(
        download({ url: "https://x/allowed.png" }),
        { id: "trusted-extension" },
        sendResponse,
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(Download.renameAndDownload).toHaveBeenCalledOnce();
  });

  test("an unknown external message type returns UNKNOWN_TYPE", () => {
    const sendResponse = vi.fn();
    onMessageExternal({ type: "WAT" }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      type: "WAT",
      body: { status: MESSAGE_TYPES.ERROR, error: "UNKNOWN_TYPE", version: 1 },
    });
  });

  test("a known external message with a malformed body returns BAD_REQUEST", () => {
    const sendResponse = vi.fn();
    onMessageExternal(
      { type: MESSAGE_TYPES.DOWNLOAD, body: { url: 42, info: "not an object" } },
      {},
      sendResponse,
    );
    expect(Download.renameAndDownload).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: { status: MESSAGE_TYPES.ERROR, error: "BAD_REQUEST", version: 1 },
    });
  });

  test("PING advertises the schema and validate capabilities", () => {
    const sendResponse = vi.fn();
    onMessageExternal({ type: MESSAGE_TYPES.PING }, {}, sendResponse);
    const { capabilities } = sendResponse.mock.calls[0]![0]!.body;
    expect(capabilities).toEqual(expect.arrayContaining(["schema", "validate"]));
    expect(capabilities).not.toContain("apply_config");
  });
});

// Scriptable / AI-assisted config API (#89, docs/INTEGRATIONS.md §4)
describe("config API", () => {
  test("GET_SCHEMA returns option name/type/default/description", () => {
    const sendResponse = vi.fn();
    onMessageExternal({ type: MESSAGE_TYPES.GET_SCHEMA }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.SCHEMA,
      body: {
        version: 1,
        options: [
          { name: "prompt", type: "BOOL", default: false, description: "Always open Save As" },
          { name: "paths", type: "VALUE", default: ".", description: "The menu structure" },
        ],
      },
    });
  });

  test("VALIDATE dry-runs paths and rules and returns errors + preview", async () => {
    vi.mocked(router.parseRulesCollecting).mockReturnValue({
      rules: [],
      errors: [{ message: "bad rule", error: "bad rule" }],
    });
    const sendResponse = vi.fn();
    expect(
      onMessageExternal(
        { type: MESSAGE_TYPES.VALIDATE, body: { paths: " dogs \n>cats", filenamePatterns: "x" } },
        {},
        sendResponse,
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(Menus.buildTree).toHaveBeenCalledWith(["dogs", ">cats"]);
    expect(router.parseRulesCollecting).toHaveBeenCalledWith("x");
    const { body } = sendResponse.mock.calls[0]![0]!;
    expect(body.pathErrors).toEqual([]);
    expect(body.ruleErrors).toEqual([{ message: "bad rule", error: "bad rule" }]);
    expect(body.menuPreview).toHaveLength(2);
  });

  test("VALIDATE returns a rule trace when sample download info is supplied", async () => {
    const rules = [{ name: "into", value: "images/:filename:", type: "DESTINATION" }] as any;
    vi.mocked(router.parseRulesCollecting).mockReturnValue({ rules, errors: [] });
    vi.mocked(router.traceRules).mockResolvedValue({ selectedRule: 1 } as any);
    const info = { url: "https://x/cat.jpg", filename: "cat.jpg" };
    const sendResponse = vi.fn();
    expect(
      onMessage(
        { type: MESSAGE_TYPES.VALIDATE, body: { filenamePatterns: "x", info } },
        {},
        sendResponse,
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(router.traceRules).toHaveBeenCalledWith(rules, info);
    expect(sendResponse.mock.calls[0]![0]!.body.ruleTrace).toEqual({ selectedRule: 1 });
  });

  test("VALIDATE is exposed on the internal listener too", async () => {
    const sendResponse = vi.fn();
    expect(
      onMessage({ type: MESSAGE_TYPES.VALIDATE, body: { paths: "dogs" } }, {}, sendResponse),
    ).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ type: MESSAGE_TYPES.VALIDATE_RESULT }),
    );
  });

  test("APPLY_CONFIG applies known keys, rejects unknown ones, and resets", async () => {
    const sendResponse = vi.fn();
    onMessage(
      {
        type: MESSAGE_TYPES.APPLY_CONFIG,
        body: { config: { prompt: true, paths: "  images  ", bogus: 1 } },
      },
      {},
      sendResponse,
    );
    await new Promise((r) => setTimeout(r, 0));

    expect(global.browser.storage.local.set).toHaveBeenCalledWith({
      prompt: true,
      paths: "images", // onSave trimmed it
    });
    expect(backgroundRuntime.reset).toHaveBeenCalled();
    const { body } = sendResponse.mock.calls[0]![0]!;
    expect(body.applied).toEqual({ prompt: true, paths: "images" });
    expect(body.rejected).toEqual([{ name: "bogus", reason: "unknown option" }]);
  });

  test("APPLY_CONFIG atomically rejects a stale expected value", async () => {
    vi.mocked(global.browser.storage.local.get).mockResolvedValueOnce({ prompt: false });
    const sendResponse = vi.fn();
    onMessage(
      {
        type: MESSAGE_TYPES.APPLY_CONFIG,
        body: { config: { prompt: false }, expected: { prompt: true } },
      },
      {},
      sendResponse,
    );
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    expect(global.browser.storage.local.set).not.toHaveBeenCalled();
    expect(backgroundRuntime.reset).not.toHaveBeenCalled();
    expect(sendResponse.mock.calls[0]![0]!.body).toMatchObject({
      applied: {},
      rejected: [{ name: "prompt", reason: "changed since save" }],
    });
  });

  test("APPLY_CONFIG serializes compare-and-set requests", async () => {
    let storedPrompt = false;
    let releaseFirst!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    vi.mocked(global.browser.storage.local.get).mockImplementation(async () => ({
      prompt: storedPrompt,
    }));
    vi.mocked(global.browser.storage.local.set)
      .mockImplementationOnce(async (values) => {
        await firstWrite;
        storedPrompt = values.prompt as boolean;
      })
      .mockImplementationOnce(async (values) => {
        storedPrompt = values.prompt as boolean;
      });

    const firstResponse = vi.fn();
    const secondResponse = vi.fn();
    onMessage(
      { type: MESSAGE_TYPES.APPLY_CONFIG, body: { config: { prompt: true } } },
      {},
      firstResponse,
    );
    onMessage(
      {
        type: MESSAGE_TYPES.APPLY_CONFIG,
        body: { config: { prompt: false }, expected: { prompt: true } },
      },
      {},
      secondResponse,
    );
    await vi.waitFor(() => expect(global.browser.storage.local.set).toHaveBeenCalledTimes(1));
    releaseFirst();
    await vi.waitFor(() => expect(secondResponse).toHaveBeenCalled());

    expect(storedPrompt).toBe(false);
    expect(secondResponse.mock.calls[0]![0]!.body).toMatchObject({
      applied: { prompt: false },
      rejected: [],
    });
  });

  test("APPLY_CONFIG rejects a type mismatch", async () => {
    const sendResponse = vi.fn();
    onMessage(
      { type: MESSAGE_TYPES.APPLY_CONFIG, body: { config: { prompt: "yes" } } },
      {},
      sendResponse,
    );
    await new Promise((r) => setTimeout(r, 0));

    expect(global.browser.storage.local.set).not.toHaveBeenCalled();
    expect(sendResponse.mock.calls[0]![0]!.body.rejected).toEqual([
      { name: "prompt", reason: "expected a boolean" },
    ]);
  });

  test("APPLY_CONFIG rejects values outside schema constraints", async () => {
    (OptionsManagement.OPTION_KEYS as unknown as Array<Record<string, unknown>>).push(
      {
        name: "conflictAction",
        type: "VALUE",
        default: "uniquify",
        validate: (value: string) => ["uniquify", "overwrite", "prompt"].includes(value),
      },
      {
        name: "notifyDuration",
        type: "VALUE",
        default: 7000,
        validate: (value: number) => value >= 0,
      },
    );
    const sendResponse = vi.fn();
    onMessage(
      {
        type: MESSAGE_TYPES.APPLY_CONFIG,
        body: { config: { conflictAction: "destroy", notifyDuration: -1 } },
      },
      {},
      sendResponse,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(global.browser.storage.local.set).not.toHaveBeenCalled();
    expect(sendResponse.mock.calls[0]![0]!.body.rejected).toEqual([
      { name: "conflictAction", reason: "invalid value" },
      { name: "notifyDuration", reason: "invalid value" },
    ]);
  });

  test("APPLY_CONFIG ignores a malformed config container", () => {
    const sendResponse = vi.fn();
    onMessage(
      { type: MESSAGE_TYPES.APPLY_CONFIG, body: { config: ["not", "an", "object"] } },
      {},
      sendResponse,
    );

    expect(global.browser.storage.local.set).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
  });

  test("APPLY_CONFIG is NOT reachable from external extensions", () => {
    const sendResponse = vi.fn();
    onMessageExternal(
      { type: MESSAGE_TYPES.APPLY_CONFIG, body: { config: { prompt: true } } },
      {},
      sendResponse,
    );
    expect(global.browser.storage.local.set).not.toHaveBeenCalled();
    // falls through to the UNKNOWN_TYPE reply
    expect(sendResponse.mock.calls[0]![0]!.body.error).toBe("UNKNOWN_TYPE");
  });
});

describe("emit.downloaded", () => {
  test("fires a DOWNLOADED message and swallows a no-receiver rejection", async () => {
    global.browser.runtime.sendMessage = vi.fn(() =>
      Promise.reject(new Error("Receiving end does not exist")),
    );
    const state = {
      path: new Path("."),
      scratch: {},
      info: { url: "https://x/file.png" },
    };

    expect(() => Messaging.emit.downloaded(state)).not.toThrow();
    expect(global.browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOADED,
      body: { state: { path: ".", info: { url: "https://x/file.png" } } },
    });
    // The rejection is caught, not left unhandled
    await Promise.resolve();
  });
});

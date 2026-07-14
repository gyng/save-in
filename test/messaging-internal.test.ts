import {
  MESSAGE_TYPES,
  OptionsManagement,
  options,
  Menus,
  router,
  Variable,
  Path,
  backgroundRuntime,
  SaveHistory,
  ExternalDownloadRejections,
  SourcePanelState,
  RoutePreview,
  onMessage,
  onMessageExternal,
  setupGlobals,
} from "./messaging-fixture.ts";

beforeEach(() => setupGlobals());

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
        automaticMatchers: [
          "pageurl",
          "pagedomain",
          "pagerootdomain",
          "sourceurl",
          "sourcedomain",
          "sourcerootdomain",
          "sourcekind",
          "mediatype",
          "fileext",
          "urlfileext",
        ],
        automaticContext: "AUTO",
        sourceKinds: ["image", "video", "audio", "stream", "document", "link"],
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
    await vi.waitFor(() => expect(RoutePreview.previewRoutes).toHaveBeenCalledTimes(1));
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
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

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
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

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
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

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
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

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

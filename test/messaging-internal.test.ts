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
  ActiveTransfers,
  OffscreenClient,
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

  test.each([
    ["saved", "saved"],
    [42, 42],
    [Number.NaN, "."],
  ])("GET_CONFIG normalizes stored value option %#", async (stored, expected) => {
    vi.mocked(global.browser.storage.local.get).mockResolvedValueOnce({
      prompt: false,
      paths: stored,
    });
    const sendResponse = vi.fn();

    expect(onMessage({ type: MESSAGE_TYPES.GET_CONFIG }, {}, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls[0]![0]!.body.config.paths).toBe(expected);
  });

  test("omits automatic filenames when a candidate URL has no filename", async () => {
    const sendResponse = vi.fn();
    expect(
      onMessage(
        {
          type: MESSAGE_TYPES.VALIDATE,
          body: {
            filenamePatterns: "context: ^auto$",
            automaticCandidate: {
              pageUrl: "https://example.test/gallery",
              sourceUrl: "https://cdn.test/",
              sourceKind: "image",
            },
          },
        },
        {},
        sendResponse,
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(router.traceRules).toHaveBeenCalled());
    expect(vi.mocked(router.traceRules).mock.calls[0]![1]).toEqual({
      context: "AUTO",
      pageUrl: "https://example.test/gallery",
      sourceUrl: "https://cdn.test/",
      url: "https://cdn.test/",
      sourceKind: "image",
      mediaType: "image",
    });
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

  test("HISTORY_CANCEL aborts offscreen and active browser transfers", async () => {
    vi.mocked(ActiveTransfers.get).mockReturnValue({
      requestId: "request-1",
      downloadId: 17,
      updatedAt: 1,
    });
    vi.mocked(ActiveTransfers.cancel).mockReturnValue(true);
    vi.mocked(OffscreenClient.canUse).mockReturnValue(true);
    vi.mocked(OffscreenClient.cancel).mockRejectedValue(new Error("already released"));
    vi.mocked(global.browser.downloads.search).mockResolvedValue([
      { id: 17, state: "in_progress" } as any,
    ]);
    const sendResponse = vi.fn();

    expect(
      onMessage(
        { type: MESSAGE_TYPES.HISTORY_CANCEL, body: { historyId: "history-1" } },
        {},
        sendResponse,
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    expect(OffscreenClient.cancel).toHaveBeenCalledWith("request-1");
    expect(global.browser.downloads.cancel).toHaveBeenCalledWith(17);
    expect(SaveHistory.setStatus).toHaveBeenCalledWith("history-1", "USER_CANCELED", 17);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.HISTORY_CANCEL,
      body: { canceled: true },
    });
  });

  test("HISTORY_CANCEL uses a stored download id without overwriting completion", async () => {
    vi.mocked(SaveHistory.get).mockResolvedValue([
      { id: "history-2", url: "https://x.test/file", downloadId: 23 },
    ]);
    vi.mocked(global.browser.downloads.search).mockResolvedValue([
      { id: 23, state: "complete" } as any,
    ]);
    const sendResponse = vi.fn();

    onMessage(
      { type: MESSAGE_TYPES.HISTORY_CANCEL, body: { historyId: "history-2" } },
      {},
      sendResponse,
    );
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    expect(global.browser.downloads.cancel).toHaveBeenCalledWith(23);
    expect(SaveHistory.setStatus).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.HISTORY_CANCEL,
      body: { canceled: true },
    });
  });

  test("HISTORY_CANCEL records an active transfer when no browser download exists", async () => {
    vi.mocked(ActiveTransfers.get).mockReturnValue({ updatedAt: 1 });
    vi.mocked(ActiveTransfers.cancel).mockReturnValue(true);
    const sendResponse = vi.fn();

    onMessage(
      { type: MESSAGE_TYPES.HISTORY_CANCEL, body: { historyId: "history-3" } },
      {},
      sendResponse,
    );
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    expect(SaveHistory.setStatus).toHaveBeenCalledWith("history-3", "USER_CANCELED", undefined);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.HISTORY_CANCEL,
      body: { canceled: true },
    });
  });

  test("HISTORY_CANCEL tolerates a browser cancellation race and an empty id", async () => {
    vi.mocked(SaveHistory.get).mockResolvedValue([
      { id: "history-4", url: "https://x.test/file", downloadId: 29 },
    ]);
    vi.mocked(global.browser.downloads.cancel).mockRejectedValue(new Error("already complete"));
    const racedResponse = vi.fn();
    onMessage(
      { type: MESSAGE_TYPES.HISTORY_CANCEL, body: { historyId: "history-4" } },
      {},
      racedResponse,
    );
    await vi.waitFor(() => expect(racedResponse).toHaveBeenCalled());
    expect(racedResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.HISTORY_CANCEL,
      body: { canceled: false },
    });

    vi.mocked(SaveHistory.get).mockClear();
    const emptyResponse = vi.fn();
    onMessage({ type: MESSAGE_TYPES.HISTORY_CANCEL, body: { historyId: "" } }, {}, emptyResponse);
    await vi.waitFor(() => expect(emptyResponse).toHaveBeenCalled());
    expect(SaveHistory.get).not.toHaveBeenCalled();
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

  test("SOURCE_PANEL_READY tolerates a sender without a tab", async () => {
    const sendResponse = vi.fn();
    expect(onMessage({ type: MESSAGE_TYPES.SOURCE_PANEL_READY }, {}, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(SourcePanelState.syncSourcePanelToTab).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ type: MESSAGE_TYPES.OK });
  });

  test("SOURCE_PANEL_COPY localizes once per selected locale", () => {
    options.uiLocale = undefined as any;
    const defaultResponse = vi.fn();
    onMessage({ type: MESSAGE_TYPES.SOURCE_PANEL_COPY }, {}, defaultResponse);
    expect(defaultResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.SOURCE_PANEL_COPY,
      body: expect.objectContaining({ title: expect.any(String), save: expect.any(String) }),
    });

    options.uiLocale = "de";
    const firstResponse = vi.fn();
    onMessage({ type: MESSAGE_TYPES.SOURCE_PANEL_COPY }, {}, firstResponse);
    const localizationCalls = vi.mocked(global.browser.i18n.getMessage).mock.calls.length;

    const cachedResponse = vi.fn();
    onMessage({ type: MESSAGE_TYPES.SOURCE_PANEL_COPY }, {}, cachedResponse);
    expect(global.browser.i18n.getMessage).toHaveBeenCalledTimes(localizationCalls);
    expect(cachedResponse).toHaveBeenCalledWith(firstResponse.mock.calls[0]![0]);
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

  test("a ready-handler string rejection returns a protocol error", async () => {
    backgroundRuntime.ready = Promise.reject("startup failed");
    const sendResponse = vi.fn();

    expect(onMessage({ type: MESSAGE_TYPES.OPTIONS }, {}, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.OPTIONS,
      body: {
        status: MESSAGE_TYPES.ERROR,
        error: "INTERNAL_ERROR",
        message: "Save In could not complete the request",
      },
    });
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
      expect.objectContaining({ filename: "f.png", now: expect.any(Date), preview: true }),
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
    const now = new Date("2026-07-14T00:00:00.000Z");
    const lastState = { info: { filename: "last.png", now } };
    backgroundRuntime.lastDownloadState = lastState as any;
    const sendResponse = vi.fn();

    onMessage({ type: MESSAGE_TYPES.CHECK_ROUTES, body: {} }, {}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());

    expect(RoutePreview.previewRoutes).toHaveBeenCalledWith(lastState);
    expect(Variable.applyVariables).toHaveBeenCalledWith(
      expect.any(Path),
      expect.objectContaining({ now }),
    );
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          lastDownload: { info: { filename: "last.png", now: now.toISOString() } },
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

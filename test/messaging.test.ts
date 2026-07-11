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

// Capture the listeners registerMessaging() attaches (jest-webextension-mock's
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

// Import-time side effects are deferred (Task #2): messaging.ts no longer
// registers its runtime listeners at load — the entry does, so call it here to
// attach them against the fakes above, then capture.
registerMessaging();
const [[onMessage]] = (global.browser.runtime.onMessage.addListener as any).mock.calls;
const [[onMessageExternal]] = (global.browser.runtime.onMessageExternal.addListener as any).mock
  .calls;

// The tracked tab the handlers fall back to; a stable ref so `toBe` can assert
// identity against what setCurrentTab seeded this run.
let trackedTab: CurrentTab;

const setupGlobals = () => {
  vi.restoreAllMocks();

  trackedTab = { id: 1, title: "Tracked Tab" };
  setCurrentTab(trackedTab);
  Object.assign(options, { conflictAction: "uniquify" });
  vi.spyOn(Download, "renameAndDownload").mockResolvedValue(undefined);
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
  vi.spyOn(router, "traceRules").mockReturnValue({ selectedRule: null } as any);
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
  vi.spyOn(OptionsManagement, "checkRoutes").mockReturnValue({
    path: "routed/dir",
    captures: null,
  } as any);

  global.window.reset = vi.fn();
  global.window.optionErrors = { paths: [], filenamePatterns: [] };
  delete global.window.lastDownloadState;
  delete global.window.SI_DEBUG;
  global.browser.runtime.sendMessage = vi.fn();
  (global.browser as any).storage = { local: { set: vi.fn(() => Promise.resolve()) } };
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
      body: options,
    });
  });

  test("OPTIONS_SCHEMA responds with option keys and types", () => {
    const sendResponse = vi.fn();
    onMessage({ type: MESSAGE_TYPES.OPTIONS_SCHEMA }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.OPTIONS_SCHEMA,
      body: {
        keys: OptionsManagement.OPTION_KEYS,
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

  test("uses the state supplied in the request body", async () => {
    const state = { info: { filename: "f.png" } };
    const sendResponse = vi.fn();

    onMessage({ type: MESSAGE_TYPES.CHECK_ROUTES, body: { state } }, {}, sendResponse);
    await settle();

    expect(OptionsManagement.checkRoutes).toHaveBeenCalledWith(state);
    // interpolation runs in preview mode (a copy of info with preview:true)
    expect(Variable.applyVariables).toHaveBeenCalledWith(
      expect.any(Path),
      expect.objectContaining({ filename: "f.png", preview: true }),
    );
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

  test("falls back to window.lastDownloadState without a state in the body", async () => {
    const lastState = { info: { filename: "last.png" } };
    (global.window as any).lastDownloadState = lastState;
    const sendResponse = vi.fn();

    onMessage({ type: MESSAGE_TYPES.CHECK_ROUTES, body: {} }, {}, sendResponse);
    await settle();

    expect(OptionsManagement.checkRoutes).toHaveBeenCalledWith(lastState);
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          lastDownload: lastState,
          interpolatedVariables: { ":date:": "interp::date:", ":year:": "interp::year:" },
        }),
      }),
    );
  });

  test("responds with null interpolations when there is no state at all", async () => {
    global.window.lastDownloadState = null;
    const sendResponse = vi.fn();

    onMessage({ type: MESSAGE_TYPES.CHECK_ROUTES }, {}, sendResponse);
    await settle();

    expect(OptionsManagement.checkRoutes).toHaveBeenCalledWith(false);
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

  test("tolerates an external message with no info object", () => {
    const sendResponse = vi.fn();
    expect(() =>
      onMessage(
        { type: MESSAGE_TYPES.DOWNLOAD, body: { url: "https://x/file.png" } },
        {},
        sendResponse,
      ),
    ).not.toThrow();
    expect(Download.renameAndDownload).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: { status: MESSAGE_TYPES.OK, version: 1, url: "https://x/file.png" },
    });
  });

  test("downloads with defaults when no previous download state exists", () => {
    const sendResponse = vi.fn();
    onMessage(request(), {}, sendResponse);

    expect(Download.renameAndDownload).toHaveBeenCalledTimes(1);

    const state = vi.mocked(Download.renameAndDownload).mock.calls[0][0];
    expect(state.path).toMatchObject({ raw: "." });
    expect(state.path.finalize()).toBe(".");
    expect(state.scratch).toEqual({});
    expect(state.info.url).toBe("https://x/file.png");
    expect(state.info.pageUrl).toBe("https://x/");
    expect(state.info.sourceUrl).toBe("https://x/file.png");
    expect(state.info.context).toBe(DOWNLOAD_TYPES.CLICK);
    expect(state.info.now).toEqual(expect.any(Date));

    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: { status: MESSAGE_TYPES.OK, version: 1, url: "https://x/file.png" },
    });
  });

  test("preserves a caller-supplied suggested filename", () => {
    onMessage(
      request({ info: { pageUrl: "https://x/", suggestedFilename: "caller-name.png" } }),
      {},
      vi.fn(),
    );

    const state = vi.mocked(Download.renameAndDownload).mock.calls[0][0];
    expect(state.info.suggestedFilename).toBe("caller-name.png");
  });

  test("reuses the last path and routing metadata, never filenames or routes", () => {
    const lastPath = new Path("images/cats");
    global.window.lastDownloadState = {
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

    const state = vi.mocked(Download.renameAndDownload).mock.calls[0][0];
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
    (global.window as any).lastDownloadState = { scratch: {}, info: {} };

    onMessage(request(), {}, vi.fn());

    const state = vi.mocked(Download.renameAndDownload).mock.calls[0][0];
    expect(state.path).toMatchObject({ raw: "." });
    expect(state.path.finalize()).toBe(".");
  });

  test("prefers the sender's tab over the tracked global tab (#172)", () => {
    const senderTab = { id: 5, title: "Sender Tab" };
    onMessage(request(), { tab: senderTab }, vi.fn());

    const state = vi.mocked(Download.renameAndDownload).mock.calls[0][0];
    expect(state.info.currentTab).toBe(senderTab);
  });

  test("falls back to the tracked tab when the sender has none", () => {
    onMessage(request(), {}, vi.fn());

    const state = vi.mocked(Download.renameAndDownload).mock.calls[0][0];
    expect(state.info.currentTab).toBe(trackedTab);
  });

  test("passes through a comment for routing rules (external extensions)", () => {
    onMessage(request({ comment: "from-foxy-gestures" }), {}, vi.fn());

    const state = vi.mocked(Download.renameAndDownload).mock.calls[0][0];
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

    const state = vi.mocked(Download.renameAndDownload).mock.calls[0][0];
    expect(state.info.context).toBe(DOWNLOAD_TYPES.CLICK);
    expect(state.info.url).toBe("https://x/file.png");
    expect(state.info.currentTab).toBe(trackedTab);
  });

  test("omits the comment when none is supplied", () => {
    onMessage(request(), {}, vi.fn());

    const state = vi.mocked(Download.renameAndDownload).mock.calls[0][0];
    expect(state.info.comment).toBeUndefined();
  });

  test("is reachable from external extensions via onMessageExternal", () => {
    const sendResponse = vi.fn();
    onMessageExternal(request(), { tab: { id: 9 } }, sendResponse);

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

  test("echoes a caller-supplied version back", () => {
    const sendResponse = vi.fn();
    onMessageExternal(download({ url: "https://x/f.png", version: 1 }), {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: { status: MESSAGE_TYPES.OK, version: 1, url: "https://x/f.png" },
    });
  });

  test("rejects a missing url with BAD_REQUEST and does not download", () => {
    const sendResponse = vi.fn();
    onMessageExternal(download({ info: {} }), {}, sendResponse);
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
    onMessageExternal(download({ url: "javascript:alert(1)" }), {}, sendResponse);
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
    const { capabilities } = sendResponse.mock.calls[0][0].body;
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

  test("VALIDATE dry-runs paths and rules and returns errors + preview", () => {
    vi.mocked(router.parseRulesCollecting).mockReturnValue({
      rules: [],
      errors: [{ message: "bad rule", error: "bad rule" }],
    });
    const sendResponse = vi.fn();
    onMessageExternal(
      { type: MESSAGE_TYPES.VALIDATE, body: { paths: " dogs \n>cats", filenamePatterns: "x" } },
      {},
      sendResponse,
    );
    expect(Menus.buildTree).toHaveBeenCalledWith(["dogs", ">cats"]);
    expect(router.parseRulesCollecting).toHaveBeenCalledWith("x");
    const { body } = sendResponse.mock.calls[0][0];
    expect(body.pathErrors).toEqual([]);
    expect(body.ruleErrors).toEqual([{ message: "bad rule", error: "bad rule" }]);
    expect(body.menuPreview).toHaveLength(2);
  });

  test("VALIDATE returns a rule trace when sample download info is supplied", () => {
    const rules = [{ name: "into", value: "images/:filename:", type: "DESTINATION" }] as any;
    vi.mocked(router.parseRulesCollecting).mockReturnValue({ rules, errors: [] });
    vi.mocked(router.traceRules).mockReturnValue({ selectedRule: 1 } as any);
    const info = { url: "https://x/cat.jpg", filename: "cat.jpg" };
    const sendResponse = vi.fn();
    onMessage(
      { type: MESSAGE_TYPES.VALIDATE, body: { filenamePatterns: "x", info } },
      {},
      sendResponse,
    );
    expect(router.traceRules).toHaveBeenCalledWith(rules, info);
    expect(sendResponse.mock.calls[0][0].body.ruleTrace).toEqual({ selectedRule: 1 });
  });

  test("VALIDATE is exposed on the internal listener too", () => {
    const sendResponse = vi.fn();
    onMessage({ type: MESSAGE_TYPES.VALIDATE, body: { paths: "dogs" } }, {}, sendResponse);
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
    expect(global.window.reset).toHaveBeenCalled();
    const { body } = sendResponse.mock.calls[0][0];
    expect(body.applied).toEqual({ prompt: true, paths: "images" });
    expect(body.rejected).toEqual([{ name: "bogus", reason: "unknown option" }]);
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
    expect(sendResponse.mock.calls[0][0].body.rejected).toEqual([
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
    expect(sendResponse.mock.calls[0][0].body.rejected).toEqual([
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
    expect(sendResponse.mock.calls[0][0].body.error).toBe("UNKNOWN_TYPE");
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
      body: { state },
    });
    // The rejection is caught, not left unhandled
    await Promise.resolve();
  });
});

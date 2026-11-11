import {
  MESSAGE_TYPES,
  options,
  Notifier,
  ExternalDownloadRejections,
  onMessage,
  onMessageExternal,
  setupGlobals,
  waitForCall,
} from "./messaging.fixture.ts";
import { MAX_HOVERED_SOURCE_URL_LENGTH } from "../../../src/shared/hovered-source.ts";
import { DATA_URL_MAX_LENGTH } from "../../../src/shared/data-url.ts";

const MenuClick = await import("../../../src/background/menu-click.ts");
const { menuState } = await import("../../../src/background/menu-build.ts");

const pageTab = { id: 7, url: "https://example.com/gallery", title: "Gallery" };
const allowed = { id: "trusted-extension" };
const mapping = (parsedDir: string) => ({ parsedDir, comment: "", menuIndex: "1", title: "" });

type TabAnswers = { hovered?: unknown; opened?: unknown };
const answerTabs = (answers: TabAnswers = {}) => {
  const hovered = answers.hovered ?? null;
  // An explicit undefined is an answer too: a page with no content script.
  const opened = "opened" in answers ? answers.opened : { opened: true };
  global.browser.tabs.sendMessage = vi.fn((_tabId: number, message: { type: string }) =>
    Promise.resolve(message.type === "SAVE_IN_HOVERED_SOURCE" ? hovered : opened),
  ) as never;
};
const tabMessages = (): Array<{ type: string; body?: unknown }> =>
  vi.mocked(global.browser.tabs.sendMessage).mock.calls.map(([, message]) => message);
const openRequests = () => tabMessages().filter(({ type }) => type === "SAVE_IN_OPEN_PICKER");

const send = async (
  listener: typeof onMessage,
  message: unknown,
  sender: Record<string, unknown>,
): Promise<any> => {
  const sendResponse = vi.fn();
  listener(message, sender, sendResponse);
  const [response] = await waitForCall(sendResponse);
  return response;
};
const openPicker = (body?: Record<string, unknown>, sender: Record<string, unknown> = allowed) =>
  send(
    onMessageExternal,
    body === undefined ? { type: "OPEN_PICKER" } : { type: "OPEN_PICKER", body },
    sender,
  );
const failure = (error: string) => ({
  type: "OPEN_PICKER",
  body: { status: MESSAGE_TYPES.ERROR, error, message: expect.any(String), version: 1 },
});

beforeEach(() => {
  setupGlobals();
  Object.assign(options, {
    paths: "Images\nWork",
    links: true,
    page: true,
    selection: false,
    preferLinks: false,
    preferLinksFilterEnabled: false,
    enableLastLocation: true,
    routeHideFolderChoices: false,
    quickSaveEnabled: false,
    quickSaveOnly: false,
    persistPrivateActivity: false,
  });
  Object.assign(menuState, {
    lastUsedPath: null,
    lastUsedMeta: null,
    privateLastUsedPath: null,
    privateLastUsedMeta: null,
    pathMappings: { "save-in-0": mapping("Images"), "save-in-1": mapping("Work") },
  });
  vi.spyOn(MenuClick, "handleContextMenuClick").mockResolvedValue();
  vi.mocked(global.browser.tabs.query).mockResolvedValue([pageTab] as never);
  answerTabs();
});

describe("PICKER_MODEL", () => {
  test("lists the sender tab's destinations by id, title, and key only", async () => {
    menuState.lastUsedPath = "wallpapers";
    menuState.privateLastUsedPath = "private-folder";

    const regular = await send(onMessage, { type: "PICKER_MODEL" }, { tab: pageTab });
    expect(regular).toEqual({
      type: "PICKER_MODEL",
      body: {
        lastUsed: { id: "save-in-last-used", title: "wallpapers", key: "e" },
        items: [
          { kind: "path", id: "save-in-0", title: "Images", parentId: null, key: "1" },
          { kind: "path", id: "save-in-1", title: "Work", parentId: null, key: "2" },
        ],
        copy: {
          title: "Translated<pickerTitle>",
          filter: "Translated<pickerFilter>",
          empty: "Translated<pickerNoMatches>",
          lastUsed: "Translated<contextMenuLastUsed>",
        },
      },
    });

    const isolated = await send(
      onMessage,
      { type: "PICKER_MODEL" },
      { tab: { ...pageTab, incognito: true } },
    );
    expect(isolated.body.lastUsed).toEqual({
      id: "save-in-last-used",
      title: "private-folder",
      key: "e",
    });
    expect((await send(onMessage, { type: "PICKER_MODEL" }, {})).body.lastUsed.title).toBe(
      "wallpapers",
    );
  });

  test("is not an external message", async () => {
    expect(await send(onMessageExternal, { type: "PICKER_MODEL" }, allowed)).toEqual({
      type: "PICKER_MODEL",
      body: { status: MESSAGE_TYPES.ERROR, error: "UNKNOWN_TYPE", version: 1 },
    });
  });
});

describe("PICKER_SAVE", () => {
  const save = (
    body: Record<string, unknown>,
    sender: Record<string, unknown> = { tab: pageTab },
  ) => send(onMessage, { type: "PICKER_SAVE", body }, sender);
  const refused = {
    type: "PICKER_SAVE",
    body: { status: MESSAGE_TYPES.ERROR, error: "BAD_REQUEST" },
  };

  test("saves as a menu click on that item, with the browser's own page address", async () => {
    const response = await save({
      menuItemId: "save-in-1",
      pageUrl: "https://attacker.example/",
      source: {
        media: { url: "https://img.example.com/a.png", kind: "image" },
        linkUrl: "https://example.com/full",
      },
    });

    expect(response).toEqual({ type: MESSAGE_TYPES.OK });
    expect(MenuClick.handleContextMenuClick).toHaveBeenCalledExactlyOnceWith(
      {
        menuItemId: "save-in-1",
        pageUrl: pageTab.url,
        srcUrl: "https://img.example.com/a.png",
        mediaType: "image",
        linkUrl: "https://example.com/full",
      },
      pageTab,
    );
  });

  test("saves the page when the picker was opened for no source", async () => {
    menuState.lastUsedPath = "wallpapers";

    expect(await save({ menuItemId: "save-in-last-used", source: null })).toEqual({
      type: MESSAGE_TYPES.OK,
    });
    expect(await save({ menuItemId: "save-in-0" })).toEqual({ type: MESSAGE_TYPES.OK });
    expect(vi.mocked(MenuClick.handleContextMenuClick).mock.calls).toEqual([
      [{ menuItemId: "save-in-last-used", pageUrl: pageTab.url }, pageTab],
      [{ menuItemId: "save-in-0", pageUrl: pageTab.url }, pageTab],
    ]);
  });

  test("accepts a click-to-save data address beyond the hovered-source bound", async () => {
    const url = `data:image/png;base64,${"A".repeat(MAX_HOVERED_SOURCE_URL_LENGTH)}`;

    expect(
      await save({ menuItemId: "save-in-0", source: { media: { url, kind: "image" } } }),
    ).toEqual({ type: MESSAGE_TYPES.OK });
  });

  test.each([
    ["a path instead of an id", { menuItemId: "Images" }],
    ["an id the menu does not offer", { menuItemId: "save-in-9" }],
    ["a menu action that is not a destination", { menuItemId: "options" }],
    ["Last used when nothing was used yet", { menuItemId: "save-in-last-used" }],
    ["a source it cannot read", { menuItemId: "save-in-0", source: { linkUrl: "javascript:1" } }],
    ["a source that is not a record", { menuItemId: "save-in-0", source: "https://x.test/a" }],
    [
      "an oversized source",
      {
        menuItemId: "save-in-0",
        source: { linkUrl: `data:text/plain,${"x".repeat(DATA_URL_MAX_LENGTH)}` },
      },
    ],
  ])("refuses %s", async (_label, body) => {
    expect(await save(body)).toEqual(refused);
    expect(MenuClick.handleContextMenuClick).not.toHaveBeenCalled();
  });

  test("refuses a sender that is not a page with an address", async () => {
    expect(await save({ menuItemId: "save-in-0" }, {})).toEqual(refused);
    expect(await save({ menuItemId: "save-in-0" }, { tab: { id: 7 } })).toEqual(refused);
    expect(MenuClick.handleContextMenuClick).not.toHaveBeenCalled();
  });

  test("never saves the page in place of a link when link saving is off", async () => {
    options.links = false;

    expect(
      await save({ menuItemId: "save-in-0", source: { linkUrl: "https://example.com/full" } }),
    ).toEqual(refused);
    expect(MenuClick.handleContextMenuClick).not.toHaveBeenCalled();

    // Media stays savable, and so does the page itself.
    await save({
      menuItemId: "save-in-0",
      source: { media: { url: "https://img.example.com/a.png", kind: "image" } },
    });
    await save({ menuItemId: "save-in-0" });
    expect(MenuClick.handleContextMenuClick).toHaveBeenCalledTimes(2);
  });

  test("offers a private tab only what its own menu offers", async () => {
    menuState.lastUsedPath = "wallpapers";
    const privateTab = { ...pageTab, incognito: true };

    expect(await save({ menuItemId: "save-in-last-used" }, { tab: privateTab })).toEqual(refused);
    expect(await save({ menuItemId: "save-in-0" }, { tab: privateTab })).toEqual({
      type: MESSAGE_TYPES.OK,
    });
  });

  test("ignores a malformed request and is not an external message", async () => {
    const sendResponse = vi.fn();
    expect(onMessage({ type: "PICKER_SAVE", body: { menuItemId: "" } }, {}, sendResponse)).toBe(
      undefined,
    );
    expect(onMessage({ type: "PICKER_SAVE" }, {}, sendResponse)).toBe(undefined);
    expect(sendResponse).not.toHaveBeenCalled();
    expect(
      (await send(onMessageExternal, { type: "PICKER_SAVE", body: { menuItemId: "x" } }, allowed))
        .body.error,
    ).toBe("UNKNOWN_TYPE");
  });
});

describe("external OPEN_PICKER", () => {
  test("is advertised and needs the same grant as DOWNLOAD", async () => {
    const pong = await send(onMessageExternal, { type: MESSAGE_TYPES.PING }, {});
    expect(pong.body.capabilities).toContain("open_picker");

    const response = await openPicker({ url: "https://example.com/a.png" }, { id: "untrusted" });
    expect(response).toEqual(failure("UNAUTHORIZED"));
    expect(ExternalDownloadRejections.record).toHaveBeenCalledWith("untrusted", {
      url: "https://example.com/a.png",
    });
    expect(Notifier.reportExternalDownloadRejection).toHaveBeenCalledWith("untrusted");
    expect(global.browser.tabs.query).not.toHaveBeenCalled();
    expect(global.browser.tabs.sendMessage).not.toHaveBeenCalled();
  });

  test("a refused private-window caller leaves no record", async () => {
    const response = await openPicker(undefined, {
      id: "untrusted",
      tab: { ...pageTab, incognito: true },
    });

    expect(response).toEqual(failure("UNAUTHORIZED"));
    expect(ExternalDownloadRejections.record).not.toHaveBeenCalled();
    expect(Notifier.reportExternalDownloadRejection).not.toHaveBeenCalled();
  });

  test("opens in the active tab for what the pointer is over", async () => {
    const hovered = { media: { url: "https://img.example.com/a.png", kind: "image" } };
    answerTabs({ hovered });

    expect(await openPicker()).toEqual({
      type: "OPEN_PICKER",
      body: { status: MESSAGE_TYPES.OK, version: 1 },
    });
    expect(global.browser.tabs.query).toHaveBeenCalledWith({
      active: true,
      lastFocusedWindow: true,
    });
    expect(vi.mocked(global.browser.tabs.sendMessage).mock.calls).toEqual([
      [7, { type: "SAVE_IN_HOVERED_SOURCE" }, { frameId: 0 }],
      [7, { type: "SAVE_IN_OPEN_PICKER", body: { source: hovered } }, { frameId: 0 }],
    ]);
    expect(MenuClick.handleContextMenuClick).not.toHaveBeenCalled();
  });

  test("opens for the page when nothing savable is under the pointer", async () => {
    options.links = false;
    answerTabs({ hovered: { linkUrl: "https://example.com/full" } });

    expect((await openPicker({ version: 3 })).body).toEqual({
      status: MESSAGE_TYPES.OK,
      version: 3,
    });
    expect(openRequests()).toEqual([{ type: "SAVE_IN_OPEN_PICKER", body: { source: null } }]);
  });

  test("prefers the tab the request came from", async () => {
    const senderTab = { id: 12, url: "https://sender.example/" };

    await openPicker(undefined, { ...allowed, tab: senderTab });

    expect(global.browser.tabs.query).not.toHaveBeenCalled();
    expect(vi.mocked(global.browser.tabs.sendMessage).mock.calls.map(([tabId]) => tabId)).toEqual([
      12, 12,
    ]);
  });

  test("opens for a named address without asking the page what is hovered", async () => {
    await openPicker({ url: "https://example.com/a b.png" });
    await openPicker({ url: "https://example.com/clip.mp4", kind: "video" });

    expect(tabMessages()).toEqual([
      {
        type: "SAVE_IN_OPEN_PICKER",
        body: { source: { linkUrl: "https://example.com/a%20b.png" } },
      },
      {
        type: "SAVE_IN_OPEN_PICKER",
        body: { source: { media: { url: "https://example.com/clip.mp4", kind: "video" } } },
      },
    ]);
  });

  test.each([
    ["a private active tab", [{ ...pageTab, incognito: true }]],
    ["no active tab", []],
    ["an active tab without an address", [{ id: 7 }]],
  ])("answers %s like a missing tab", async (_label, tabs) => {
    vi.mocked(global.browser.tabs.query).mockResolvedValue(tabs as never);

    expect(await openPicker()).toEqual(failure("BAD_REQUEST"));
    expect(global.browser.tabs.sendMessage).not.toHaveBeenCalled();
  });

  test("never opens in a private tab, even one the request came from", async () => {
    const response = await openPicker(
      { url: "https://example.com/a.png" },
      { ...allowed, tab: { ...pageTab, incognito: true } },
    );

    expect(response).toEqual(failure("BAD_REQUEST"));
    expect(global.browser.tabs.sendMessage).not.toHaveBeenCalled();
  });

  test("treats a failed tab lookup as no tab", async () => {
    vi.mocked(global.browser.tabs.query).mockRejectedValue(new Error("no window"));

    expect(await openPicker()).toEqual(failure("BAD_REQUEST"));
  });

  test.each([
    ["a script address", { url: "javascript:alert(1)" }],
    ["an extension page", { url: "moz-extension://id/options.html" }],
    ["a blob address from no tab", { url: "blob:https://example.com/1" }],
    [
      "an address too long to hand to the page",
      { url: `data:text/plain,${"x".repeat(DATA_URL_MAX_LENGTH)}` },
    ],
  ])("rejects %s as INVALID_URL", async (_label, body) => {
    expect(await openPicker(body)).toEqual(failure("INVALID_URL"));
    expect(global.browser.tabs.sendMessage).not.toHaveBeenCalled();
  });

  test("accepts a blob address from the tab that owns it", async () => {
    const response = await openPicker(
      { url: "blob:https://example.com/1", kind: "image" },
      { ...allowed, tab: pageTab },
    );

    expect(response.body.status).toBe(MESSAGE_TYPES.OK);
  });

  test("refuses a link while link saving is off, and a tab with nothing to save", async () => {
    options.links = false;
    expect(await openPicker({ url: "https://example.com/full" })).toEqual(failure("BAD_REQUEST"));
    expect(
      (await openPicker({ url: "https://example.com/a.png", kind: "image" })).body.status,
    ).toBe(MESSAGE_TYPES.OK);

    options.page = false;
    vi.mocked(global.browser.tabs.sendMessage).mockClear();
    expect(await openPicker()).toEqual(failure("BAD_REQUEST"));
    expect(openRequests()).toEqual([]);
  });

  test.each([
    ["a restricted page or an older content script", undefined],
    ["a page that declined, such as a disabled site", { opened: false }],
    ["an unexpected answer", "opened"],
  ])("reports UNAVAILABLE for %s", async (_label, opened) => {
    answerTabs({ opened });

    expect(await openPicker({ url: "https://example.com/a.png" })).toEqual(failure("UNAVAILABLE"));
  });

  test("rejects a malformed request before any handler runs", async () => {
    for (const body of [{ kind: "document" }, { url: 7 }, { version: 0 }]) {
      expect(await send(onMessageExternal, { type: "OPEN_PICKER", body }, allowed)).toEqual({
        type: "OPEN_PICKER",
        body: { status: MESSAGE_TYPES.ERROR, error: "BAD_REQUEST", version: 1 },
      });
    }
    expect(global.browser.tabs.sendMessage).not.toHaveBeenCalled();
  });

  test("the extension's own pages may open it for a private tab", async () => {
    const privateTab = { ...pageTab, incognito: true };

    const response = await send(
      onMessage,
      { type: "OPEN_PICKER", body: { url: "blob:https://example.com/1" } },
      { tab: privateTab },
    );

    expect(response.body.status).toBe(MESSAGE_TYPES.OK);
  });
});

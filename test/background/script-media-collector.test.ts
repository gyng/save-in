// Opt-in webRequest collector: observes media-carrying requests, buffers only
// recognized media per tab, and pushes it (debounced) to the tab's panel. State
// is module-local, so each test re-imports it fresh.
import { SCRIPT_MEDIA_BY_TAB_SESSION_KEY } from "../../src/shared/storage-keys.ts";

type Details = { url: string; tabId: number; type: string };

// A cold worker whose only record of a tab lives in storage.session.
const withStoredTab = (tabId: number, entries: Array<{ url: string; kind: string }>) =>
  vi.mocked(browser.storage.session.get).mockResolvedValue({
    [SCRIPT_MEDIA_BY_TAB_SESSION_KEY]: { [String(tabId)]: entries },
  });

const setup = async (optionOverrides: Record<string, unknown> = {}, withWebRequest = true) => {
  vi.resetModules();
  vi.useRealTimers();
  const onBeforeRequest = { addListener: vi.fn(), removeListener: vi.fn() };
  (browser as any).webRequest = withWebRequest ? { onBeforeRequest } : undefined;
  (browser as any).permissions = {
    contains: vi.fn(() => Promise.resolve(true)),
    onAdded: { addListener: vi.fn() },
    onRemoved: { addListener: vi.fn() },
  };
  (browser as any).tabs.onRemoved = { addListener: vi.fn() };
  vi.mocked(browser.storage.session.get).mockResolvedValue({});
  vi.mocked(browser.storage.session.set).mockResolvedValue(undefined);
  vi.mocked(browser.tabs.sendMessage).mockResolvedValue(undefined);

  const { options } = await import("../../src/config/options-data.ts");
  Object.assign(options, {
    sourcePanelEnabled: true,
    sourcePanelScriptMedia: true,
    ...optionOverrides,
  });
  const mod = await import("../../src/background/script-media-collector.ts");
  mod.registerScriptMediaCollector();
  const listener = onBeforeRequest.addListener.mock.calls[0]?.[0] as
    | ((details: Details) => void)
    | undefined;
  return { mod, listener, onBeforeRequest };
};

const lastSend = () =>
  vi.mocked(browser.tabs.sendMessage).mock.calls.at(-1) as [number, any] | undefined;

afterEach(() => {
  Reflect.deleteProperty(browser as any, "webRequest");
  Reflect.deleteProperty(browser as any, "permissions");
  vi.clearAllMocks();
});

test("registers the onBeforeRequest listener when webRequest is available", async () => {
  const { onBeforeRequest } = await setup();
  expect(onBeforeRequest.addListener).toHaveBeenCalledWith(expect.any(Function), {
    urls: ["<all_urls>"],
    // main_frame must be observed so a top-level navigation resets the tab.
    types: ["xmlhttprequest", "media", "object", "other", "main_frame"],
  });
});

test("does not register a listener without the webRequest permission/api", async () => {
  const { listener } = await setup({}, false);
  expect(listener).toBeUndefined();
});

test("buffers a stream manifest and pushes it to the tab", async () => {
  const { listener } = await setup();
  listener!({
    url: "https://cdn.example/live/master.m3u8?token=1",
    tabId: 7,
    type: "xmlhttprequest",
  });

  await vi.waitFor(() => expect(browser.tabs.sendMessage).toHaveBeenCalled());
  const [tabId, message] = lastSend()!;
  expect(tabId).toBe(7);
  expect(message.type).toBe("SCRIPT_MEDIA_DETECTED");
  expect(message.body.sources).toEqual([
    { url: "https://cdn.example/live/master.m3u8?token=1", kind: "stream" },
  ]);
});

test("ignores non-media requests", async () => {
  const { listener } = await setup();
  listener!({ url: "https://example.com/app.js", tabId: 7, type: "xmlhttprequest" });
  listener!({ url: "https://example.com/api/data.json", tabId: 7, type: "xmlhttprequest" });

  await new Promise((r) => setTimeout(r, 350));
  expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
});

test("treats an extensionless media-typed request as video", async () => {
  const { listener } = await setup();
  listener!({ url: "https://example.com/stream/segment", tabId: 3, type: "media" });

  await vi.waitFor(() => expect(browser.tabs.sendMessage).toHaveBeenCalled());
  expect(lastSend()![1].body.sources[0]).toEqual({
    url: "https://example.com/stream/segment",
    kind: "video",
  });
});

test("does nothing while the option is off", async () => {
  const { listener } = await setup({ sourcePanelScriptMedia: false });
  listener!({ url: "https://example.com/video.mp4", tabId: 7, type: "media" });

  await new Promise((r) => setTimeout(r, 350));
  expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
});

test("ignores non-http requests and tab-less requests", async () => {
  const { listener } = await setup();
  listener!({ url: "blob:https://example.com/abc", tabId: 7, type: "media" });
  listener!({ url: "https://example.com/video.mp4", tabId: -1, type: "media" });

  await new Promise((r) => setTimeout(r, 350));
  expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
});

test("forgets a tab's media on a top-level navigation", async () => {
  const { listener, mod } = await setup();
  listener!({ url: "https://example.com/a.mp4", tabId: 7, type: "media" });
  await vi.waitFor(() => expect(browser.tabs.sendMessage).toHaveBeenCalled());
  vi.mocked(browser.tabs.sendMessage).mockClear();

  listener!({ url: "https://example.com/next", tabId: 7, type: "main_frame" });
  mod.pushBufferedScriptMedia(7);

  await new Promise((r) => setTimeout(r, 50));
  expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
});

test("pushBufferedScriptMedia replays a tab's buffered media on panel open", async () => {
  const { listener, mod } = await setup();
  listener!({ url: "https://example.com/a.m3u8", tabId: 9, type: "xmlhttprequest" });
  await vi.waitFor(() => expect(browser.tabs.sendMessage).toHaveBeenCalled());
  vi.mocked(browser.tabs.sendMessage).mockClear();

  mod.pushBufferedScriptMedia(9);
  await vi.waitFor(() => expect(browser.tabs.sendMessage).toHaveBeenCalled());
  expect(lastSend()![1].body.sources).toEqual([
    { url: "https://example.com/a.m3u8", kind: "stream" },
  ]);
});

test("rehydrates a tab's media from session storage after a worker restart", async () => {
  const { mod } = await setup();
  withStoredTab(4, [{ url: "https://cdn.example/live.m3u8", kind: "stream" }]);

  // Cold worker: nothing is in memory, only the persisted snapshot.
  mod.pushBufferedScriptMedia(4);
  await vi.waitFor(() => expect(browser.tabs.sendMessage).toHaveBeenCalled());
  expect(lastSend()![1].body.sources).toEqual([
    { url: "https://cdn.example/live.m3u8", kind: "stream" },
  ]);
});

test("a top-level navigation resets a tab restored from session storage (cold worker)", async () => {
  const { listener, mod } = await setup();
  withStoredTab(7, [{ url: "https://old.example/a.m3u8", kind: "stream" }]);

  // The main_frame request is the first event to touch tab 7 after the restart;
  // it must hydrate the stored buffer and then drop it, not leave it to be
  // resurrected by the next request.
  listener!({ url: "https://new.example/", tabId: 7, type: "main_frame" });
  // dropTab persists the (now tab-7-less) buffer — wait for that write.
  await vi.waitFor(() => expect(browser.storage.session.set).toHaveBeenCalled());
  vi.mocked(browser.tabs.sendMessage).mockClear();

  mod.pushBufferedScriptMedia(7);
  await new Promise((r) => setTimeout(r, 50));
  expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
});

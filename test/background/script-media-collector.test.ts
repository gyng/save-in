// Opt-in webRequest collector: observes media-carrying requests, buffers only
// recognized media per tab, and pushes it (debounced) to the tab's panel. State
// is module-local, so each test re-imports it fresh.
import {
  SCRIPT_MEDIA_BY_TAB_SESSION_KEY,
  SCRIPT_MEDIA_STREAM_DOCUMENTS_SESSION_KEY,
} from "../../src/shared/storage-keys.ts";

type Details = {
  url: string;
  tabId: number;
  type: string;
  incognito?: boolean;
  timeStamp?: number;
  frameId?: number;
  parentFrameId?: number;
  frameType?: string;
  documentId?: string;
  parentDocumentId?: string;
};

// A visit that began before every test's requests and names no document, so
// only the whole-file and kind checks decide.
const ANY_VISIT = { start: 0 };

// A cold worker whose only record of a tab lives in storage.session.
const withStoredTab = (tabId: number, entries: Array<Record<string, unknown>>) =>
  vi.mocked(browser.storage.session.get).mockResolvedValue({
    [SCRIPT_MEDIA_BY_TAB_SESSION_KEY]: { [String(tabId)]: entries },
  });

const setup = async (
  optionOverrides: Record<string, unknown> = {},
  withWebRequest = true,
  permissionHeld = true,
  contains: (() => Promise<boolean>) | null = vi.fn(() => Promise.resolve(permissionHeld)),
) => {
  vi.resetModules();
  vi.useRealTimers();
  const onBeforeRequest = { addListener: vi.fn(), removeListener: vi.fn() };
  (browser as any).webRequest = withWebRequest ? { onBeforeRequest } : undefined;
  (browser as any).permissions = {
    ...(contains ? { contains } : {}),
    onAdded: { addListener: vi.fn() },
    onRemoved: { addListener: vi.fn() },
  };
  (browser as any).tabs.onRemoved = { addListener: vi.fn() };
  vi.mocked(browser.storage.session.get).mockResolvedValue({});
  vi.mocked(browser.storage.session.set).mockResolvedValue(undefined);
  vi.mocked(browser.tabs.get).mockResolvedValue({ incognito: false } as browser.tabs.Tab);
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

test("removes the dormant listener when permissions.contains is unavailable", async () => {
  const { onBeforeRequest } = await setup({}, true, true, null);
  await vi.waitFor(() => expect(onBeforeRequest.removeListener).toHaveBeenCalledTimes(1));
});

test("drops the listener and refuses requests when webRequest is not held at startup", async () => {
  const { listener, onBeforeRequest } = await setup({}, true, false);
  listener!({ url: "https://example.com/video.mp4", tabId: 7, type: "media" });

  await vi.waitFor(() => expect(onBeforeRequest.removeListener).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
  expect(browser.storage.session.remove).toHaveBeenCalledWith([
    SCRIPT_MEDIA_BY_TAB_SESSION_KEY,
    SCRIPT_MEDIA_STREAM_DOCUMENTS_SESSION_KEY,
  ]);
});

test("shares a pending startup permission proof with the waking request", async () => {
  let resolveContains: (held: boolean) => void = () => {};
  const contains = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        resolveContains = resolve;
      }),
  );
  const { listener } = await setup({}, true, true, contains);
  listener!({ url: "https://example.com/video.mp4", tabId: 7, type: "media" });

  expect(contains).toHaveBeenCalledTimes(1);
  resolveContains(true);
  await vi.waitFor(() => expect(browser.tabs.sendMessage).toHaveBeenCalled());
});

test("does not let a stale positive startup check undo an explicit revoke", async () => {
  let resolveContains: (held: boolean) => void = () => {};
  const contains = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        resolveContains = resolve;
      }),
  );
  const { onBeforeRequest } = await setup({}, true, true, contains);
  const onRemoved = (browser as any).permissions.onRemoved.addListener.mock
    .calls[0][0] as (permissions: { permissions: string[] }) => void;

  onRemoved({ permissions: ["webRequest"] });
  resolveContains(true);
  await drain();

  expect(onBeforeRequest.removeListener).toHaveBeenCalledTimes(1);
});

test("does not let a stale failed startup check overwrite an explicit revoke", async () => {
  let rejectContains: (error: Error) => void = () => {};
  const contains = vi.fn(
    () =>
      new Promise<boolean>((_resolve, reject) => {
        rejectContains = reject;
      }),
  );
  const { onBeforeRequest } = await setup({}, true, true, contains);
  (
    (browser as any).permissions.onRemoved.addListener.mock.calls[0][0] as (permissions: {
      permissions: string[];
    }) => void
  )({ permissions: ["webRequest"] });

  rejectContains(new Error("stale lookup"));
  await drain();
  expect(onBeforeRequest.removeListener).toHaveBeenCalledTimes(1);
});

test("does not let a stale negative startup check undo an explicit grant", async () => {
  let resolveContains: (held: boolean) => void = () => {};
  const contains = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        resolveContains = resolve;
      }),
  );
  const { listener, onBeforeRequest } = await setup({}, true, true, contains);
  (
    (browser as any).permissions.onAdded.addListener.mock.calls[0][0] as (permissions: {
      permissions: string[];
    }) => void
  )({ permissions: ["webRequest"] });

  resolveContains(false);
  await drain();
  listener!({ url: "https://cdn.example/live.m3u8", tabId: 7, type: "xmlhttprequest" });

  await vi.waitFor(() => expect(browser.tabs.sendMessage).toHaveBeenCalled());
  expect(onBeforeRequest.removeListener).not.toHaveBeenCalled();
});

test("keeps a failed permission check fail-closed and retryable", async () => {
  const contains = vi
    .fn<() => Promise<boolean>>()
    .mockRejectedValueOnce(new Error("permission lookup failed"))
    .mockResolvedValueOnce(true);
  const { listener } = await setup({}, true, true, contains);
  await drain();

  listener!({ url: "https://example.com/video.mp4", tabId: 7, type: "media" });
  await vi.waitFor(() => expect(browser.tabs.sendMessage).toHaveBeenCalled());
  expect(contains).toHaveBeenCalledTimes(2);
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
  expect(message.body.sources).toMatchObject([
    { url: "https://cdn.example/live/master.m3u8?token=1", kind: "stream" },
  ]);
});

test("shows Firefox private media without persisting its identifying URL", async () => {
  const { listener } = await setup();
  listener!({
    url: "https://private.example/live/master.m3u8",
    tabId: 7,
    type: "xmlhttprequest",
    incognito: true,
  });

  await vi.waitFor(() => expect(browser.storage.session.set).toHaveBeenCalled());
  expect(browser.tabs.sendMessage).toHaveBeenCalled();
  const stored = vi.mocked(browser.storage.session.set).mock.calls.at(-1)?.[0] as Record<
    string,
    Record<string, unknown>
  >;
  expect(stored[SCRIPT_MEDIA_BY_TAB_SESSION_KEY]?.["7"]).toBeUndefined();
  expect(browser.tabs.get).not.toHaveBeenCalled();
});

test("resolves Chrome private-tab state before deciding what may persist", async () => {
  const { listener } = await setup();
  vi.mocked(browser.tabs.get).mockResolvedValue({ incognito: true } as browser.tabs.Tab);
  listener!({
    url: "https://private.example/live/master.m3u8",
    tabId: 8,
    type: "xmlhttprequest",
  });

  await vi.waitFor(() => expect(browser.storage.session.set).toHaveBeenCalled());
  expect(browser.tabs.get).toHaveBeenCalledWith(8);
  const stored = vi.mocked(browser.storage.session.set).mock.calls.at(-1)?.[0] as Record<
    string,
    Record<string, unknown>
  >;
  expect(stored[SCRIPT_MEDIA_BY_TAB_SESSION_KEY]?.["8"]).toBeUndefined();
});

test("fails closed on persistence when Chrome cannot resolve the request tab", async () => {
  const { listener } = await setup();
  vi.mocked(browser.tabs.get).mockRejectedValue(new Error("tab disappeared"));
  listener!({
    url: "https://unknown.example/live/master.m3u8",
    tabId: 9,
    type: "xmlhttprequest",
  });

  await vi.waitFor(() => expect(browser.storage.session.set).toHaveBeenCalled());
  expect(browser.tabs.sendMessage).toHaveBeenCalled();
  const stored = vi.mocked(browser.storage.session.set).mock.calls.at(-1)?.[0] as Record<
    string,
    Record<string, unknown>
  >;
  expect(stored[SCRIPT_MEDIA_BY_TAB_SESSION_KEY]?.["9"]).toBeUndefined();
});

test("fails closed on persistence when Chrome tab lookup throws synchronously", async () => {
  const { listener } = await setup();
  vi.mocked(browser.tabs.get).mockImplementation(() => {
    throw new Error("extension context invalidated");
  });
  listener!({
    url: "https://unknown.example/live/master.m3u8",
    tabId: 10,
    type: "xmlhttprequest",
  });

  await vi.waitFor(() => expect(browser.storage.session.set).toHaveBeenCalled());
  expect(browser.tabs.sendMessage).toHaveBeenCalled();
  const stored = vi.mocked(browser.storage.session.set).mock.calls.at(-1)?.[0] as Record<
    string,
    Record<string, unknown>
  >;
  expect(stored[SCRIPT_MEDIA_BY_TAB_SESSION_KEY]?.["10"]).toBeUndefined();
});

test("drops a prior public buffer if the same tab id is later classified private", async () => {
  const { listener, mod } = await setup();
  listener!({
    url: "https://public.example/old.mp4",
    tabId: 11,
    type: "media",
    incognito: false,
  });
  await vi.waitFor(() => expect(browser.tabs.sendMessage).toHaveBeenCalled());
  vi.mocked(browser.tabs.sendMessage).mockClear();

  listener!({
    url: "https://private.example/new.mp4",
    tabId: 11,
    type: "media",
    incognito: true,
  });
  await vi.waitFor(() => expect(browser.tabs.sendMessage).toHaveBeenCalled());
  vi.mocked(browser.tabs.sendMessage).mockClear();
  mod.pushBufferedScriptMedia(11);
  await vi.waitFor(() => expect(browser.tabs.sendMessage).toHaveBeenCalled());

  expect(lastSend()![1].body.sources).toMatchObject([
    { url: "https://private.example/new.mp4", kind: "video" },
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
  expect(lastSend()![1].body.sources[0]).toMatchObject({
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
  expect(lastSend()![1].body.sources).toMatchObject([
    { url: "https://example.com/a.m3u8", kind: "stream" },
  ]);
});

test("rehydrates a tab's media from session storage after a worker restart", async () => {
  const { mod } = await setup();
  withStoredTab(4, [{ url: "https://cdn.example/live.m3u8", kind: "stream" }]);

  // Cold worker: nothing is in memory, only the persisted snapshot.
  mod.pushBufferedScriptMedia(4);
  await vi.waitFor(() => expect(browser.tabs.sendMessage).toHaveBeenCalled());
  expect(lastSend()![1].body.sources).toMatchObject([
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

test("a permission revoke mid-hydrate does not resurrect buffers or push stale media", async () => {
  await setup();
  // Hang the in-flight hydrate's storage read so a revoke can interleave with
  // the still-pending record callback.
  let resolveGet: (value: Record<string, unknown>) => void = () => {};
  vi.mocked(browser.storage.session.get).mockReturnValue(
    new Promise<Record<string, unknown>>((resolve) => {
      resolveGet = resolve;
    }),
  );
  const listener = (browser as any).webRequest.onBeforeRequest.addListener.mock.calls[0][0] as (
    d: Details,
  ) => void;

  // A media request wakes the worker and starts a (now pending) hydrate.
  listener({ url: "https://cdn.example/live.m3u8", tabId: 5, type: "xmlhttprequest" });
  await vi.waitFor(() => expect(browser.storage.session.get).toHaveBeenCalled());

  // The user revokes webRequest while hydrate is still awaiting storage.
  (browser as any).permissions.contains = vi.fn(() => Promise.resolve(false));
  const onRemoved = (browser as any).permissions.onRemoved.addListener.mock
    .calls[0][0] as () => void;
  onRemoved();
  await Promise.resolve();
  await Promise.resolve(); // let contains().then(stopListening) run

  // Now let the pre-revoke storage snapshot resolve; the deferred record must
  // be dropped by the generation guard.
  resolveGet({});
  await new Promise((r) => setTimeout(r, 350));

  expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
  // stopListening removes the session key; nothing may re-persist it.
  expect(browser.storage.session.set).not.toHaveBeenCalled();
});

test("closing a tab drops its session-stored media on a cold worker (no reuse leak)", async () => {
  const { mod } = await setup();
  withStoredTab(5, [{ url: "https://old.example/a.m3u8", kind: "stream" }]);

  // Tab close wakes a cold worker whose buffer is empty; the drop must hydrate
  // the persisted buffer first so the entry is actually removed, not left for a
  // reused tabId to resurrect.
  const onTabRemoved = (browser as any).tabs.onRemoved.addListener.mock.calls[0][0] as (
    id: number,
  ) => void;
  onTabRemoved(5);
  // dropTab persists the (now tab-5-less) buffer — only reached if hydrate ran.
  await vi.waitFor(() => expect(browser.storage.session.set).toHaveBeenCalled());

  mod.pushBufferedScriptMedia(5);
  await new Promise((r) => setTimeout(r, 50));
  expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
});

test("clears a pending flush timer when the collector is torn down mid-debounce", async () => {
  const { listener } = await setup();
  listener!({ url: "https://cdn.example/live.m3u8", tabId: 3, type: "xmlhttprequest" });
  // Drain the hydrate → record microtasks so the 300ms flush is scheduled but
  // has not yet fired.
  for (let i = 0; i < 6; i += 1) await Promise.resolve();

  // Revoke before the flush fires; stopListening must clear the pending timer.
  (browser as any).permissions.contains = vi.fn(() => Promise.resolve(false));
  ((browser as any).permissions.onRemoved.addListener.mock.calls[0][0] as () => void)();
  for (let i = 0; i < 6; i += 1) await Promise.resolve();

  await new Promise((r) => setTimeout(r, 350));
  expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
});

test("tears down when onRemoved fires and contains() is unavailable", async () => {
  const { onBeforeRequest } = await setup();
  (browser as any).permissions.contains = undefined;

  ((browser as any).permissions.onRemoved.addListener.mock.calls[0][0] as () => void)();
  expect(onBeforeRequest.removeListener).toHaveBeenCalled();
});

const replayBuffer = async (
  mod: { pushBufferedScriptMedia: (id: number) => void },
  tabId: number,
) => {
  await vi.waitFor(() => expect(browser.tabs.sendMessage).toHaveBeenCalled());
  vi.mocked(browser.tabs.sendMessage).mockClear();
  mod.pushBufferedScriptMedia(tabId);
  await vi.waitFor(() => expect(browser.tabs.sendMessage).toHaveBeenCalled());
  return lastSend()![1].body.sources as Array<{ url: string; kind: string }>;
};

test("caps a tab's buffer, evicting the oldest non-stream first", async () => {
  const { listener, mod } = await setup();
  for (let i = 0; i < 257; i += 1) {
    listener!({ url: `https://cdn.example/v${i}.mp4`, tabId: 2, type: "media" });
  }
  const sources = await replayBuffer(mod, 2);
  expect(sources).toHaveLength(256);
  // The oldest video was evicted; the newest survives.
  expect(sources.some((s) => s.url === "https://cdn.example/v0.mp4")).toBe(false);
  expect(sources.some((s) => s.url === "https://cdn.example/v256.mp4")).toBe(true);
});

test("evicts the oldest stream only when every buffered entry is a stream", async () => {
  const { listener, mod } = await setup();
  for (let i = 0; i < 257; i += 1) {
    listener!({ url: `https://cdn.example/s${i}.m3u8`, tabId: 4, type: "xmlhttprequest" });
  }
  const sources = await replayBuffer(mod, 4);
  expect(sources).toHaveLength(256);
  expect(sources.every((s) => s.kind === "stream")).toBe(true);
  expect(sources.some((s) => s.url === "https://cdn.example/s0.m3u8")).toBe(false);
});

test("refreshes recency for a repeated url without duplicating it", async () => {
  const { listener, mod } = await setup();
  listener!({ url: "https://cdn.example/dup.mp4", tabId: 6, type: "media" });
  listener!({ url: "https://cdn.example/dup.mp4", tabId: 6, type: "media" });
  const sources = await replayBuffer(mod, 6);
  expect(sources).toHaveLength(1);
});

const drain = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const fireOnRemoved = () =>
  ((browser as any).permissions.onRemoved.addListener.mock.calls[0][0] as () => void)();

test("keeps observing when onRemoved fires but webRequest is still held", async () => {
  const { onBeforeRequest } = await setup(); // contains() defaults to true
  fireOnRemoved();
  await drain();
  expect(onBeforeRequest.removeListener).not.toHaveBeenCalled();
});

test("ignores an explicit unrelated permission removal", async () => {
  const { onBeforeRequest } = await setup();
  (
    (browser as any).permissions.onRemoved.addListener.mock.calls[0][0] as (permissions: {
      permissions: string[];
    }) => void
  )({ permissions: ["notifications"] });
  await drain();
  expect(onBeforeRequest.removeListener).not.toHaveBeenCalled();
});

test("tears down immediately for an explicit webRequest removal", async () => {
  const { onBeforeRequest } = await setup();
  (
    (browser as any).permissions.onRemoved.addListener.mock.calls[0][0] as (permissions: {
      permissions: string[];
    }) => void
  )({ permissions: ["webRequest"] });
  expect(onBeforeRequest.removeListener).toHaveBeenCalledTimes(1);
});

test("re-attaches the listener when the permission is granted again after a revoke", async () => {
  const { onBeforeRequest } = await setup();
  (browser as any).permissions.contains = vi.fn(() => Promise.resolve(false));
  fireOnRemoved();
  await drain();
  expect(onBeforeRequest.removeListener).toHaveBeenCalledTimes(1);

  onBeforeRequest.addListener.mockClear();
  (
    (browser as any).permissions.onAdded.addListener.mock.calls[0][0] as (permissions: {
      permissions: string[];
    }) => void
  )({ permissions: ["webRequest"] });
  expect(onBeforeRequest.addListener).toHaveBeenCalledTimes(1);
});

test("rebinds the listener from the authoritative permission after config apply", async () => {
  const { mod, onBeforeRequest } = await setup({}, true, false);
  await vi.waitFor(() => expect(onBeforeRequest.removeListener).toHaveBeenCalledTimes(1));
  onBeforeRequest.addListener.mockClear();
  onBeforeRequest.removeListener.mockClear();
  (browser as any).permissions.contains = vi.fn(() => Promise.resolve(true));

  await mod.refreshScriptMediaCollectorPermission();

  expect(onBeforeRequest.addListener).toHaveBeenCalledTimes(1);
  expect(onBeforeRequest.removeListener).not.toHaveBeenCalled();
});

test("rebinds an already attached listener after config apply", async () => {
  const { mod, onBeforeRequest } = await setup();
  await drain();
  onBeforeRequest.addListener.mockClear();
  onBeforeRequest.removeListener.mockClear();

  await mod.refreshScriptMediaCollectorPermission();

  expect(onBeforeRequest.removeListener).toHaveBeenCalledTimes(1);
  expect(onBeforeRequest.addListener).toHaveBeenCalledTimes(1);
});

test("refresh is a safe no-op when the webRequest API is unavailable", async () => {
  const { mod } = await setup({}, false);
  await expect(mod.refreshScriptMediaCollectorPermission()).resolves.toBeUndefined();
});

test("refresh stays fail-closed when the permission check fails", async () => {
  const contains = vi
    .fn<() => Promise<boolean>>()
    .mockResolvedValueOnce(true)
    .mockRejectedValueOnce(new Error("permission lookup failed"));
  const { mod, onBeforeRequest } = await setup({}, true, true, contains);
  await drain();
  onBeforeRequest.addListener.mockClear();
  onBeforeRequest.removeListener.mockClear();

  await mod.refreshScriptMediaCollectorPermission();

  expect(onBeforeRequest.removeListener).not.toHaveBeenCalled();
  expect(onBeforeRequest.addListener).not.toHaveBeenCalled();
});

test("re-checks and re-attaches when a host omits permission event details", async () => {
  const { onBeforeRequest } = await setup();
  (
    (browser as any).permissions.onRemoved.addListener.mock.calls[0][0] as (permissions: {
      permissions: string[];
    }) => void
  )({ permissions: ["webRequest"] });
  onBeforeRequest.addListener.mockClear();
  (browser as any).permissions.contains = vi.fn(() => Promise.resolve(true));

  ((browser as any).permissions.onAdded.addListener.mock.calls[0][0] as () => void)();
  await drain();
  expect(onBeforeRequest.addListener).toHaveBeenCalledTimes(1);
});

test("does not re-attach when a detail-less permission event re-checks false", async () => {
  const { onBeforeRequest } = await setup();
  (
    (browser as any).permissions.onRemoved.addListener.mock.calls[0][0] as (permissions: {
      permissions: string[];
    }) => void
  )({ permissions: ["webRequest"] });
  onBeforeRequest.addListener.mockClear();
  (browser as any).permissions.contains = vi.fn(() => Promise.resolve(false));

  ((browser as any).permissions.onAdded.addListener.mock.calls[0][0] as () => void)();
  await drain();
  expect(onBeforeRequest.addListener).not.toHaveBeenCalled();
});

test("does not re-attach for an unrelated permission grant", async () => {
  const { onBeforeRequest } = await setup();
  (browser as any).permissions.contains = vi.fn(() => Promise.resolve(false));
  fireOnRemoved();
  await drain();
  onBeforeRequest.addListener.mockClear();

  (
    (browser as any).permissions.onAdded.addListener.mock.calls[0][0] as (permissions: {
      permissions: string[];
    }) => void
  )({ permissions: ["notifications"] });
  await drain();
  expect(onBeforeRequest.addListener).not.toHaveBeenCalled();
});

test("does not replay a stored buffer after webRequest is revoked", async () => {
  const { mod } = await setup();
  withStoredTab(12, [{ url: "https://old.example/a.m3u8", kind: "stream" }]);
  vi.mocked(browser.storage.session.remove).mockRejectedValue(new Error("remove failed"));
  (browser as any).permissions.contains = vi.fn(() => Promise.resolve(false));

  fireOnRemoved();
  await drain();
  mod.pushBufferedScriptMedia(12);
  await new Promise((resolve) => setTimeout(resolve, 50));

  expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
});

test("drops a panel replay queued before an explicit mid-hydrate revoke", async () => {
  const { mod } = await setup();
  const release = frozenHydrate();
  mod.pushBufferedScriptMedia(12);
  await drain();

  (
    (browser as any).permissions.onRemoved.addListener.mock.calls[0][0] as (permissions: {
      permissions: string[];
    }) => void
  )({ permissions: ["webRequest"] });
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));

  expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
});

test("a second revoke after teardown is a no-op", async () => {
  const { onBeforeRequest } = await setup();
  (browser as any).permissions.contains = vi.fn(() => Promise.resolve(false));
  fireOnRemoved();
  await drain();
  fireOnRemoved(); // listening is already false → early return
  await drain();
  expect(onBeforeRequest.removeListener).toHaveBeenCalledTimes(1);
});

test("teardown is a safe no-op when the webRequest API is already gone", async () => {
  await setup();
  Reflect.deleteProperty(browser as any, "webRequest");
  (browser as any).permissions.contains = undefined;
  expect(() => fireOnRemoved()).not.toThrow();
});

test("tolerates a host without storage.session", async () => {
  const { listener } = await setup();
  const session = (browser as any).storage.session;
  (browser as any).storage.session = undefined;
  try {
    listener!({ url: "https://cdn.example/a.m3u8", tabId: 1, type: "xmlhttprequest" });
    await vi.waitFor(() => expect(browser.tabs.sendMessage).toHaveBeenCalled());
  } finally {
    (browser as any).storage.session = session;
  }
});

test("drops malformed stored entries during rehydrate", async () => {
  const { mod } = await setup();
  vi.mocked(browser.storage.session.get).mockResolvedValue({
    [SCRIPT_MEDIA_BY_TAB_SESSION_KEY]: {
      notanumber: [{ url: "https://x.example/a.m3u8", kind: "stream" }],
      "1": "not-an-array",
      "2": [{ kind: "stream" }, { url: 5 }, null],
      "3": [{ url: "https://ok.example/a.m3u8", kind: "stream" }],
    },
  } as any);

  mod.pushBufferedScriptMedia(3);
  await vi.waitFor(() => expect(browser.tabs.sendMessage).toHaveBeenCalled());
  expect(lastSend()![1].body.sources).toMatchObject([
    { url: "https://ok.example/a.m3u8", kind: "stream" },
  ]);
});

test("validates and caps a session-stored buffer before replay", async () => {
  const { mod } = await setup();
  withStoredTab(8, [
    { url: "javascript:alert(1)", kind: "video" },
    { url: "https://cdn.example/not-media", kind: "link" },
    { url: "https://cdn.example/bad.m3u8", kind: "bogus" },
    ...Array.from({ length: 257 }, (_, index) => ({
      url: `https://cdn.example/v${index}.mp4`,
      kind: "video",
    })),
    { url: "https://cdn.example/v256.mp4", kind: "video" },
  ]);

  mod.pushBufferedScriptMedia(8);
  await vi.waitFor(() => expect(browser.tabs.sendMessage).toHaveBeenCalled());
  const sources = lastSend()![1].body.sources as Array<{ url: string; kind: string }>;
  expect(sources).toHaveLength(256);
  expect(sources.every(({ url, kind }) => url.startsWith("https://") && kind === "video")).toBe(
    true,
  );
  expect(sources.some(({ url }) => url.endsWith("/v0.mp4"))).toBe(false);
  expect(sources.some(({ url }) => url.endsWith("/v256.mp4"))).toBe(true);
});

test("survives a failed rehydrate read", async () => {
  const { listener } = await setup();
  vi.mocked(browser.storage.session.get).mockRejectedValue(new Error("read failed"));
  listener!({ url: "https://cdn.example/a.m3u8", tabId: 1, type: "xmlhttprequest" });
  await vi.waitFor(() => expect(browser.tabs.sendMessage).toHaveBeenCalled());
});

test("survives a failed persist write", async () => {
  const { listener } = await setup();
  vi.mocked(browser.storage.session.set).mockRejectedValue(new Error("write failed"));
  listener!({ url: "https://cdn.example/a.m3u8", tabId: 1, type: "xmlhttprequest" });
  await vi.waitFor(() => expect(browser.tabs.sendMessage).toHaveBeenCalled());
});

test("survives a synchronous sendMessage failure", async () => {
  const { listener } = await setup();
  vi.mocked(browser.tabs.sendMessage).mockImplementation(() => {
    throw new Error("no receiver");
  });
  listener!({ url: "https://cdn.example/a.m3u8", tabId: 1, type: "xmlhttprequest" });
  await new Promise((r) => setTimeout(r, 350));
  expect(browser.tabs.sendMessage).toHaveBeenCalled();
});

test("swallows an async sendMessage rejection", async () => {
  const { listener } = await setup();
  vi.mocked(browser.tabs.sendMessage).mockRejectedValue(new Error("no tab"));
  listener!({ url: "https://cdn.example/a.m3u8", tabId: 1, type: "xmlhttprequest" });
  await vi.waitFor(() => expect(browser.tabs.sendMessage).toHaveBeenCalled());
  await Promise.resolve(); // let the .catch() settle
});

test("flushes only tabs with new media, skipping already-flushed tabs", async () => {
  const { listener } = await setup();
  listener!({ url: "https://cdn.example/a.m3u8", tabId: 1, type: "xmlhttprequest" });
  await vi.waitFor(() => expect(browser.tabs.sendMessage).toHaveBeenCalled());
  vi.mocked(browser.tabs.sendMessage).mockClear();

  // Tab 1 stays in buffers but has no new urls; tab 2 records. The next flush
  // iterates both and skips tab 1 (no pending urls this tick).
  listener!({ url: "https://cdn.example/b.m3u8", tabId: 2, type: "xmlhttprequest" });
  await vi.waitFor(() => expect(browser.tabs.sendMessage).toHaveBeenCalled());
  const tabs = vi.mocked(browser.tabs.sendMessage).mock.calls.map((c) => c[0]);
  expect(tabs).toContain(2);
  expect(tabs).not.toContain(1);
});

test("pushBufferedScriptMedia does nothing while the feature is off", async () => {
  const { mod } = await setup({ sourcePanelScriptMedia: false });
  mod.pushBufferedScriptMedia(1);
  await new Promise((r) => setTimeout(r, 50));
  expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
});

test("a navigation on a tab with no buffered media is a harmless no-op", async () => {
  const { listener } = await setup();
  listener!({ url: "https://example.com/", tabId: 99, type: "main_frame" });
  await new Promise((r) => setTimeout(r, 50));
  expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
  expect(browser.storage.session.set).not.toHaveBeenCalled();
});

// Freezes the hydrate storage read so a teardown can be interleaved before the
// deferred drop callback runs, exercising its generation guard's skip path.
const frozenHydrate = () => {
  let resolveGet: (value: Record<string, unknown>) => void = () => {};
  vi.mocked(browser.storage.session.get).mockReturnValue(
    new Promise<Record<string, unknown>>((resolve) => {
      resolveGet = resolve;
    }),
  );
  return () => resolveGet({});
};

test("drops a main_frame reset queued before a mid-hydrate teardown", async () => {
  const { listener } = await setup();
  const release = frozenHydrate();
  listener!({ url: "https://new.example/", tabId: 3, type: "main_frame" });

  (browser as any).permissions.contains = vi.fn(() => Promise.resolve(false));
  fireOnRemoved();
  await drain();

  release();
  await new Promise((r) => setTimeout(r, 20));
  expect(browser.storage.session.set).not.toHaveBeenCalled();
});

test("drops a tab-close reset queued before a mid-hydrate teardown", async () => {
  await setup();
  const release = frozenHydrate();
  const onTabRemoved = (browser as any).tabs.onRemoved.addListener.mock.calls[0][0] as (
    id: number,
  ) => void;
  onTabRemoved(3);

  (browser as any).permissions.contains = vi.fn(() => Promise.resolve(false));
  fireOnRemoved();
  await drain();

  release();
  await new Promise((r) => setTimeout(r, 20));
  expect(browser.storage.session.set).not.toHaveBeenCalled();
});

// MV3 cold start: the worker is woken BY an observed request, and the options
// bag still holds seeded defaults (script media off) until init replaces it.
// Judging the toggle before init would drop exactly the events that woke us.
const pendingInit = async () => {
  const { backgroundRuntime } = await import("../../src/background/runtime.ts");
  let finish: () => void = () => {};
  backgroundRuntime.ready = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return async () => {
    const { options } = await import("../../src/config/options-data.ts");
    Object.assign(options, { sourcePanelEnabled: true, sourcePanelScriptMedia: true });
    finish();
  };
};

const coldSetup = () => setup({ sourcePanelEnabled: false, sourcePanelScriptMedia: false });

test("buffers a request that woke the worker before init replaced the defaults", async () => {
  const { listener } = await coldSetup();
  const completeInit = await pendingInit();

  listener!({ url: "https://cdn.example/live/master.m3u8", tabId: 7, type: "xmlhttprequest" });
  await completeInit();

  await vi.waitFor(() => expect(browser.tabs.sendMessage).toHaveBeenCalled());
  expect(lastSend()![1].body.sources).toMatchObject([
    { url: "https://cdn.example/live/master.m3u8", kind: "stream" },
  ]);
});

test("resets a rehydrated buffer for a navigation that woke the worker", async () => {
  const { listener, mod } = await coldSetup();
  withStoredTab(7, [{ url: "https://old.example/a.m3u8", kind: "stream" }]);
  const completeInit = await pendingInit();

  listener!({ url: "https://new.example/", tabId: 7, type: "main_frame" });
  await completeInit();
  await vi.waitFor(() => expect(browser.storage.session.set).toHaveBeenCalled());

  mod.pushBufferedScriptMedia(7);
  await new Promise((r) => setTimeout(r, 50));
  expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
});

test("replays a panel open that arrived before init replaced the defaults", async () => {
  const { mod } = await coldSetup();
  withStoredTab(4, [{ url: "https://cdn.example/live.m3u8", kind: "stream" }]);
  const completeInit = await pendingInit();

  mod.pushBufferedScriptMedia(4);
  await completeInit();

  await vi.waitFor(() => expect(browser.tabs.sendMessage).toHaveBeenCalled());
  expect(lastSend()![1].body.sources).toMatchObject([
    { url: "https://cdn.example/live.m3u8", kind: "stream" },
  ]);
});

test("keeps observing after a failed init instead of wedging on its rejection", async () => {
  const { listener } = await coldSetup();
  const { backgroundRuntime } = await import("../../src/background/runtime.ts");
  let failInit: () => void = () => {};
  backgroundRuntime.ready = new Promise<void>((_resolve, reject) => {
    failInit = () => reject(new Error("init failed"));
  });
  // A rejected ready must not leave every queued request waiting forever; the
  // options the failed init did manage to apply still decide the outcome.
  backgroundRuntime.ready.catch(() => {});

  listener!({ url: "https://cdn.example/live/master.m3u8", tabId: 7, type: "xmlhttprequest" });
  const { options } = await import("../../src/config/options-data.ts");
  Object.assign(options, { sourcePanelEnabled: true, sourcePanelScriptMedia: true });
  failInit();

  await vi.waitFor(() => expect(browser.tabs.sendMessage).toHaveBeenCalled());
  expect(lastSend()![1].body.sources).toMatchObject([
    { url: "https://cdn.example/live/master.m3u8", kind: "stream" },
  ]);
});

// Chrome supplies no details.incognito, so the collector resolves the owning
// tab before it may buffer anything. Freezing that lookup lets a teardown land
// while the request is parked on it.
const frozenTabPrivacy = () => {
  let resolveTab: (tab: browser.tabs.Tab) => void = () => {};
  vi.mocked(browser.tabs.get).mockReturnValue(
    new Promise<browser.tabs.Tab>((resolve) => {
      resolveTab = resolve;
    }),
  );
  return () => resolveTab({ incognito: false } as browser.tabs.Tab);
};

test("drops a request whose tab-privacy lookup outlived a teardown", async () => {
  const { listener } = await setup();
  const release = frozenTabPrivacy();
  listener!({ url: "https://example.com/a.mp4", tabId: 7, type: "media" });
  await drain();

  (browser as any).permissions.contains = vi.fn(() => Promise.resolve(false));
  fireOnRemoved();
  await drain();

  release();
  await new Promise((r) => setTimeout(r, 350));
  expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
  expect(browser.storage.session.set).not.toHaveBeenCalled();
});

describe("automatic script-media candidates", () => {
  const AUTO_ON = { autoDownloadEnabled: true, autoDownloadScriptMedia: true };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 350));

  test("hands automatic saves whole files only, stamped with the request time", async () => {
    const { mod, listener } = await setup(AUTO_ON);
    const request = (url: string, type: string, timeStamp: number) =>
      listener!({ url, tabId: 7, type, timeStamp });
    request("https://cdn.example/clip.mp4", "media", 1000);
    request("https://cdn.example/report.pdf", "xmlhttprequest", 1001);
    request("https://cdn.example/photo.jpg", "xmlhttprequest", 1002);
    // An MSE player's fragmented-MP4 segment arrives by XHR.
    request("https://cdn.example/seg-1.mp4", "xmlhttprequest", 1003);
    request("https://cdn.example/live.m3u8", "xmlhttprequest", 1004);
    // Once the tab streams, its media-element requests are presumed segments.
    request("https://cdn.example/seg-2.mp4", "media", 1005);

    expect(await mod.automaticScriptMediaForTab(7, ANY_VISIT)).toEqual([
      { url: "https://cdn.example/clip.mp4", kind: "video", at: 1000 },
      { url: "https://cdn.example/report.pdf", kind: "document", at: 1001 },
      { url: "https://cdn.example/photo.jpg", kind: "image", at: 1002 },
      { url: "https://cdn.example/live.m3u8", kind: "stream", at: 1004 },
    ]);
    // The panel still receives every recognized URL; only the marker differs.
    await settle();
    const pushed = lastSend()![1].body.sources as Array<{ url: string; auto?: true }>;
    expect(pushed.map(({ url, auto }) => [url, auto === true])).toEqual([
      ["https://cdn.example/clip.mp4", true],
      ["https://cdn.example/report.pdf", true],
      ["https://cdn.example/photo.jpg", true],
      ["https://cdn.example/seg-1.mp4", false],
      ["https://cdn.example/live.m3u8", true],
      ["https://cdn.example/seg-2.mp4", false],
    ]);
  });

  // A natively played stream whose playlist has no extension leaves only an
  // extensionless media-element load; its segments are media-element loads
  // under ordinary extensions.
  test("treats an extensionless media-element load as a stream", async () => {
    const { mod, listener } = await setup(AUTO_ON);
    const media = (url: string) => listener!({ url, tabId: 7, type: "media", timeStamp: 1 });
    media("https://cdn.example/api/stream/123/master");
    media("https://cdn.example/hls/seg_00001.mp4");
    media("https://cdn.example/hls/seg_00002.m4a");

    expect(await mod.automaticScriptMediaForTab(7, ANY_VISIT)).toEqual([]);
    expect(
      await mod.isAutomaticScriptMediaCollected(
        7,
        "https://cdn.example/hls/seg_00001.mp4",
        "video",
        ANY_VISIT,
      ),
    ).toBe(false);
  });

  test("still adopts the one whole file a page without a stream plays", async () => {
    const { mod, listener } = await setup(AUTO_ON);
    listener!({ url: "https://cdn.example/movie.mp4", tabId: 7, type: "media", timeStamp: 1 });
    listener!({ url: "https://cdn.example/movie.mp4", tabId: 7, type: "media", timeStamp: 2 });
    // A whole file adopted before the stream appeared keeps its evidence.
    listener!({ url: "https://cdn.example/api/stream/9", tabId: 7, type: "media", timeStamp: 3 });

    expect(await mod.automaticScriptMediaForTab(7, ANY_VISIT)).toEqual([
      { url: "https://cdn.example/movie.mp4", kind: "video", at: 2 },
    ]);
  });

  test("keeps the stream evidence through a flood of segment requests", async () => {
    const { mod, listener } = await setup(AUTO_ON);
    listener!({ url: "https://cdn.example/api/stream/9", tabId: 7, type: "media" });
    for (let index = 0; index < 300; index += 1) {
      listener!({ url: `https://cdn.example/seg-${index}.mp4`, tabId: 7, type: "xmlhttprequest" });
    }
    listener!({ url: "https://cdn.example/seg-last.mp4", tabId: 7, type: "media" });

    expect(await mod.automaticScriptMediaForTab(7, ANY_VISIT)).toEqual([]);
  });

  test("persists and rehydrates the stream evidence", async () => {
    const { listener } = await setup(AUTO_ON);
    listener!({ url: "https://cdn.example/api/stream/9", tabId: 7, type: "media", timeStamp: 4 });
    await vi.waitFor(() =>
      expect(browser.storage.session.set).toHaveBeenCalledWith({
        [SCRIPT_MEDIA_BY_TAB_SESSION_KEY]: {
          "7": [{ url: "https://cdn.example/api/stream/9", kind: "video", at: 4, opaque: true }],
        },
        // Unattributed evidence names no document to remember.
        [SCRIPT_MEDIA_STREAM_DOCUMENTS_SESSION_KEY]: {},
      }),
    );
    // Pages never see it.
    expect(lastSend()![1].body.sources).toEqual([
      { url: "https://cdn.example/api/stream/9", kind: "video", at: 4 },
    ]);

    for (const [opaque, adopted] of [
      [true, 0],
      ["yes", 1],
    ] as const) {
      const { mod, listener: woken } = await setup(AUTO_ON);
      withStoredTab(7, [{ url: "https://cdn.example/api/stream/9", kind: "video", at: 4, opaque }]);
      woken!({ url: "https://cdn.example/clip.mp4", tabId: 7, type: "media" });
      expect(await mod.automaticScriptMediaForTab(7, ANY_VISIT)).toHaveLength(adopted);
    }
  });

  test("keeps whole-file evidence and refreshes the time on a repeat request", async () => {
    const { mod, listener } = await setup(AUTO_ON);
    listener!({ url: "https://cdn.example/a.mp4", tabId: 7, type: "xmlhttprequest", timeStamp: 1 });
    listener!({ url: "https://cdn.example/a.mp4", tabId: 7, type: "media", timeStamp: 2 });
    listener!({ url: "https://cdn.example/a.mp4", tabId: 7, type: "xmlhttprequest", timeStamp: 3 });

    expect(await mod.automaticScriptMediaForTab(7, ANY_VISIT)).toEqual([
      { url: "https://cdn.example/a.mp4", kind: "video", at: 3 },
    ]);
  });

  test("stamps a request without a browser time with the current time", async () => {
    const { mod, listener } = await setup(AUTO_ON);
    const before = Date.now();
    listener!({ url: "https://cdn.example/a.m3u8", tabId: 7, type: "xmlhttprequest" });
    const [entry] = await mod.automaticScriptMediaForTab(7, ANY_VISIT);
    expect(entry?.at).toBeGreaterThanOrEqual(before);
  });

  test.each([
    ["automatic saves are off", { autoDownloadScriptMedia: true }],
    ["the script-media opt-in is off", { autoDownloadEnabled: true }],
    ["the collector is off", { ...AUTO_ON, sourcePanelScriptMedia: false }],
    ["Page Sources is off", { ...AUTO_ON, sourcePanelEnabled: false }],
  ])("offers and confirms nothing while %s", async (_label, overrides) => {
    const { mod, listener } = await setup({ ...AUTO_ON });
    listener!({ url: "https://cdn.example/a.m3u8", tabId: 7, type: "xmlhttprequest" });
    expect(await mod.automaticScriptMediaForTab(7, ANY_VISIT)).toHaveLength(1);

    const { options } = await import("../../src/config/options-data.ts");
    Object.assign(options, {
      autoDownloadEnabled: false,
      autoDownloadScriptMedia: false,
      sourcePanelEnabled: true,
      sourcePanelScriptMedia: true,
      ...overrides,
    });
    expect(await mod.automaticScriptMediaForTab(7, ANY_VISIT)).toEqual([]);
    expect(
      await mod.isAutomaticScriptMediaCollected(
        7,
        "https://cdn.example/a.m3u8",
        "stream",
        ANY_VISIT,
      ),
    ).toBe(false);
  });

  test("offers nothing without the webRequest permission", async () => {
    const { mod } = await setup(AUTO_ON, true, false);
    withStoredTab(7, [{ url: "https://cdn.example/a.m3u8", kind: "stream", auto: true, at: 1 }]);
    expect(await mod.automaticScriptMediaForTab(7, ANY_VISIT)).toEqual([]);
  });

  test("confirms only a collected whole file of the claimed kind in the claimed tab", async () => {
    const { mod, listener } = await setup(AUTO_ON);
    listener!({ url: "https://cdn.example/clip.mp4", tabId: 7, type: "media" });
    listener!({ url: "https://cdn.example/seg-1.mp4", tabId: 7, type: "xmlhttprequest" });
    const collected = (tabId: number, url: string, kind: "video" | "image") =>
      mod.isAutomaticScriptMediaCollected(tabId, url, kind, ANY_VISIT);

    expect(await collected(7, "https://cdn.example/clip.mp4", "video")).toBe(true);
    expect(await collected(7, "https://cdn.example/clip.mp4", "image")).toBe(false);
    expect(await collected(8, "https://cdn.example/clip.mp4", "video")).toBe(false);
    expect(await collected(7, "https://cdn.example/seg-1.mp4", "video")).toBe(false);
    expect(await collected(7, "https://cdn.example/never.mp4", "video")).toBe(false);
  });

  test("forgets a tab's candidates on navigation", async () => {
    const { mod, listener } = await setup(AUTO_ON);
    listener!({ url: "https://cdn.example/a.m3u8", tabId: 7, type: "xmlhttprequest" });
    listener!({ url: "https://site.example/next", tabId: 7, type: "main_frame" });
    expect(await mod.automaticScriptMediaForTab(7, ANY_VISIT)).toEqual([]);
  });

  // The navigation window: the old document keeps polling after the next
  // page's navigation request reset the buffer, until the new page commits.
  // Measured on Chrome 155 and Firefox 158: the old page's request landed after
  // the new page's navigation request, attributed to the old document.
  test("refuses the previous document's requests made after the navigation began", async () => {
    const { mod, listener } = await setup(AUTO_ON);
    const top = { tabId: 7, frameId: 0, parentFrameId: -1 };
    listener!({ ...top, url: "https://b.example/", type: "main_frame", timeStamp: 1000 });
    listener!({
      ...top,
      url: "https://a.example/live.m3u8",
      type: "xmlhttprequest",
      timeStamp: 1200,
      documentId: "doc-a",
    });
    listener!({
      ...top,
      url: "https://b.example/own.m3u8",
      type: "xmlhttprequest",
      timeStamp: 1300,
      documentId: "doc-b",
    });
    // Page B asks with its browser-supplied document identity. Its measured
    // start is deliberately early, so only the identity can refuse A's poll.
    const pageB = { documentId: "doc-b", start: 900 };

    expect(await mod.automaticScriptMediaForTab(7, pageB)).toEqual([
      { url: "https://b.example/own.m3u8", kind: "stream", at: 1300 },
    ]);
    expect(
      await mod.isAutomaticScriptMediaCollected(7, "https://a.example/live.m3u8", "stream", pageB),
    ).toBe(false);
    expect(
      await mod.isAutomaticScriptMediaCollected(7, "https://b.example/own.m3u8", "stream", pageB),
    ).toBe(true);
  });

  test("bounds unattributed requests by the visit's start instead", async () => {
    const { mod, listener } = await setup(AUTO_ON);
    // Firefox 140 reports no document at all.
    listener!({ url: "https://b.example/", tabId: 7, type: "main_frame", timeStamp: 1000 });
    listener!({
      url: "https://a.example/live.m3u8",
      tabId: 7,
      type: "xmlhttprequest",
      timeStamp: 1200,
    });
    listener!({
      url: "https://b.example/own.m3u8",
      tabId: 7,
      type: "xmlhttprequest",
      timeStamp: 1300,
    });
    // Page B's response started at 1250, and it reports a document identity
    // the requests could not be compared with.
    const pageB = { documentId: "doc-b", start: 1250 };

    expect(await mod.automaticScriptMediaForTab(7, pageB)).toEqual([
      { url: "https://b.example/own.m3u8", kind: "stream", at: 1300 },
    ]);
    expect(
      await mod.isAutomaticScriptMediaCollected(7, "https://a.example/live.m3u8", "stream", {
        start: 1250,
      }),
    ).toBe(false);
  });

  // A back/forward-cache restore sends no navigation request, so the buffer
  // still holds the page the user went back from.
  test("refuses the page left behind by a back/forward restore", async () => {
    const { mod, listener } = await setup(AUTO_ON);
    listener!({
      url: "https://b.example/clip.mp4",
      tabId: 7,
      frameId: 0,
      type: "media",
      timeStamp: 2000,
      documentId: "doc-b",
    });
    listener!({
      url: "https://b.example/worker.m3u8",
      tabId: 7,
      frameId: 0,
      type: "xmlhttprequest",
      timeStamp: 2100,
    });

    // Restored page A, with and without a browser document identity.
    for (const restoredA of [{ documentId: "doc-a", start: 3000 }, { start: 3000 }]) {
      expect(await mod.automaticScriptMediaForTab(7, restoredA)).toEqual([]);
      expect(
        await mod.isAutomaticScriptMediaCollected(
          7,
          "https://b.example/clip.mp4",
          "video",
          restoredA,
        ),
      ).toBe(false);
    }
  });

  test("attributes a first-level frame's request to the top document", async () => {
    const { mod, listener } = await setup(AUTO_ON);
    const request = (url: string, frame: Partial<Details>) =>
      listener!({ url, tabId: 7, type: "xmlhttprequest", timeStamp: 10, ...frame });
    request("https://player.example/frame.m3u8", {
      frameId: 9,
      parentFrameId: 0,
      documentId: "doc-frame",
      parentDocumentId: "doc-top",
    });
    // A deeper frame's parent is another frame: unattributed, so time decides.
    request("https://player.example/nested.m3u8", {
      frameId: 10,
      parentFrameId: 9,
      documentId: "doc-nested",
      parentDocumentId: "doc-frame",
    });
    // Chrome's prerendered page is outermost without being frame 0.
    request("https://site.example/prerendered.m3u8", {
      frameId: 4,
      frameType: "outermost_frame",
      documentId: "doc-top",
    });
    request("https://site.example/elsewhere.m3u8", {
      frameId: 4,
      frameType: "outermost_frame",
      documentId: "doc-other",
    });

    expect(
      (await mod.automaticScriptMediaForTab(7, { documentId: "doc-top", start: 0 })).map(
        ({ url }) => url,
      ),
    ).toEqual([
      "https://player.example/frame.m3u8",
      "https://player.example/nested.m3u8",
      "https://site.example/prerendered.m3u8",
    ]);
    expect(
      await mod.automaticScriptMediaForTab(7, { documentId: "doc-top", start: 11 }),
    ).toHaveLength(2);
  });

  test("leaves another document's media out of the panel's replay", async () => {
    const { mod, listener } = await setup(AUTO_ON);
    listener!({
      url: "https://b.example/clip.mp4",
      tabId: 7,
      frameId: 0,
      type: "media",
      documentId: "doc-b",
    });
    listener!({
      url: "https://b.example/worker.m3u8",
      tabId: 7,
      frameId: 0,
      type: "xmlhttprequest",
    });
    await settle();
    vi.mocked(browser.tabs.sendMessage).mockClear();

    mod.pushBufferedScriptMedia(7, "doc-a");
    await vi.waitFor(() => expect(browser.tabs.sendMessage).toHaveBeenCalledOnce());
    expect(lastSend()![1].body.sources.map(({ url }: { url: string }) => url)).toEqual([
      "https://b.example/worker.m3u8",
    ]);

    vi.mocked(browser.tabs.sendMessage).mockClear();
    listener!({ url: "https://b.example/", tabId: 7, type: "main_frame" });
    listener!({
      url: "https://b.example/other.mp4",
      tabId: 7,
      frameId: 0,
      type: "media",
      documentId: "doc-b",
    });
    await settle();
    vi.mocked(browser.tabs.sendMessage).mockClear();
    mod.pushBufferedScriptMedia(7, "doc-a");
    await settle();
    expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
  });

  test("persists and rehydrates the document identity", async () => {
    const { listener } = await setup(AUTO_ON);
    listener!({
      url: "https://cdn.example/a.m3u8",
      tabId: 7,
      frameId: 0,
      type: "xmlhttprequest",
      timeStamp: 5,
      documentId: "doc-a",
    });
    await vi.waitFor(() =>
      expect(browser.storage.session.set).toHaveBeenCalledWith({
        [SCRIPT_MEDIA_BY_TAB_SESSION_KEY]: {
          "7": [
            { url: "https://cdn.example/a.m3u8", kind: "stream", auto: true, at: 5, doc: "doc-a" },
          ],
        },
        [SCRIPT_MEDIA_STREAM_DOCUMENTS_SESSION_KEY]: { "7": ["doc-a"] },
      }),
    );
    // Pages never see it.
    expect(lastSend()![1].body.sources).toEqual([
      { url: "https://cdn.example/a.m3u8", kind: "stream", auto: true, at: 5 },
    ]);

    const { mod } = await setup(AUTO_ON);
    withStoredTab(7, [
      { url: "https://cdn.example/a.m3u8", kind: "stream", auto: true, at: 5, doc: "doc-a" },
      // A malformed identity is no identity: the time bound decides.
      { url: "https://cdn.example/b.m3u8", kind: "stream", auto: true, at: 6, doc: 42 },
    ]);
    expect(
      (await mod.automaticScriptMediaForTab(7, { documentId: "doc-b", start: 0 })).map(
        ({ url }) => url,
      ),
    ).toEqual(["https://cdn.example/b.m3u8"]);
  });

  test("persists and rehydrates the whole-file marker and time", async () => {
    const { listener } = await setup(AUTO_ON);
    listener!({
      url: "https://cdn.example/a.m3u8",
      tabId: 7,
      type: "xmlhttprequest",
      timeStamp: 5,
    });
    listener!({ url: "https://cdn.example/s.mp4", tabId: 7, type: "xmlhttprequest", timeStamp: 6 });
    await vi.waitFor(() =>
      expect(browser.storage.session.set).toHaveBeenCalledWith({
        [SCRIPT_MEDIA_BY_TAB_SESSION_KEY]: {
          "7": [
            { url: "https://cdn.example/a.m3u8", kind: "stream", auto: true, at: 5 },
            { url: "https://cdn.example/s.mp4", kind: "video", at: 6 },
          ],
        },
        [SCRIPT_MEDIA_STREAM_DOCUMENTS_SESSION_KEY]: {},
      }),
    );

    const { mod } = await setup(AUTO_ON);
    withStoredTab(7, [
      { url: "https://cdn.example/a.m3u8", kind: "stream", auto: true, at: 5 },
      { url: "https://cdn.example/s.mp4", kind: "video", at: 6 },
      // Malformed markers are not whole-file evidence; a missing time is old.
      { url: "https://cdn.example/b.m3u8", kind: "stream", auto: "yes", at: 7 },
      { url: "https://cdn.example/c.m3u8", kind: "stream", auto: true, at: "late" },
    ]);
    expect(await mod.automaticScriptMediaForTab(7, ANY_VISIT)).toEqual([
      { url: "https://cdn.example/a.m3u8", kind: "stream", at: 5 },
      { url: "https://cdn.example/c.m3u8", kind: "stream", at: 0 },
    ]);
  });
});

// A back/forward-cache restore sends no request, so the restored document never
// re-records the stream evidence its tab's main_frame reset dropped. Its stream
// evidence is remembered per document instead, for the life of the tab.
describe("stream evidence across a back/forward restore", () => {
  const AUTO_ON = { autoDownloadEnabled: true, autoDownloadScriptMedia: true };
  const top = { tabId: 7, frameId: 0, parentFrameId: -1 };
  const SEGMENT = "https://a.example/hls/seg_00042.mp4";
  const settle = () => new Promise((resolve) => setTimeout(resolve, 350));

  const visitA = (listener: (details: Details) => void, stream: string) => {
    listener({ ...top, url: "https://a.example/watch", type: "main_frame", timeStamp: 1 });
    listener({ ...top, url: stream, type: "media", timeStamp: 2, documentId: "A" });
    listener({
      ...top,
      url: "https://a.example/hls/seg_00001.mp4",
      type: "media",
      timeStamp: 3,
      documentId: "A",
    });
  };
  const leaveForB = (listener: (details: Details) => void) =>
    listener({ ...top, url: "https://b.example/", type: "main_frame", timeStamp: 10 });
  const restoredA = { start: 15, documentId: "A" };
  const segmentOf = (listener: (details: Details) => void, doc: string, tabId = 7) =>
    listener({ ...top, tabId, url: SEGMENT, type: "media", timeStamp: 20, documentId: doc });

  type Collector = Awaited<ReturnType<typeof setup>>["mod"];
  // Both the replay and the backstop must agree, so each case checks both.
  const adopted = async (
    mod: Collector,
    url: string,
    visit: { start: number; documentId?: string },
    tabId = 7,
  ) => {
    const offered = (await mod.automaticScriptMediaForTab(tabId, visit)).some(
      (entry) => entry.url === url,
    );
    const confirmed = await mod.isAutomaticScriptMediaCollected(tabId, url, "video", visit);
    expect(offered).toBe(confirmed);
    return confirmed;
  };
  const tabRemoved = () =>
    vi.mocked(browser.tabs.onRemoved.addListener).mock.calls[0]![0] as unknown as (
      tabId: number,
    ) => void;

  test.each([
    ["a recognized manifest", "https://a.example/hls/master.m3u8"],
    ["an extensionless media-element load", "https://a.example/api/stream/123/master"],
  ])("refuses a restored stream page's segments after %s", async (_label, stream) => {
    const { mod, listener } = await setup(AUTO_ON);
    visitA(listener!, stream);
    expect(
      await adopted(mod, "https://a.example/hls/seg_00001.mp4", { start: 0, documentId: "A" }),
    ).toBe(false);

    leaveForB(listener!);
    segmentOf(listener!, "A");

    expect(await adopted(mod, SEGMENT, restoredA)).toBe(false);
  });

  test("refuses a restored stream's segments when it plays in a frame inside a frame", async () => {
    const { mod, listener } = await setup(AUTO_ON);
    // A deep frame names no top-level document, only its own.
    const deep = { tabId: 7, frameId: 9, parentFrameId: 4, documentId: "F" };
    listener!({ ...top, url: "https://a.example/watch", type: "main_frame", timeStamp: 1 });
    listener!({
      ...deep,
      url: "https://a.example/api/stream/1/master",
      type: "media",
      timeStamp: 2,
    });
    listener!({ ...deep, url: "https://a.example/hls/seg_00001.mp4", type: "media", timeStamp: 3 });
    expect(await adopted(mod, "https://a.example/hls/seg_00001.mp4", { start: 0 })).toBe(false);

    leaveForB(listener!);
    listener!({ ...deep, url: SEGMENT, type: "media", timeStamp: 20 });

    expect(await adopted(mod, SEGMENT, restoredA)).toBe(false);
  });

  test("still adopts a whole file on a restored page that showed no stream", async () => {
    const { mod, listener } = await setup(AUTO_ON);
    listener!({ ...top, url: "https://c.example/", type: "main_frame", timeStamp: 1 });
    leaveForB(listener!);
    // A page visited in between did play a stream, which is remembered as its
    // own and not the restored page's. (Evidence still in the current buffer
    // counts for the whole tab, so the restore here skips back past it.)
    listener!({
      ...top,
      url: "https://b.example/live.m3u8",
      type: "media",
      timeStamp: 11,
      documentId: "B",
    });
    listener!({ ...top, url: "https://d.example/", type: "main_frame", timeStamp: 12 });
    const movie = "https://c.example/movie.mp4";
    listener!({ ...top, url: movie, type: "media", timeStamp: 20, documentId: "C" });

    expect(await adopted(mod, movie, { start: 15, documentId: "C" })).toBe(true);
  });

  // Firefox 140, a worker, or a deeper frame names no document, so its load
  // cannot be told apart from a remembered stream page's segment.
  test("treats an unattributed load as a stream once any page in the tab showed one", async () => {
    const { mod, listener } = await setup(AUTO_ON);
    const before = "https://c.example/before.mp4";
    listener!({ tabId: 7, url: before, type: "media", timeStamp: 1 });
    expect(await adopted(mod, before, { start: 0 })).toBe(true);

    visitA(listener!, "https://a.example/hls/master.m3u8");
    leaveForB(listener!);
    listener!({ tabId: 7, url: SEGMENT, type: "media", timeStamp: 20 });
    expect(await adopted(mod, SEGMENT, { start: 15 })).toBe(false);
  });

  test("remembers a bounded number of stream pages per tab", async () => {
    const { mod, listener } = await setup(AUTO_ON);
    const limit = mod.SCRIPT_MEDIA_STREAM_DOCUMENT_LIMIT;
    // One page more than the limit evicts the oldest, except that seeing the
    // first page's evidence again made it the newest, so the second goes.
    for (let index = 0; index <= limit; index += 1) {
      listener!({ ...top, url: `https://p${index}.example/`, type: "main_frame" });
      listener!({
        ...top,
        url: `https://p${index}.example/live.m3u8`,
        type: "xmlhttprequest",
        timeStamp: 2,
        documentId: `p${index}`,
      });
      if (index === limit - 1) {
        listener!({
          ...top,
          url: "https://p0.example/again.m3u8",
          type: "xmlhttprequest",
          timeStamp: 2,
          documentId: "p0",
        });
      }
    }
    leaveForB(listener!);
    const segment = (doc: string) => {
      const url = `https://${doc}.example/seg_00042.mp4`;
      listener!({ ...top, url, type: "media", timeStamp: 20, documentId: doc });
      return url;
    };
    const refreshed = segment("p0");
    const evicted = segment("p1");
    const third = segment("p2");
    const newest = segment(`p${limit}`);

    expect(await adopted(mod, evicted, { start: 15, documentId: "p1" })).toBe(true);
    expect(await adopted(mod, refreshed, { start: 15, documentId: "p0" })).toBe(false);
    expect(await adopted(mod, third, { start: 15, documentId: "p2" })).toBe(false);
    expect(await adopted(mod, newest, { start: 15, documentId: `p${limit}` })).toBe(false);
  });

  test("persists remembered stream pages for public tabs only", async () => {
    const { listener } = await setup(AUTO_ON);
    visitA(listener!, "https://a.example/hls/master.m3u8");
    listener!({
      tabId: 8,
      frameId: 0,
      url: "https://private.example/live.m3u8",
      type: "media",
      incognito: true,
      documentId: "P",
    });
    leaveForB(listener!);
    await vi.waitFor(() =>
      expect(browser.storage.session.set).toHaveBeenLastCalledWith(
        expect.objectContaining({ [SCRIPT_MEDIA_STREAM_DOCUMENTS_SESSION_KEY]: { "7": ["A"] } }),
      ),
    );
  });

  test("rehydrates remembered stream pages, dropping malformed values", async () => {
    const { mod, listener } = await setup(AUTO_ON);
    const limit = mod.SCRIPT_MEDIA_STREAM_DOCUMENT_LIMIT;
    vi.mocked(browser.storage.session.get).mockResolvedValue({
      [SCRIPT_MEDIA_STREAM_DOCUMENTS_SESSION_KEY]: {
        notanumber: ["N"],
        "6": "A",
        // Capped to the newest values, so "A" is dropped with the excess.
        "7": [42, null, "A", ...Array.from({ length: limit }, (_, index) => `kept-${index}`)],
        "8": [42, "D"],
        "9": [42],
      },
    } as any);
    segmentOf(listener!, "A");
    const kept = "https://a.example/kept.mp4";
    listener!({ ...top, url: kept, type: "media", timeStamp: 20, documentId: "kept-0" });
    segmentOf(listener!, "D", 8);
    segmentOf(listener!, "A", 6);
    listener!({ ...top, tabId: 9, url: SEGMENT, type: "media", timeStamp: 20, documentId: "N" });

    expect(await adopted(mod, SEGMENT, restoredA)).toBe(true);
    expect(await adopted(mod, kept, { start: 15, documentId: "kept-0" })).toBe(false);
    expect(await adopted(mod, SEGMENT, { start: 15, documentId: "D" }, 8)).toBe(false);
    expect(await adopted(mod, SEGMENT, restoredA, 6)).toBe(true);
    expect(await adopted(mod, SEGMENT, { start: 15, documentId: "N" }, 9)).toBe(true);
  });

  test.each([[undefined], ["not-an-object"], [null]])(
    "ignores a stored value of %s",
    async (stored) => {
      const { mod, listener } = await setup(AUTO_ON);
      vi.mocked(browser.storage.session.get).mockResolvedValue({
        [SCRIPT_MEDIA_STREAM_DOCUMENTS_SESSION_KEY]: stored,
      } as any);
      segmentOf(listener!, "A");
      expect(await adopted(mod, SEGMENT, restoredA)).toBe(true);
    },
  );

  test("forgets a closed tab's stream pages", async () => {
    const { mod, listener } = await setup(AUTO_ON);
    visitA(listener!, "https://a.example/hls/master.m3u8");
    await settle();
    vi.mocked(browser.storage.session.set).mockClear();
    tabRemoved()(7);
    await vi.waitFor(() =>
      expect(browser.storage.session.set).toHaveBeenCalledWith({
        [SCRIPT_MEDIA_BY_TAB_SESSION_KEY]: {},
        [SCRIPT_MEDIA_STREAM_DOCUMENTS_SESSION_KEY]: {},
      }),
    );

    // A reused tab id starts with no remembered stream.
    segmentOf(listener!, "A");
    expect(await adopted(mod, SEGMENT, restoredA)).toBe(true);
  });

  test("forgets a closed tab's stream pages after a reset emptied its buffer", async () => {
    const { mod, listener } = await setup(AUTO_ON);
    visitA(listener!, "https://a.example/hls/master.m3u8");
    leaveForB(listener!);
    await settle();
    vi.mocked(browser.storage.session.set).mockClear();
    tabRemoved()(7);
    await vi.waitFor(() =>
      expect(browser.storage.session.set).toHaveBeenCalledWith({
        [SCRIPT_MEDIA_BY_TAB_SESSION_KEY]: {},
        [SCRIPT_MEDIA_STREAM_DOCUMENTS_SESSION_KEY]: {},
      }),
    );
    segmentOf(listener!, "A");
    expect(await adopted(mod, SEGMENT, restoredA)).toBe(true);
  });

  test("does not rewrite storage when closing a tab it knows nothing about", async () => {
    await setup(AUTO_ON);
    // An earlier test's debounced flush may still be due.
    await settle();
    vi.mocked(browser.storage.session.set).mockClear();
    tabRemoved()(12);
    await settle();
    expect(browser.storage.session.set).not.toHaveBeenCalled();
  });

  test("starts over when a tab id is reclassified private", async () => {
    const { mod, listener } = await setup(AUTO_ON);
    visitA(listener!, "https://a.example/hls/master.m3u8");
    leaveForB(listener!);
    listener!({
      ...top,
      url: SEGMENT,
      type: "media",
      timeStamp: 20,
      documentId: "A",
      incognito: true,
    });
    expect(await adopted(mod, SEGMENT, restoredA)).toBe(true);
  });

  test("clears remembered stream pages when the permission is revoked", async () => {
    await setup(AUTO_ON);
    (
      (browser as any).permissions.onRemoved.addListener.mock.calls[0][0] as (permissions: {
        permissions: string[];
      }) => void
    )({ permissions: ["webRequest"] });
    expect(browser.storage.session.remove).toHaveBeenCalledWith([
      SCRIPT_MEDIA_BY_TAB_SESSION_KEY,
      SCRIPT_MEDIA_STREAM_DOCUMENTS_SESSION_KEY,
    ]);
  });
});

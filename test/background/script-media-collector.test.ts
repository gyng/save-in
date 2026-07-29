// Opt-in webRequest collector: observes media-carrying requests, buffers only
// recognized media per tab, and pushes it (debounced) to the tab's panel. State
// is module-local, so each test re-imports it fresh.
import { SCRIPT_MEDIA_BY_TAB_SESSION_KEY } from "../../src/shared/storage-keys.ts";

type Details = { url: string; tabId: number; type: string; incognito?: boolean };

// A cold worker whose only record of a tab lives in storage.session.
const withStoredTab = (tabId: number, entries: Array<{ url: string; kind: string }>) =>
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
  expect(browser.storage.session.remove).toHaveBeenCalledWith(SCRIPT_MEDIA_BY_TAB_SESSION_KEY);
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
  expect(message.body.sources).toEqual([
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

  expect(lastSend()![1].body.sources).toEqual([
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
  expect(lastSend()![1].body.sources).toEqual([
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
  expect(lastSend()![1].body.sources).toEqual([
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
  expect(lastSend()![1].body.sources).toEqual([
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
  expect(lastSend()![1].body.sources).toEqual([
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

import { options } from "../config/options-data.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";
import { backgroundRuntime } from "./runtime.ts";
import { MESSAGE_TYPES } from "../shared/constants.ts";
import {
  classifyUrlKind,
  isMediaSourceKind,
  isPageSourceKind,
  SCRIPT_MEDIA_SOURCE_LIMIT,
  type PageSourceKind,
} from "../shared/page-source.ts";
import { SCRIPT_MEDIA_BY_TAB_SESSION_KEY } from "../shared/storage-keys.ts";

// Opt-in webRequest collector for media a page loads with scripts (HLS/DASH
// manifests, fetch/XHR media) that the DOM scan and Resource Timing miss —
// notably requests made in workers or cross-origin frames. It observes only the
// request types that can carry media (xmlhttprequest/media/object/other), so
// script/stylesheet/font/image/ping traffic — never saveable media, or already
// covered by the DOM scan — costs nothing. Everything here is gated: it does
// nothing unless the sourcePanelScriptMedia option is on AND the optional
// webRequest permission is held. A dormant listener is registered synchronously
// during startup so it can wake an MV3 background, but no event or stored replay
// passes the permission proof and an absent permission removes that listener.
// Firefox does not activate a listener that was registered before webRequest
// was granted, so the completed config-apply boundary also rebinds it from the
// authoritative permission state. The permission is bound to that child toggle,
// not the parent sourcePanelEnabled,
// so with the panel disabled but the toggle still on the listener stays
// attached and simply no-ops each request (isConfigured below) rather than
// re-prompting for the permission on every parent re-enable.
//
// Perf/memory: the per-event handler is O(1) (classify + Map insert). Only
// recognized media is buffered, capped per tab with stream manifests pinned so
// segment-request floods cannot evict them. Pushes to the panel are debounced,
// not per request. The buffer mirrors to storage.session on the same debounced
// tick (never per request) so an evicted MV3 worker can rehydrate what it saw.

const MEDIA_TYPES = ["xmlhttprequest", "media", "object", "other"];
// The filter must also deliver main_frame so a top-level navigation can reset
// the tab's buffer (record() drops it and returns — main_frame is never
// buffered as media). Without it that reset branch never fires and a tab's
// media would bleed across page navigations.
const OBSERVED_TYPES = [...MEDIA_TYPES, "main_frame"];
const FLUSH_DELAY_MS = 300;

type MediaEntry = { url: string; kind: PageSourceKind };
type WebRequestDetails = { url: string; tabId: number; type: string; incognito?: boolean };
type PermissionChange = { permissions?: string[] };

// tabId → (url → kind), insertion order = age for LRU eviction.
const buffers = new Map<number, Map<string, PageSourceKind>>();
// Privacy belongs to the buffer, not just the latest request. Rehydrated
// buffers are public; live buffers are classified before their first write.
const bufferPrivate = new Map<number, boolean>();
// Chrome webRequest details omit incognito, so resolve the owning tab once and
// share that promise across a burst. Firefox supplies details.incognito.
const tabPrivacyChecks = new Map<number, Promise<boolean>>();
// Preserve browser event order across the asynchronous init, permission,
// tab-private, and session-hydration checks. A panel replay joins the same
// queue in both directions: it must not overtake the main_frame reset that
// preceded it, nor send a pre-navigation buffer that a reset behind it in the
// queue is about to drop.
const tabOperations = new Map<number, Promise<void>>();
// tabId → media urls observed since the last flush (for the live push).
const pending = new Map<number, Set<string>>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let hydratePromise: Promise<void> | null = null;
// Bumped by stopListening so an in-flight rehydrate that read the session
// snapshot before the teardown does not repopulate the just-cleared buffers.
let generation = 0;
// `null` means the startup/retry permissions.contains check has not proved the
// state yet. Web requests and buffer replay wait for a positive result; a
// failed check never grants access merely because the stored option says on.
let webRequestPermissionHeld: boolean | null = null;
let permissionCheck: Promise<boolean | null> | null = null;
let permissionCheckGeneration = 0;

const permissionsApi = ():
  | {
      contains?: (p: { permissions: string[] }) => Promise<boolean>;
      onAdded?: { addListener: (fn: (permissions?: PermissionChange) => void) => void };
      onRemoved?: { addListener: (fn: (permissions?: PermissionChange) => void) => void };
    }
  | undefined =>
  (
    webExtensionApi as {
      permissions?: { contains?: (p: { permissions: string[] }) => Promise<boolean> };
    }
  ).permissions;

const webRequestApi = ():
  | {
      onBeforeRequest?: {
        addListener: (
          listener: (details: WebRequestDetails) => void,
          filter: { urls: string[]; types?: string[] },
        ) => void;
        removeListener: (listener: (details: WebRequestDetails) => void) => void;
        hasListener?: (listener: (details: WebRequestDetails) => void) => boolean;
      };
    }
  | undefined => (webExtensionApi as { webRequest?: unknown }).webRequest as never;

const isConfigured = (): boolean =>
  options.sourcePanelEnabled === true && options.sourcePanelScriptMedia === true;

// MV3: an observed request (or a panel-open message) is often the very event
// that woke the worker, and until init resolves the options bag still holds the
// seeded defaults — where script media reads as off. Judging the toggle before
// then would discard exactly the events that woke us, including the main_frame
// reset that keeps a rehydrated buffer from bleeding into the next page. A
// failed init leaves the seeded defaults in place, so this still fails closed.
const initialized = (): Promise<void> =>
  backgroundRuntime.ready?.then(
    () => {},
    () => {},
  ) ?? Promise.resolve();

const isHttp = (url: string): boolean => url.startsWith("http://") || url.startsWith("https://");

const sessionStorage = () => webExtensionApi.storage.session;

const queueTabOperation = (tabId: number, operation: () => Promise<void>): void => {
  const previous = tabOperations.get(tabId);
  const current = previous?.then(operation, operation) ?? operation();
  tabOperations.set(tabId, current);
  const cleanup = () => {
    if (tabOperations.get(tabId) === current) tabOperations.delete(tabId);
  };
  void current.then(cleanup, cleanup);
};

const resolvePrivateContext = (details: WebRequestDetails): Promise<boolean> => {
  if (typeof details.incognito === "boolean") return Promise.resolve(details.incognito);
  const existing = tabPrivacyChecks.get(details.tabId);
  if (existing) return existing;
  let check: Promise<boolean>;
  try {
    check = webExtensionApi.tabs.get(details.tabId).then(
      (tab) => tab.incognito === true,
      () => true,
    );
  } catch {
    check = Promise.resolve(true);
  }
  tabPrivacyChecks.set(details.tabId, check);
  return check;
};

const setWebRequestPermission = (held: boolean): void => {
  permissionCheckGeneration += 1;
  permissionCheck = null;
  webRequestPermissionHeld = held;
};

const checkWebRequestPermission = (refresh = false): Promise<boolean | null> => {
  if (refresh) {
    permissionCheckGeneration += 1;
    permissionCheck = null;
    webRequestPermissionHeld = null;
  }
  if (webRequestPermissionHeld !== null) return Promise.resolve(webRequestPermissionHeld);
  if (permissionCheck) return permissionCheck;
  const contains = permissionsApi()?.contains;
  if (!contains) {
    webRequestPermissionHeld = false;
    return Promise.resolve(false);
  }
  const checkGeneration = permissionCheckGeneration;
  permissionCheck = contains({ permissions: ["webRequest"] }).then(
    (held) => {
      // An explicit permission event supersedes this older snapshot. Returning
      // its stale value would let the startup caller tear down a listener that
      // onAdded just proved and retained.
      if (checkGeneration !== permissionCheckGeneration) return null;
      webRequestPermissionHeld = held;
      permissionCheck = null;
      return held;
    },
    () => {
      if (checkGeneration === permissionCheckGeneration) permissionCheck = null;
      return null;
    },
  );
  return permissionCheck;
};

// One-time rehydrate of the per-tab buffer after a worker restart. Every caller
// awaits the SAME promise, so a live request that wakes the worker cannot run
// record() (and claim a tabId) before the stored buffer is merged back in —
// otherwise the restored history for exactly the busy tab would be dropped.
// Malformed stored shapes are dropped rather than trusted.
const hydrate = (): Promise<void> => (hydratePromise ??= doHydrate());

const doHydrate = async (): Promise<void> => {
  const storage = sessionStorage();
  if (!storage) return;
  const readGeneration = generation;
  try {
    const stored = (await storage.get(SCRIPT_MEDIA_BY_TAB_SESSION_KEY))[
      SCRIPT_MEDIA_BY_TAB_SESSION_KEY
    ];
    // A teardown (permission revoke) between the read and here cleared the
    // buffers on purpose; do not resurrect the stale snapshot we just read.
    if (readGeneration !== generation) return;
    if (!stored || typeof stored !== "object") return;
    for (const [tabKey, entries] of Object.entries(stored as Record<string, unknown>)) {
      const tabId = Number(tabKey);
      if (!Number.isInteger(tabId) || !Array.isArray(entries)) continue;
      const map = new Map<string, PageSourceKind>();
      for (const entry of entries as MediaEntry[]) {
        if (
          !entry ||
          typeof entry.url !== "string" ||
          !isHttp(entry.url) ||
          !isPageSourceKind(entry.kind) ||
          !isMediaSourceKind(entry.kind)
        )
          continue;
        if (map.has(entry.url)) map.delete(entry.url);
        map.set(entry.url, entry.kind);
        while (map.size > SCRIPT_MEDIA_SOURCE_LIMIT) evictOldest(map);
      }
      // Every caller awaits the shared hydrate promise before touching buffers,
      // so nothing has populated this tab yet — a plain set, no has() guard.
      if (map.size) {
        buffers.set(tabId, map);
        bufferPrivate.set(tabId, false);
      }
    }
  } catch {
    // No session storage (older hosts): the in-memory buffer alone still works.
  }
};

const persist = async (): Promise<void> => {
  const storage = sessionStorage();
  if (!storage) return;
  const record: Record<string, MediaEntry[]> = {};
  for (const [tabId, map] of buffers) {
    // Script-media discovery is not one of the admitted private activity
    // stores. Keep private and unclassified URLs in memory only.
    if (bufferPrivate.get(tabId) !== false) continue;
    record[String(tabId)] = [...map].map(([url, kind]) => ({ url, kind }));
  }
  try {
    await storage.set({ [SCRIPT_MEDIA_BY_TAB_SESSION_KEY]: record });
  } catch {
    // Persist is best-effort; the in-memory mirror remains authoritative.
  }
};

const send = (tabId: number, sources: MediaEntry[]): void => {
  try {
    void webExtensionApi.tabs
      .sendMessage(tabId, { type: MESSAGE_TYPES.SCRIPT_MEDIA_DETECTED, body: { sources } })
      .catch(() => {});
  } catch {
    // Tabs without the content script (restricted pages) cannot receive it.
  }
};

const flush = (): void => {
  flushTimer = null;
  // Iterate buffers (each map is definitely present) and cross-reference the
  // per-tab pending set — a tab may hold media yet have no new urls this tick.
  for (const [tabId, map] of buffers) {
    const urls = pending.get(tabId);
    if (!urls) continue;
    const sources: MediaEntry[] = [];
    for (const url of urls) {
      const kind = map.get(url);
      if (kind) sources.push({ url, kind });
    }
    send(tabId, sources);
  }
  pending.clear();
  void persist();
};

const scheduleFlush = (): void => {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
};

// Evict the oldest entry, preferring non-stream media so a manifest survives a
// flood of ordinary media requests. Streams go only when nothing else remains.
// Eviction runs only on overflow, so the loop always executes and assigns a
// victim; a URL is never "", so that sentinel just means "not yet chosen".
const evictOldest = (map: Map<string, PageSourceKind>): void => {
  let victim = "";
  for (const [url, kind] of map) {
    if (victim === "") victim = url; // oldest entry (first iteration)
    if (kind !== "stream") {
      victim = url; // the oldest non-stream is the better victim
      break;
    }
  }
  map.delete(victim);
};

const record = (tabId: number, url: string, requestType: string, privateContext: boolean): void => {
  let kind = classifyUrlKind(url);
  // A `media`-typed request with no telltale extension is still a media element
  // load; treat it as video rather than dropping it.
  if (!isMediaSourceKind(kind) && requestType === "media") kind = "video";
  if (!isMediaSourceKind(kind)) return; // not saveable media: never buffered

  let map = buffers.get(tabId);
  const previousPrivacy = bufferPrivate.get(tabId);
  if (map && previousPrivacy !== undefined && previousPrivacy !== privateContext) {
    map = undefined;
    buffers.delete(tabId);
    pending.delete(tabId);
  }
  if (!map) {
    map = new Map();
    buffers.set(tabId, map);
  }
  bufferPrivate.set(tabId, privateContext);
  if (map.has(url)) {
    // Refresh recency without changing the kind.
    map.delete(url);
  }
  map.set(url, kind);
  while (map.size > SCRIPT_MEDIA_SOURCE_LIMIT) evictOldest(map);

  let queued = pending.get(tabId);
  if (!queued) {
    queued = new Set();
    pending.set(tabId, queued);
  }
  queued.add(url);
  scheduleFlush();
};

const dropTab = (tabId: number): void => {
  tabPrivacyChecks.delete(tabId);
  bufferPrivate.delete(tabId);
  if (!buffers.delete(tabId)) return;
  pending.delete(tabId);
  void persist();
};

const onBeforeRequest = (details: WebRequestDetails): void => {
  if (typeof details.tabId !== "number" || details.tabId < 0) return;
  if (!isHttp(details.url)) return;
  // Capture the generation now: a teardown (permission revoke) can land while
  // hydrate awaits storage, and the deferred callback below survives it. Drop
  // the callback if that happened so a torn-down collector never repopulates
  // the cleared buffers or re-persists the removed session key.
  const eventGeneration = generation;
  queueTabOperation(details.tabId, async () => {
    await initialized();
    const held = await checkWebRequestPermission();
    if (held !== true || eventGeneration !== generation || !isConfigured()) return;
    const privateContext = await resolvePrivateContext(details);
    if (eventGeneration !== generation) return;
    // A top-level navigation starts a fresh page; forget the old tab's media.
    // Hydrate first so a cold-woken worker cannot leave the persisted buffer to
    // be resurrected by the next request. queueTabOperation preserves the
    // browser's main_frame-before-subresource order through every await.
    await hydrate();
    if (eventGeneration !== generation) return;
    if (details.type === "main_frame") {
      dropTab(details.tabId);
      return;
    }
    record(details.tabId, details.url, details.type, privateContext);
  });
};

let listening = false;

const startListening = (): void => {
  const api = webRequestApi()?.onBeforeRequest;
  if (!api || listening) return;
  api.addListener(onBeforeRequest, { urls: ["<all_urls>"], types: OBSERVED_TYPES });
  listening = true;
};

const stopListening = (): void => {
  const api = webRequestApi()?.onBeforeRequest;
  if (api && listening) api.removeListener(onBeforeRequest);
  listening = false;
  setWebRequestPermission(false);
  generation += 1;
  hydratePromise = null;
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  buffers.clear();
  bufferPrivate.clear();
  tabPrivacyChecks.clear();
  tabOperations.clear();
  pending.clear();
  void sessionStorage()?.remove?.(SCRIPT_MEDIA_BY_TAB_SESSION_KEY);
};

// Push a tab's whole buffered media set — used when its Page Sources panel
// opens, so media observed before the panel existed still appears.
export const pushBufferedScriptMedia = (tabId: number): void => {
  const pushGeneration = generation;
  queueTabOperation(tabId, async () => {
    await initialized();
    const held = await checkWebRequestPermission();
    if (held !== true || pushGeneration !== generation || !isConfigured()) return;
    await hydrate();
    if (pushGeneration !== generation) return;
    const map = buffers.get(tabId);
    if (!map || map.size === 0) return;
    send(
      tabId,
      [...map].map(([url, kind]) => ({ url, kind })),
    );
  });
};

// Firefox event pages do not reliably wake the background permissions.onAdded
// listener for a silently granted optional webRequest permission. The config
// apply boundary calls this before acknowledging the toggle, so the listener
// state is also rebound from the permission's authoritative current value.
export const refreshScriptMediaCollectorPermission = async (): Promise<void> => {
  const held = await checkWebRequestPermission(true);
  if (held === true) {
    // Firefox does not activate a listener registered before the optional
    // permission existed. Rebind even when our bookkeeping says it is present.
    const api = webRequestApi()?.onBeforeRequest;
    if (api && listening) api.removeListener(onBeforeRequest);
    listening = false;
    startListening();
  } else if (held === false) {
    stopListening();
  }
};

// Registered synchronously at startup (MV3 rule). A dormant webRequest listener
// is removed once startup proves the permission absent, (re)attached when the
// user grants it mid-session, and detached immediately on explicit revocation.
export const registerScriptMediaCollector = (): void => {
  // Register synchronously so a granted permission can wake an MV3 background,
  // then prove the optional permission before processing any event or replay.
  // A startup check that proves it absent removes the dormant listener.
  startListening();
  void checkWebRequestPermission().then((held) => {
    if (held === false) stopListening();
  });

  const permissions = permissionsApi();
  permissions?.onAdded?.addListener((added) => {
    if (added?.permissions && !added.permissions.includes("webRequest")) return;
    if (added?.permissions?.includes("webRequest")) {
      setWebRequestPermission(true);
      startListening();
      return;
    }
    void checkWebRequestPermission(true).then((held) => {
      if (held === true) startListening();
    });
  });
  permissions?.onRemoved?.addListener((removed) => {
    if (removed?.permissions && !removed.permissions.includes("webRequest")) return;
    if (removed?.permissions?.includes("webRequest")) {
      stopListening();
      return;
    }
    if (!permissionsApi()?.contains) {
      stopListening();
      return;
    }
    void checkWebRequestPermission(true).then((held) => {
      if (!held) stopListening();
    });
  });

  // Route through hydrate for the same reason main_frame does: a tab close can
  // wake a cold worker whose in-memory buffer is empty, so a bare dropTab would
  // early-return and leave the closed tab's persisted media to be resurrected
  // (and surfaced) under a reused tabId. Restore the buffer first, then drop.
  webExtensionApi.tabs?.onRemoved?.addListener((tabId: number) => {
    const eventGeneration = generation;
    queueTabOperation(tabId, async () => {
      await hydrate();
      if (eventGeneration === generation) dropTab(tabId);
    });
  });
};

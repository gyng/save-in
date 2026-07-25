import { options } from "../config/options-data.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";
import { MESSAGE_TYPES } from "../shared/constants.ts";
import { classifyUrlKind, isMediaSourceKind, type PageSourceKind } from "../shared/page-source.ts";
import { SCRIPT_MEDIA_BY_TAB_SESSION_KEY } from "../shared/storage-keys.ts";

// Opt-in webRequest collector for media a page loads with scripts (HLS/DASH
// manifests, fetch/XHR media) that the DOM scan and Resource Timing miss —
// notably requests made in workers or cross-origin frames. It observes only the
// request types that can carry media (xmlhttprequest/media/object/other), so
// script/stylesheet/font/image/ping traffic — never saveable media, or already
// covered by the DOM scan — costs nothing. Everything here is gated: it does
// nothing unless the sourcePanelScriptMedia option is on AND the optional
// webRequest permission is held (the listener only exists once granted).
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
const PER_TAB_LIMIT = 256;
const FLUSH_DELAY_MS = 300;

type MediaEntry = { url: string; kind: PageSourceKind };
type WebRequestDetails = { url: string; tabId: number; type: string };

// tabId → (url → kind), insertion order = age for LRU eviction.
const buffers = new Map<number, Map<string, PageSourceKind>>();
// tabId → media urls observed since the last flush (for the live push).
const pending = new Map<number, Set<string>>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let hydratePromise: Promise<void> | null = null;
// Bumped by stopListening so an in-flight rehydrate that read the session
// snapshot before the teardown does not repopulate the just-cleared buffers.
let generation = 0;

const permissionsApi = ():
  | { contains?: (p: { permissions: string[] }) => Promise<boolean> }
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

const isEnabled = (): boolean =>
  options.sourcePanelEnabled === true && options.sourcePanelScriptMedia === true;

const isHttp = (url: string): boolean => url.startsWith("http://") || url.startsWith("https://");

const sessionStorage = () => webExtensionApi.storage.session;

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
        if (entry && typeof entry.url === "string") map.set(entry.url, entry.kind);
      }
      if (map.size && !buffers.has(tabId)) buffers.set(tabId, map);
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
    record[String(tabId)] = [...map].map(([url, kind]) => ({ url, kind }));
  }
  try {
    await storage.set({ [SCRIPT_MEDIA_BY_TAB_SESSION_KEY]: record });
  } catch {
    // Persist is best-effort; the in-memory mirror remains authoritative.
  }
};

const send = (tabId: number, sources: MediaEntry[]): void => {
  if (!sources.length) return;
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
  for (const [tabId, urls] of pending) {
    const map = buffers.get(tabId);
    if (!map) continue;
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
const evictOldest = (map: Map<string, PageSourceKind>): void => {
  let fallback: string | undefined;
  for (const [url, kind] of map) {
    if (kind !== "stream") {
      map.delete(url);
      return;
    }
    if (fallback === undefined) fallback = url;
  }
  if (fallback !== undefined) map.delete(fallback);
};

const record = (tabId: number, url: string, requestType: string): void => {
  let kind = classifyUrlKind(url);
  // A `media`-typed request with no telltale extension is still a media element
  // load; treat it as video rather than dropping it.
  if (!isMediaSourceKind(kind) && requestType === "media") kind = "video";
  if (!isMediaSourceKind(kind)) return; // not saveable media: never buffered

  let map = buffers.get(tabId);
  if (!map) {
    map = new Map();
    buffers.set(tabId, map);
  }
  if (map.has(url)) {
    // Refresh recency without changing the kind.
    map.delete(url);
  }
  map.set(url, kind);
  while (map.size > PER_TAB_LIMIT) evictOldest(map);

  let queued = pending.get(tabId);
  if (!queued) {
    queued = new Set();
    pending.set(tabId, queued);
  }
  queued.add(url);
  scheduleFlush();
};

const dropTab = (tabId: number): void => {
  if (!buffers.delete(tabId)) return;
  pending.delete(tabId);
  void persist();
};

const onBeforeRequest = (details: WebRequestDetails): void => {
  if (!isEnabled()) return;
  if (typeof details.tabId !== "number" || details.tabId < 0) return;
  if (!isHttp(details.url)) return;
  // Capture the generation now: a teardown (permission revoke) can land while
  // hydrate awaits storage, and the deferred callback below survives it. Drop
  // the callback if that happened so a torn-down collector never repopulates
  // the cleared buffers or re-persists the removed session key.
  const eventGeneration = generation;
  // A top-level navigation starts a fresh page; forget the old tab's media.
  // Route through hydrate so a cold-woken worker restores the persisted buffer
  // FIRST — otherwise dropTab sees an empty in-memory map, early-returns, and
  // the next request's hydrate resurrects the old page's media. Both callbacks
  // await the same promise and main_frame fires before its subresources, so the
  // drop is queued ahead of any record() for the new page.
  if (details.type === "main_frame") {
    void hydrate().then(() => {
      if (eventGeneration === generation) dropTab(details.tabId);
    });
    return;
  }
  void hydrate().then(() => {
    if (eventGeneration === generation) record(details.tabId, details.url, details.type);
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
  if (!api || !listening) return;
  api.removeListener(onBeforeRequest);
  listening = false;
  generation += 1;
  hydratePromise = null;
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  buffers.clear();
  pending.clear();
  void sessionStorage()?.remove?.(SCRIPT_MEDIA_BY_TAB_SESSION_KEY);
};

// Push a tab's whole buffered media set — used when its Page Sources panel
// opens, so media observed before the panel existed still appears.
export const pushBufferedScriptMedia = (tabId: number): void => {
  if (!isEnabled()) return;
  void hydrate().then(() => {
    const map = buffers.get(tabId);
    if (!map || map.size === 0) return;
    send(
      tabId,
      [...map].map(([url, kind]) => ({ url, kind })),
    );
  });
};

// Registered synchronously at startup (MV3 rule). The webRequest listener is
// attached only when the permission is already held, and (re)attached when the
// user grants it mid-session; it is detached on revocation.
export const registerScriptMediaCollector = (): void => {
  startListening();

  const permissions = (
    webExtensionApi as {
      permissions?: {
        onAdded?: { addListener: (fn: () => void) => void };
        onRemoved?: { addListener: (fn: () => void) => void };
      };
    }
  ).permissions;
  permissions?.onAdded?.addListener(() => startListening());
  permissions?.onRemoved?.addListener(() => {
    const api = permissionsApi();
    if (!api?.contains) {
      stopListening();
      return;
    }
    void api.contains({ permissions: ["webRequest"] }).then((held) => {
      if (!held) stopListening();
    });
  });

  webExtensionApi.tabs?.onRemoved?.addListener((tabId: number) => dropTab(tabId));
};

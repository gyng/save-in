import { BROWSERS, CURRENT_BROWSER } from "../platform/chrome-detector.ts";
import type { ProtectedRequestMethod } from "../routing/ports.ts";
import { MAX_PROTECTED_URL_EXTENSIONS, type RefererProtection } from "../shared/protected-fetch.ts";

// One session rule ID per in-flight protected operation, drawn from a small
// fixed pool. A single shared rule cannot carry two Referer values at once,
// so concurrency comes from distinct rules — never from widening one rule.
// The pool is sized for a burst of lazy metadata/hash fetches from one save
// batch; operations beyond it wait, degrading to the old serialized behavior.
export const REFERER_SESSION_RULE_ID = 66_000_001;
export const REFERER_RULE_POOL_SIZE = 6;
export const REFERER_SESSION_RULE_IDS: readonly number[] = Array.from(
  { length: REFERER_RULE_POOL_SIZE },
  (_, index) => REFERER_SESSION_RULE_ID + index,
);

type RefererRule = {
  id: number;
  priority: number;
  action: {
    type: "modifyHeaders";
    requestHeaders: Array<{
      header: string;
      operation: "set";
      value: string;
    }>;
  };
  condition: {
    regexFilter: string;
    isUrlFilterCaseSensitive: true;
    initiatorDomains: string[];
    requestMethods: ProtectedRequestMethod[];
    resourceTypes: ["xmlhttprequest"];
  };
};

type DnrApi = {
  updateSessionRules(update: { removeRuleIds: number[]; addRules?: RefererRule[] }): Promise<void>;
};

type ExtensionHost = {
  declarativeNetRequest?: DnrApi;
  runtime?: {
    id?: string;
    getURL?: (path: string) => string;
  };
};

// The invariant that keeps concurrent rules safe: no two in-flight operations
// may cover overlapping exact-URL sets with different Referer values. Each
// entry tracks the canonical URLs its rule currently matches so starts and
// mid-flight extensions can be checked against every other operation.
type InFlightOperation = {
  referer: string;
  installedUrls: string[];
  urls: string[];
  extensionWrites: Promise<void>;
  released: boolean;
};

const inFlight = new Map<number, InFlightOperation>();
// Rule IDs whose removal was rejected while the background stayed alive. The
// pool hands out the lowest free ID, so "the exact rule is replaced next time"
// no longer holds: a stale rule can outlive its operation under a different ID
// and keep covering that URL with the old Referer. Every install clears them
// in the same atomic update that adds its own rule.
const staleRuleIds = new Set<number>();
let releaseWaiters: Array<() => void> = [];

const wakeReleaseWaiters = (): void => {
  const woken = releaseWaiters;
  releaseWaiters = [];
  for (const resume of woken) resume();
};

const waitForRelease = (): Promise<void> =>
  new Promise((resolve) => {
    releaseWaiters.push(resolve);
  });

const conflictingOperation = (url: string, referer: string): InFlightOperation | undefined => {
  for (const operation of inFlight.values()) {
    if (operation.referer !== referer && operation.urls.includes(url)) return operation;
  }
  return undefined;
};

// Waits until the URL is free of conflicting rules AND a pool slot is open.
// Woken waiters re-check both conditions, so a slot can never be granted while
// another operation still covers the same URL with a different Referer. Two
// operations with the SAME URL and SAME Referer may run concurrently: their
// rules set the identical header value, so whichever rule wins the DNR tie
// produces the same request.
const acquireRuleSlot = async (
  url: string,
  referer: string,
): Promise<{ id: number; operation: InFlightOperation }> => {
  while (true) {
    if (!conflictingOperation(url, referer)) {
      const id = REFERER_SESSION_RULE_IDS.find((candidate) => !inFlight.has(candidate));
      if (id !== undefined) {
        const operation: InFlightOperation = {
          referer,
          installedUrls: [url],
          urls: [url],
          extensionWrites: Promise.resolve(),
          released: false,
        };
        inFlight.set(id, operation);
        return { id, operation };
      }
    }
    await waitForRelease();
  }
};

const releaseRuleSlot = (id: number): void => {
  inFlight.delete(id);
  wakeReleaseWaiters();
};

const extensionHost = (): ExtensionHost | undefined => {
  if (CURRENT_BROWSER === BROWSERS.FIREFOX) {
    return globalThis.browser as unknown as ExtensionHost;
  }
  if (CURRENT_BROWSER === BROWSERS.CHROME) {
    return globalThis.chrome as unknown as ExtensionHost;
  }
  return undefined;
};

const dnrApi = (): DnrApi | undefined => extensionHost()?.declarativeNetRequest;

const extensionInitiatorDomain = (): string | undefined => {
  const runtime = extensionHost()?.runtime;
  if (!runtime) return undefined;
  if (CURRENT_BROWSER === BROWSERS.CHROME) return runtime.id || undefined;
  if (typeof runtime.getURL !== "function") return undefined;
  try {
    return new URL(runtime.getURL("")).hostname || undefined;
  } catch {
    return undefined;
  }
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const canonicalRequestUrl = (value: string): string => {
  const url = new URL(value);
  // Fragments are local browser state and are never part of the HTTP request.
  url.hash = "";
  return url.href;
};

// Redirect targets come from server responses, so unlike the initial URL they
// must never throw, and only HTTP(S) requests can carry the header.
const normalizeExtensionCandidate = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.hash = "";
    return url.href;
  } catch {
    return undefined;
  }
};

const urlSetRegex = (urls: readonly string[]): string => `^(?:${urls.map(escapeRegex).join("|")})$`;

// Chrome rejects regexFilter values whose compiled RE2 program exceeds ~2 KB.
// This conservative cap refuses most oversized alternations up front; the
// remaining updateSessionRules rejections degrade to the previous rule.
const MAX_REGEX_FILTER_LENGTH = 1500;

export const buildRule = (
  url: string | readonly string[],
  referer: string,
  requestMethods: ProtectedRequestMethod[] = ["get"],
  id: number = REFERER_SESSION_RULE_ID,
): RefererRule => {
  const initiatorDomain = extensionInitiatorDomain();
  if (!initiatorDomain) throw new Error("Extension request origin is unavailable");
  const urls = typeof url === "string" ? [canonicalRequestUrl(url)] : url;
  return {
    id,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [{ header: "Referer", operation: "set", value: referer }],
    },
    condition: {
      regexFilter: urlSetRegex(urls),
      // DNR matches case-insensitively by default, which would make this rule
      // cover more than its exact URLs — including a differently-cased URL an
      // operation with another Referer holds, defeating the overlap check that
      // compares canonical URLs as exact strings.
      isUrlFilterCaseSensitive: true,
      initiatorDomains: [initiatorDomain],
      requestMethods,
      resourceTypes: ["xmlhttprequest"],
    },
  };
};

// A background stop can strand any subset of the pool, so recovery always
// clears the whole ID range in one call rather than a single reserved ID.
const removeAllRules = async (api: DnrApi): Promise<void> => {
  await api.updateSessionRules({ removeRuleIds: [...REFERER_SESSION_RULE_IDS] });
  // The whole range is gone, so nothing is left for a later install to sweep.
  staleRuleIds.clear();
};

export const canUseRefererRules = (): boolean =>
  (CURRENT_BROWSER === BROWSERS.CHROME || CURRENT_BROWSER === BROWSERS.FIREFOX) &&
  typeof dnrApi()?.updateSessionRules === "function" &&
  extensionInitiatorDomain() !== undefined;

// A background stop can prevent the finally blocks below from running.
// Session rules outlive background instances, so startup removes the pool.
export const cleanupStaleRefererRule = (): Promise<void> => {
  const api = canUseRefererRules() ? dnrApi() : undefined;
  return api ? removeAllRules(api) : Promise.resolve();
};

export const resetRefererRules = async (): Promise<void> => {
  while (inFlight.size > 0) await waitForRelease();
  // Re-derive availability: the host can lose DNR while the drain awaited.
  const api = canUseRefererRules() ? dnrApi() : undefined;
  if (api) await removeAllRules(api);
};

export const withRequestReferer = async <T>(
  url: string,
  referer: string,
  operation: (protection?: RefererProtection) => Promise<T>,
  requestMethods: ProtectedRequestMethod[] = ["get"],
): Promise<T> => {
  if (!canUseRefererRules()) return operation();
  const initialUrl = canonicalRequestUrl(url);
  const { id, operation: entry } = await acquireRuleSlot(initialUrl, referer);
  try {
    const api = dnrApi();
    if (!api) return operation();
    const install = async (urls: readonly string[]): Promise<void> => {
      const sweeping = [...staleRuleIds];
      await api.updateSessionRules({
        removeRuleIds: [id, ...sweeping],
        addRules: [buildRule(urls, referer, requestMethods, id)],
      });
      // Only drop the IDs this update actually removed; a concurrent failure
      // may have recorded more while it was in flight.
      for (const stale of sweeping) staleRuleIds.delete(stale);
    };
    // An oversized alternation is rejected by the browser, and there is no
    // previous rule to fall back to on the first install, so the operation
    // degrades to an unprotected request rather than failing the download.
    if (urlSetRegex(entry.urls).length > MAX_REGEX_FILTER_LENGTH) return operation();
    try {
      await install(entry.urls);
    } catch {
      return operation();
    }
    const removeReservedUrl = (reservedUrl: string): void => {
      entry.urls = entry.urls.filter((reserved) => reserved !== reservedUrl);
      wakeReleaseWaiters();
    };
    const extend = async (candidate: string): Promise<boolean> => {
      // The finally below removes the rule; a late extend from a leaked
      // callback must not resurrect it.
      if (entry.released) return false;
      const normalized = normalizeExtensionCandidate(candidate);
      if (!normalized || entry.urls.includes(normalized)) return false;
      if (entry.urls.length >= 1 + MAX_PROTECTED_URL_EXTENSIONS) return false;
      // A mid-flight extension toward a URL another in-flight operation
      // covers with a different Referer must not wait: two operations
      // extending toward each other would deadlock while both hold slots.
      // Refusing degrades to the unextended rule, exactly like an oversized
      // or rejected extension.
      if (conflictingOperation(normalized, referer)) return false;
      const next = [...entry.urls, normalized];
      if (urlSetRegex(next).length > MAX_REGEX_FILTER_LENGTH) return false;
      // Reserve before the first await so another operation cannot pass the
      // overlap check while this rule update is still pending. Writes for one
      // operation are serialized so each install sees the cumulative URL set.
      entry.urls.push(normalized);
      const write = entry.extensionWrites.then(async () => {
        if (entry.released) {
          // Keep the reservation until cleanup. An earlier queued install may
          // still cover it, and waking a conflicting operation before the old
          // rule is removed would violate the no-overlap invariant.
          return false;
        }
        const installedNext = [...entry.installedUrls, normalized];
        try {
          // updateSessionRules replaces atomically; on rejection the previous
          // rule stays active and the caller degrades to unextended behavior.
          await install(installedNext);
          entry.installedUrls.push(normalized);
          return true;
        } catch {
          removeReservedUrl(normalized);
          return false;
        }
      });
      entry.extensionWrites = write.then(() => undefined);
      return write;
    };
    try {
      return await operation({ extend });
    } finally {
      entry.released = true;
      // An extend started by the operation but not awaited must settle before
      // removal, or its queued install could recreate the rule afterward.
      await entry.extensionWrites;
      // Do not turn a completed request into a failed download if cleanup is
      // rejected, but the rule may still be live: record it so the next install
      // sweeps it, because this ID can be reused for a different Referer.
      await api.updateSessionRules({ removeRuleIds: [id] }).catch(() => staleRuleIds.add(id));
    }
  } finally {
    releaseRuleSlot(id);
  }
};

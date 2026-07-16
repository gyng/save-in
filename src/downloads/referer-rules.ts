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
  urls: string[];
  done: Promise<void>;
  finish: () => void;
};

const inFlight = new Map<number, InFlightOperation>();
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
        let finish!: () => void;
        const done = new Promise<void>((resolve) => {
          finish = resolve;
        });
        const operation: InFlightOperation = { referer, urls: [url], done, finish };
        inFlight.set(id, operation);
        return { id, operation };
      }
    }
    await waitForRelease();
  }
};

const releaseRuleSlot = (id: number): void => {
  const operation = inFlight.get(id);
  inFlight.delete(id);
  operation?.finish();
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
      initiatorDomains: [initiatorDomain],
      requestMethods,
      resourceTypes: ["xmlhttprequest"],
    },
  };
};

// A background stop can strand any subset of the pool, so recovery always
// clears the whole ID range in one call rather than a single reserved ID.
const removeAllRules = (api: DnrApi): Promise<void> =>
  api.updateSessionRules({ removeRuleIds: [...REFERER_SESSION_RULE_IDS] });

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
    const install = (urls: readonly string[]): Promise<void> =>
      api.updateSessionRules({
        removeRuleIds: [id],
        addRules: [buildRule(urls, referer, requestMethods, id)],
      });
    await install(entry.urls);
    let released = false;
    const extend = async (candidate: string): Promise<boolean> => {
      // The finally below removes the rule; a late extend from a leaked
      // callback must not resurrect it.
      if (released) return false;
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
      try {
        // updateSessionRules replaces atomically; on rejection the previous
        // rule stays active and the caller degrades to unextended behavior.
        await install(next);
      } catch {
        return false;
      }
      entry.urls.push(normalized);
      return true;
    };
    try {
      return await operation({ extend });
    } finally {
      released = true;
      // Do not turn a completed request into a failed download if cleanup is
      // rejected. The exact rule is replaced next time and removed at startup.
      await api.updateSessionRules({ removeRuleIds: [id] }).catch(() => {});
    }
  } finally {
    releaseRuleSlot(id);
  }
};

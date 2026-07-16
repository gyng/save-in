import { BROWSERS, CURRENT_BROWSER } from "../platform/chrome-detector.ts";
import type { ProtectedRequestMethod } from "../routing/ports.ts";
import { MAX_PROTECTED_URL_EXTENSIONS, type RefererProtection } from "../shared/protected-fetch.ts";
import { createSerialQueue } from "../shared/serial-queue.ts";

export const REFERER_SESSION_RULE_ID = 66_000_001;

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

// Referer session rules are shared state that must never carry two values at
// once, so every rule mutation runs through one serial queue.
const { enqueue, settled } = createSerialQueue();

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
): RefererRule => {
  const initiatorDomain = extensionInitiatorDomain();
  if (!initiatorDomain) throw new Error("Extension request origin is unavailable");
  const urls = typeof url === "string" ? [canonicalRequestUrl(url)] : url;
  return {
    id: REFERER_SESSION_RULE_ID,
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

const removeRule = async (): Promise<void> => {
  const api = dnrApi();
  if (!api) return;
  await api.updateSessionRules({ removeRuleIds: [REFERER_SESSION_RULE_ID] });
};

export const canUseRefererRules = (): boolean =>
  (CURRENT_BROWSER === BROWSERS.CHROME || CURRENT_BROWSER === BROWSERS.FIREFOX) &&
  typeof dnrApi()?.updateSessionRules === "function" &&
  extensionInitiatorDomain() !== undefined;

// A background stop can prevent the finally block below from running.
// Session rules outlive background instances, so startup removes our reserved ID.
export const cleanupStaleRefererRule = (): Promise<void> =>
  canUseRefererRules() ? enqueue(removeRule) : Promise.resolve();

export const resetRefererRules = async (): Promise<void> => {
  await settled();
  if (canUseRefererRules()) await enqueue(removeRule);
};

export const withRequestReferer = <T>(
  url: string,
  referer: string,
  operation: (protection?: RefererProtection) => Promise<T>,
  requestMethods: ProtectedRequestMethod[] = ["get"],
): Promise<T> => {
  if (!canUseRefererRules()) return operation();
  return enqueue(async () => {
    const api = dnrApi();
    if (!api) return operation();
    const protectedUrls = [canonicalRequestUrl(url)];
    const install = (urls: readonly string[]): Promise<void> =>
      api.updateSessionRules({
        removeRuleIds: [REFERER_SESSION_RULE_ID],
        addRules: [buildRule(urls, referer, requestMethods)],
      });
    await install(protectedUrls);
    let released = false;
    // Runs inside the held queue slot, so it must update the rule directly:
    // going through enqueue here would deadlock behind this operation.
    const extend = async (candidate: string): Promise<boolean> => {
      // The finally below removes the rule; a late extend from a leaked
      // callback must not resurrect it.
      if (released) return false;
      const normalized = normalizeExtensionCandidate(candidate);
      if (!normalized || protectedUrls.includes(normalized)) return false;
      if (protectedUrls.length >= 1 + MAX_PROTECTED_URL_EXTENSIONS) return false;
      const next = [...protectedUrls, normalized];
      if (urlSetRegex(next).length > MAX_REGEX_FILTER_LENGTH) return false;
      try {
        // updateSessionRules replaces atomically; on rejection the previous
        // rule stays active and the caller degrades to unextended behavior.
        await install(next);
      } catch {
        return false;
      }
      protectedUrls.push(normalized);
      return true;
    };
    try {
      return await operation({ extend });
    } finally {
      released = true;
      // Do not turn a completed request into a failed download if cleanup is
      // rejected. The exact rule is replaced next time and removed at startup.
      await removeRule().catch(() => {});
    }
  });
};

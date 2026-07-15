import { BROWSERS, CURRENT_BROWSER } from "../platform/chrome-detector.ts";
import type { ProtectedRequestMethod } from "../routing/ports.ts";

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

let ruleQueue: Promise<void> = Promise.resolve();

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

const exactRequestUrlRegex = (value: string): string => {
  const url = new URL(value);
  // Fragments are local browser state and are never part of the HTTP request.
  url.hash = "";
  return `^${escapeRegex(url.href)}$`;
};

const buildRule = (
  url: string,
  referer: string,
  requestMethods: ProtectedRequestMethod[] = ["get"],
): RefererRule => {
  const initiatorDomain = extensionInitiatorDomain();
  if (!initiatorDomain) throw new Error("Extension request origin is unavailable");
  return {
    id: REFERER_SESSION_RULE_ID,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [{ header: "Referer", operation: "set", value: referer }],
    },
    condition: {
      regexFilter: exactRequestUrlRegex(url),
      initiatorDomains: [initiatorDomain],
      requestMethods,
      resourceTypes: ["xmlhttprequest"],
    },
  };
};

const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = ruleQueue.then(operation, operation);
  ruleQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const removeRule = async (): Promise<void> => {
  const api = dnrApi();
  if (!api) return;
  await api.updateSessionRules({ removeRuleIds: [REFERER_SESSION_RULE_ID] });
};

export const RefererRules = {
  canUse: (): boolean =>
    (CURRENT_BROWSER === BROWSERS.CHROME || CURRENT_BROWSER === BROWSERS.FIREFOX) &&
    typeof dnrApi()?.updateSessionRules === "function" &&
    extensionInitiatorDomain() !== undefined,

  buildRule,

  // A background stop can prevent the finally block below from running.
  // Session rules outlive background instances, so startup removes our reserved ID.
  cleanupStaleRule: (): Promise<void> =>
    RefererRules.canUse() ? enqueue(removeRule) : Promise.resolve(),

  reset: async (): Promise<void> => {
    await ruleQueue;
    if (RefererRules.canUse()) await enqueue(removeRule);
  },

  withReferer: <T>(
    url: string,
    referer: string,
    operation: () => Promise<T>,
    requestMethods: ProtectedRequestMethod[] = ["get"],
  ): Promise<T> => {
    if (!RefererRules.canUse()) return operation();
    return enqueue(async () => {
      const api = dnrApi();
      if (!api) return operation();
      await api.updateSessionRules({
        removeRuleIds: [REFERER_SESSION_RULE_ID],
        addRules: [buildRule(url, referer, requestMethods)],
      });
      try {
        return await operation();
      } finally {
        // Do not turn a completed request into a failed download if cleanup is
        // rejected. The exact rule is replaced next time and removed at startup.
        await removeRule().catch(() => {});
      }
    });
  },
};

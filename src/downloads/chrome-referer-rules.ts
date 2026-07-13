import { BROWSERS, CURRENT_BROWSER } from "../platform/chrome-detector.ts";
import type { ProtectedRequestMethod } from "../routing/ports.ts";

export const REFERER_SESSION_RULE_ID = 66_000_001;

let ruleQueue: Promise<void> = Promise.resolve();

const dnrApi = (): typeof chrome.declarativeNetRequest | undefined =>
  globalThis.chrome?.declarativeNetRequest;

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
): chrome.declarativeNetRequest.Rule => ({
  id: REFERER_SESSION_RULE_ID,
  priority: 1,
  action: {
    type: "modifyHeaders",
    requestHeaders: [{ header: "Referer", operation: "set", value: referer }],
  },
  condition: {
    regexFilter: exactRequestUrlRegex(url),
    initiatorDomains: [chrome.runtime.id],
    // @types/chrome models request methods as a runtime enum even though the
    // WebExtension API consumes their lowercase JSON string values.
    requestMethods: requestMethods as chrome.declarativeNetRequest.RequestMethod[],
    resourceTypes: ["xmlhttprequest"],
  },
});

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

export const ChromeRefererRules = {
  canUse: (): boolean =>
    CURRENT_BROWSER === BROWSERS.CHROME &&
    typeof dnrApi()?.updateSessionRules === "function" &&
    typeof globalThis.chrome?.runtime?.id === "string",

  buildRule,

  // A service-worker stop can prevent the finally block below from running.
  // Session rules outlive worker instances, so startup removes our reserved ID.
  cleanupStaleRule: (): Promise<void> =>
    ChromeRefererRules.canUse() ? enqueue(removeRule) : Promise.resolve(),

  withReferer: <T>(
    url: string,
    referer: string,
    operation: () => Promise<T>,
    requestMethods: ProtectedRequestMethod[] = ["get"],
  ): Promise<T> => {
    if (!ChromeRefererRules.canUse()) return operation();
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
        // Do not turn a completed file transfer into a failed download if
        // Chrome rejects cleanup. The exact rule is replaced by the next
        // protected fetch and removed during the next background startup.
        await removeRule().catch(() => {});
      }
    });
  },
};

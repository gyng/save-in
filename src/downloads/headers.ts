import { options } from "../config/options-data.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";
import { splitLines, withUrl } from "../shared/util.ts";
import { Log } from "../background/log.ts";
import type { DownloadInfo } from "./download-types.ts";

type RefererState = { info?: Pick<DownloadInfo, "url" | "pageUrl"> } | null | undefined;

export const RequestHeaders = {
  DNR_REFERER_RULE_ID: 4077,
  // Concurrent downloads needing different referers must not share one rule id
  // (the second would clobber the first). Cycle through a bounded range and
  // reuse ids (removeRuleIds before addRules), so at most COUNT rules coexist.
  DNR_REFERER_RULE_COUNT: 50,
  refererRuleOffset: 0,
  nextRefererRuleId: () => {
    const id = RequestHeaders.DNR_REFERER_RULE_ID + RequestHeaders.refererRuleOffset;
    RequestHeaders.refererRuleOffset =
      (RequestHeaders.refererRuleOffset + 1) % RequestHeaders.DNR_REFERER_RULE_COUNT;
    return id;
  },

  // Matches URLs against the newline-separated match patterns in
  // options.setRefererHeaderFilter (e.g., `*://i.pximg.net/*`), following
  // WebExtension match pattern semantics: the host part is anchored so a
  // pattern cannot match inside another URL's query string
  matchPatternToRegExp: (pattern: string): RegExp | null => {
    const escapeRegExp = (s: string): string => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

    const parts = pattern.match(/^(\*|https?|file|ftp):\/\/([^/]*)(\/.*)$/);
    if (!parts) {
      return null;
    }

    const scheme = parts[1] === "*" ? "https?" : parts[1];

    let host;
    if (parts[2] === "*") {
      host = "[^/]+";
    } else if (parts[2].startsWith("*.")) {
      host = `([^/]+\\.)?${escapeRegExp(parts[2].slice(2))}`;
    } else {
      host = escapeRegExp(parts[2]);
    }

    const path = parts[3].split("*").map(escapeRegExp).join(".*");

    return new RegExp(`^${scheme}://${host}${path}$`);
  },

  matchesRefererFilter: (url: string): boolean =>
    splitLines(options.setRefererHeaderFilter).some((pattern) => {
      try {
        const re = RequestHeaders.matchPatternToRegExp(pattern);
        return re != null && re.test(url);
      } catch (e) {
        return false;
      }
    }),

  // Set the Referer header for the upcoming download with a declarativeNetRequest
  // session rule. Both browsers use this path: Firefox and Chrome MV3 both
  // support DNR modifyHeaders for the Referer header (verified on downloads.download
  // requests), so no blocking webRequest is needed — and Chrome MV3 forbids
  // webRequestBlocking for non-policy extensions anyway.
  prepareReferer: (state: RefererState): Promise<void> => {
    if (!options.setRefererHeader) {
      return Promise.resolve();
    }

    if (typeof chrome === "undefined" || !chrome.declarativeNetRequest) {
      return Promise.resolve();
    }

    const pageUrl = state && state.info && state.info.pageUrl;
    const url = state && state.info && state.info.url;

    if (!pageUrl || !url || !RequestHeaders.matchesRefererFilter(url)) {
      return Promise.resolve();
    }

    // Scope the rule to the source host, not the exact URL: DNR conditions are
    // evaluated per request, and a hotlink CDN often 302s to a signed URL on the
    // same host. An exact urlFilter wouldn't match that redirected leg (so the
    // Referer would be dropped); requestDomains covers the whole host for the
    // rule's short lifetime. Falls back to the exact URL if the host can't be
    // parsed. (#66/#193)
    const host = withUrl(url, (parsedUrl) => parsedUrl.hostname, null);

    const ruleId = RequestHeaders.nextRefererRuleId();
    return chrome.declarativeNetRequest
      .updateSessionRules({
        removeRuleIds: [ruleId],
        addRules: [
          {
            id: ruleId,
            action: {
              type: "modifyHeaders",
              requestHeaders: [{ header: "Referer", operation: "set", value: pageUrl }],
            },
            condition: {
              ...(host ? { requestDomains: [host] } : { urlFilter: url }),
              // A session rule scoped only to the CDN host could rewrite
              // unrelated tab traffic during its cleanup window. Downloads
              // initiated by this extension carry its runtime id as their
              // initiator domain in both supported MV3 implementations.
              ...(webExtensionApi.runtime.id
                ? { initiatorDomains: [webExtensionApi.runtime.id] }
                : {}),
            },
          },
        ],
      })
      .then(() => {
        Log.add("referer session rule set", { id: ruleId, url, referer: pageUrl });

        // Best-effort cleanup so the rule does not outlive the download
        setTimeout(() => {
          chrome.declarativeNetRequest
            .updateSessionRules({
              removeRuleIds: [ruleId],
            })
            .catch(() => {});
        }, 30000);
      })
      .catch(() => {});
  },
};

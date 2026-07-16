import {
  cssSelectorsForRules,
  matchedCssSelectorsByOrigin,
  sourceOriginElements,
} from "./css-routing.ts";
import {
  isAdmittedAutomaticSource,
  matchAutomaticRoutingRule,
  type AutomaticRoutingCandidate,
} from "../automation/automatic-routing.ts";
import { collectPageSourceCandidates } from "./source-panel-model.ts";
import { parseRulesCollecting } from "../routing/rule-parser.ts";
import { isAutomaticRuleClauses } from "../routing/automatic-rule.ts";
import { normalizeAutoDownloadLimit } from "../config/content-options.ts";
import { automaticSeenKey, isDataUrl, isDataUrlWithinCap } from "../shared/data-url.ts";

export type AutoDownloadSendResult = "started" | "skipped" | "failed";

// The once-per-visit dedup set and its consumed budget (seen.size) outlive a
// discovery instance: a disable-list edit remounts discovery, and a fresh set
// there would re-download everything already saved on every open matching
// tab. Rule, limit, and toggle edits reset it (the 4.0 contract: edited rules
// apply to media already on the page).
export type AutoDownloadDedup = { seen: Set<string>; limitNotified: boolean };
export const createAutoDownloadDedup = (): AutoDownloadDedup => ({
  seen: new Set<string>(),
  limitNotified: false,
});

export type AutoDownloadDiscoveryOptions = {
  rules: string;
  live: boolean;
  maxPerPage: number;
  // Adopting anchors that point at previewable media is opt-in: pre-4.1 rules
  // matched only media embedded on the page, so link adoption stays off unless
  // the user enabled the autoDownloadLinks content option.
  includeLinks: boolean;
  // Phase B channels (4.2), each its own default-off content option, gated
  // per candidate by isAdmittedAutomaticSource so enabling one channel never
  // silently adopts a kind that only belongs to another. includeDocuments
  // turns on anchor collection on its own (like includeLinks), so linked
  // documents/streams are adopted whether or not includeLinks is also on.
  includeDocuments: boolean;
  includeBackgrounds: boolean;
  resourceHints: boolean;
  // Phase C (4.2): a protocol gate, not a fifth channel. When on, self-contained
  // data: URLs are admitted through whatever channel discovered them (an inline
  // <img src="data:…"> stays channel-absent embedded media; a data: anchor still
  // needs its channel gate). blob: is never admitted. Off by default.
  includeDataUrls: boolean;
  // Enforced at dispatch time against the live URL so a single-page-app
  // navigation onto the disable list stops queued saves without an options
  // change, and one off it resumes them.
  isPageDisabled: () => boolean;
  send: (candidate: AutomaticRoutingCandidate) => Promise<AutoDownloadSendResult>;
  onLimitReached?: (() => void) | undefined;
  dedup?: AutoDownloadDedup | undefined;
};
export type AutoDownloadDiscovery = {
  scan(root?: ParentNode): void;
  idle(): Promise<void>;
  stop(): void;
};

const automaticUrl = (value: string, includeDataUrls: boolean): string | null => {
  // data: is opt-in and capped. The raw string is the URL — do not run it
  // through URL() (that would strip a trailing #fragment from the payload). An
  // oversize candidate is dropped here before it can ride a runtime message;
  // the background backstop logs the same rejection. blob: falls through to the
  // http(s)-only branch below and is rejected there.
  if (isDataUrl(value)) {
    if (!includeDataUrls || !isDataUrlWithinCap(value)) return null;
    return value;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
};

export const setupAutoDownloadDiscovery = (
  options: AutoDownloadDiscoveryOptions,
): AutoDownloadDiscovery => {
  const parsed = parseRulesCollecting(options.rules);
  const automaticRules = parsed.rules.filter(isAutomaticRuleClauses);
  const cssSelectors = cssSelectorsForRules(automaticRules);
  const dedup = options.dedup ?? createAutoDownloadDedup();
  const seen = dedup.seen;
  const queue: AutomaticRoutingCandidate[] = [];
  const idleWaiters = new Set<() => void>();
  const maxPerPage = normalizeAutoDownloadLimit(options.maxPerPage);
  let stopped = false;
  let draining = false;
  let refreshTimer = 0;

  const settleIdle = () => {
    if (draining || queue.length > 0) return;
    idleWaiters.forEach((resolve) => resolve());
    idleWaiters.clear();
  };

  const drain = async () => {
    if (draining || stopped) return;
    draining = true;
    while (true) {
      const candidate = queue.shift();
      if (!candidate) break;
      // Re-check between queueing and dispatch: the page may have navigated
      // onto the disable list while earlier candidates were being sent. A
      // dropped candidate is un-consumed — its dedup slot and budget return,
      // and the limit notice may fire again for the refilled budget — so a
      // rescan after the page leaves the list can still save it.
      if (options.isPageDisabled()) {
        seen.delete(automaticSeenKey(candidate.sourceUrl));
        dedup.limitNotified = false;
        continue;
      }
      try {
        const result = await options.send(candidate);
        // A teardown mid-send force-skips delivery, so the shifted candidate
        // never reached a download; return its slot like the still-queued
        // ones in stop(), or a disable-list-only remount would skip it.
        if (stopped && result !== "started") {
          seen.delete(automaticSeenKey(candidate.sourceUrl));
          dedup.limitNotified = false;
        }
      } catch {
        // The content script must keep observing even if its extension context
        // is reloaded or one automatic download is rejected by the background.
      }
    }
    draining = false;
    settleIdle();
  };

  const scan = (root: ParentNode = document) => {
    if (stopped || automaticRules.length === 0) return;
    // A disabled page must consume nothing: recording sources or per-page
    // budget here would block their adoption after the page leaves the list.
    // Every relevant DOM mutation rescans the whole document, so discovery
    // resumes on the next mutation after a pushState navigation off the list;
    // a perfectly static page stays idle until an option change remounts
    // discovery (content scripts get no navigation event for pushState).
    if (options.isPageDisabled()) return;
    const pageUrl = `${window.location}`;
    const candidates = collectPageSourceCandidates(root, {
      includeBackgrounds: options.includeBackgrounds,
      resourceHints: options.resourceHints,
      // Documents/streams are anchor-classified, so their option turns on
      // anchor collection by itself — it does not require includeLinks.
      includeLinks: options.includeLinks || options.includeDocuments,
    });
    for (const source of candidates) {
      if (source.previewable === false) continue;
      if (
        !isAdmittedAutomaticSource(source.kind, source.channel, {
          includeLinks: options.includeLinks,
          includeDocuments: options.includeDocuments,
          includeBackgrounds: options.includeBackgrounds,
          resourceHints: options.resourceHints,
        })
      )
        continue;
      const sourceUrl = automaticUrl(source.url, options.includeDataUrls);
      if (!sourceUrl) continue;
      // A long data: URL keys the dedup set on its hash so the set never holds a
      // megabyte string; http(s) and short data: URLs key on the string itself.
      const seenKey = automaticSeenKey(sourceUrl);
      if (seen.has(seenKey)) continue;
      const candidate: AutomaticRoutingCandidate = {
        pageUrl,
        sourceUrl,
        sourceKind: source.kind,
        ...(source.channel ? { sourceChannel: source.channel } : {}),
        ...(cssSelectors.length > 0
          ? {
              matchedCssSelectorsByOrigin: matchedCssSelectorsByOrigin(
                sourceOriginElements(source),
                cssSelectors,
              ),
            }
          : {}),
      };
      if (!matchAutomaticRoutingRule(automaticRules, candidate)) continue;
      if (seen.size >= maxPerPage) {
        if (!dedup.limitNotified) {
          dedup.limitNotified = true;
          options.onLimitReached?.();
        }
        continue;
      }
      seen.add(seenKey);
      queue.push(candidate);
    }
    void drain();
  };

  const observer = new MutationObserver((mutations) => {
    if (stopped) return;
    const relevant = mutations.some(
      (mutation) =>
        mutation.type === "attributes" ||
        [...mutation.addedNodes].some((node) => node instanceof Element),
    );
    if (!relevant) return;
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => scan(document), 200);
  });

  if (options.live && automaticRules.length > 0) {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      ...(cssSelectors.length > 0 ? {} : { attributeFilter: ["href", "src", "srcset"] }),
    });
  }
  scan(document);

  return {
    scan,
    idle: () =>
      draining || queue.length > 0
        ? new Promise<void>((resolve) => idleWaiters.add(resolve))
        : Promise.resolve(),
    stop: () => {
      if (stopped) return;
      stopped = true;
      observer.disconnect();
      window.clearTimeout(refreshTimer);
      // The dedup outlives this instance across a remount, so queued-but-
      // unsent candidates must return their slot and budget (symmetric with
      // the dispatch-time drop) or the remounted rescan would skip them
      // forever; the limit notice may then fire again for the refill.
      if (queue.length > 0) {
        for (const candidate of queue) seen.delete(automaticSeenKey(candidate.sourceUrl));
        dedup.limitNotified = false;
        queue.length = 0;
      }
      settleIdle();
    },
  };
};

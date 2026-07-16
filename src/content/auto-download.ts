import { cssSelectorsForRules, matchedCssSelectorsByOrigin } from "./css-routing.ts";
import {
  isAdmittedAutomaticSource,
  matchAutomaticRoutingRule,
  normalizeAutomaticSourceUrl,
  type AutomaticRoutingCandidate,
} from "../automation/automatic-routing.ts";
import { collectPageSourceCandidates } from "./source-panel-model.ts";
import { parseRulesCollecting } from "../routing/rule-parser.ts";
import { isAutomaticRuleClauses } from "../routing/automatic-rule.ts";
import { normalizeAutoDownloadLimit } from "../config/content-options.ts";
import {
  automaticSeenKey,
  DATA_URL_DEDUP_THRESHOLD,
  DATA_URL_MAX_LENGTH,
  isDataUrl,
} from "../shared/data-url.ts";

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

export const setupAutoDownloadDiscovery = (
  options: AutoDownloadDiscoveryOptions,
): AutoDownloadDiscovery => {
  const parsed = parseRulesCollecting(options.rules);
  const automaticRules = parsed.rules.filter(isAutomaticRuleClauses);
  const cssSelectors = cssSelectorsForRules(automaticRules);
  const dedup = options.dedup ?? createAutoDownloadDedup();
  const seen = dedup.seen;
  const queue: AutomaticRoutingCandidate[] = [];

  // The pure-JS SHA-256 over a ≤2 MB data: URL is the one expensive step of a
  // scan, and a live page rescans on every DOM mutation. Memoize the hashed
  // keys so an already-seen data: URL is hashed once — not on every rescan, and
  // not again when its slot is later released in drain()/stop(). The cache is
  // bounded (a data: string can be ~2 MB) and only the hashed case is stored;
  // http(s) and short data: URLs key on themselves and cost nothing to derive.
  const seenKeyCache = new Map<string, string>();
  // Bound both the memoized raw strings and queued/in-flight candidates by
  // characters, not entry count: a hostile page controls both size and count.
  const AUTO_DATA_CHARACTER_BUDGET = DATA_URL_MAX_LENGTH * 2;
  let seenKeyCacheCharacters = 0;
  const seenKeyFor = (url: string): string => {
    if (!(isDataUrl(url) && url.length > DATA_URL_DEDUP_THRESHOLD)) return automaticSeenKey(url);
    const cached = seenKeyCache.get(url);
    if (cached !== undefined) return cached;
    const key = automaticSeenKey(url);
    while (
      seenKeyCache.size > 0 &&
      seenKeyCacheCharacters + url.length > AUTO_DATA_CHARACTER_BUDGET
    ) {
      for (const oldest of seenKeyCache.keys()) {
        seenKeyCache.delete(oldest);
        seenKeyCacheCharacters -= oldest.length;
        break;
      }
    }
    seenKeyCache.set(url, key);
    seenKeyCacheCharacters += url.length;
    return key;
  };

  // A candidate that never reached a download frees its once-per-visit slot and
  // budget so a later rescan can re-offer it; the limit notice may then fire
  // again for the refilled budget.
  const releaseSlot = (seenKey: string) => {
    seen.delete(seenKey);
    dedup.limitNotified = false;
  };
  const idleWaiters = new Set<() => void>();
  const maxPerPage = normalizeAutoDownloadLimit(options.maxPerPage);
  let stopped = false;
  let draining = false;
  let refreshTimer = 0;
  let outstandingDataCharacters = 0;

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
      const seenKey = seenKeyFor(candidate.sourceUrl);
      try {
        // Re-check between queueing and dispatch: the page may have navigated
        // onto the disable list while earlier candidates were being sent.
        if (options.isPageDisabled()) {
          releaseSlot(seenKey);
          continue;
        }
        try {
          const result = await options.send(candidate);
          // Only a started save holds its once-per-visit slot. A terminal
          // non-start never consumed the candidate and can be offered again.
          if (result !== "started") releaseSlot(seenKey);
        } catch {
          // Keep observing across a reloaded extension context or one rejected
          // automatic download; neither consumed the candidate.
          releaseSlot(seenKey);
        }
      } finally {
        if (isDataUrl(candidate.sourceUrl)) {
          outstandingDataCharacters -= candidate.sourceUrl.length;
        }
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
    const admittedSources = [];
    for (const source of candidates) {
      if (source.previewable === false) continue;
      const gates = {
        includeLinks: options.includeLinks,
        includeDocuments: options.includeDocuments,
        includeBackgrounds: options.includeBackgrounds,
        resourceHints: options.resourceHints,
        includeDataUrls: options.includeDataUrls,
      };
      if (!isAdmittedAutomaticSource(source.kind, source.channel, gates)) continue;
      const sourceUrl = normalizeAutomaticSourceUrl(source.url, gates);
      if (!sourceUrl) continue;
      admittedSources.push({ ...source, url: sourceUrl });
    }
    // A URL can be declared by several elements. Route it with the complete
    // origin set so configured rule order—not collector traversal order—picks
    // the destination. Keep each admitted kind/channel variant for the normal
    // non-CSS matchers; only the DOM-origin evidence is shared by URL.
    const sourcesByUrl = new Map<string, typeof admittedSources>();
    for (const source of admittedSources) {
      const group = sourcesByUrl.get(source.url);
      if (group) group.variants.push(source);
      else sourcesByUrl.set(source.url, { representative: source, variants: [source] });
    }
    for (const [sourceUrl, { representative, variants }] of sourcesByUrl) {
      // A long data: URL keys the dedup set on its hash so the set never holds a
      // megabyte string; http(s) and short data: URLs key on the string itself.
      const seenKey = seenKeyFor(sourceUrl);
      if (seen.has(seenKey)) continue;
      const origins = sources.flatMap((source) =>
        source.channel === "resource-hint" ? [] : [source.element],
      );
      const cssAttestation =
        cssSelectors.length > 0 ? matchedCssSelectorsByOrigin(origins, automaticRules) : undefined;
      const candidatesForUrl = sources.map(
        (source): AutomaticRoutingCandidate => ({
          pageUrl,
          sourceUrl,
          sourceKind: source.kind,
          ...(source.channel ? { sourceChannel: source.channel } : {}),
          ...(cssAttestation ? { matchedCssSelectorsByOrigin: cssAttestation } : {}),
        }),
      );
      let selected: AutomaticRoutingCandidate | undefined;
      for (const rule of automaticRules) {
        selected = candidatesForUrl.find((candidate) =>
          Boolean(matchAutomaticRoutingRule([rule], candidate)),
        );
        if (selected) break;
      }
      if (!selected) continue;
      if (
        isDataUrl(sourceUrl) &&
        outstandingDataCharacters + sourceUrl.length > AUTO_DATA_CHARACTER_BUDGET
      )
        continue;
      if (seen.size >= maxPerPage) {
        if (!dedup.limitNotified) {
          dedup.limitNotified = true;
          options.onLimitReached?.();
        }
        continue;
      }
      seen.add(seenKey);
      queue.push(selected);
      if (isDataUrl(sourceUrl)) outstandingDataCharacters += sourceUrl.length;
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
        for (const candidate of queue) {
          seen.delete(seenKeyFor(candidate.sourceUrl));
          if (isDataUrl(candidate.sourceUrl)) {
            outstandingDataCharacters -= candidate.sourceUrl.length;
          }
        }
        dedup.limitNotified = false;
        queue.length = 0;
      }
      settleIdle();
    },
  };
};

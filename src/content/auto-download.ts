import {
  matchAutomaticRoutingRule,
  type AutomaticRoutingCandidate,
} from "../automation/automatic-routing.ts";
import { collectPageSourceCandidates, type PageSource } from "./source-panel-model.ts";
import { parseRulesCollecting } from "../routing/rule-parser.ts";
import { isAutomaticRuleClauses } from "../routing/automatic-rule.ts";
import { normalizeAutoDownloadLimit } from "../config/content-options.ts";

export type AutoDownloadSendResult = "started" | "skipped" | "failed";
export type AutoDownloadDiscoveryOptions = {
  rules: string;
  live: boolean;
  maxPerPage: number;
  send: (candidate: AutomaticRoutingCandidate) => Promise<AutoDownloadSendResult>;
  onLimitReached?: (() => void) | undefined;
};
export type AutoDownloadDiscovery = {
  scan(root?: ParentNode): void;
  idle(): Promise<void>;
  stop(): void;
};

// Phase A of scan coverage: the automatic scan adopts anchors only when the
// shared collector classified them as previewable media by URL extension.
// Anchors classified stream/document/plain link stay out until 4.2, so the scan
// keeps only image/video/audio candidates.
const AUTOMATIC_MEDIA_KINDS: ReadonlySet<PageSource["kind"]> = new Set(["image", "video", "audio"]);

const automaticUrl = (value: string): string | null => {
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
  const seen = new Set<string>();
  const queue: AutomaticRoutingCandidate[] = [];
  const idleWaiters = new Set<() => void>();
  const maxPerPage = normalizeAutoDownloadLimit(options.maxPerPage);
  let stopped = false;
  let draining = false;
  let limitNotified = false;
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
      try {
        await options.send(candidate);
      } catch {
        // The content script must keep observing even if its extension context
        // is reloaded or one automatic download is rejected by the background.
      }
    }
    draining = false;
    if (stopped) queue.length = 0;
    settleIdle();
  };

  const scan = (root: ParentNode = document) => {
    if (stopped || automaticRules.length === 0) return;
    const pageUrl = `${window.location}`;
    const candidates = collectPageSourceCandidates(root, {
      includeBackgrounds: false,
      resourceHints: false,
      includeLinks: true,
    });
    for (const source of candidates) {
      if (source.previewable === false) continue;
      if (!AUTOMATIC_MEDIA_KINDS.has(source.kind)) continue;
      const sourceUrl = automaticUrl(source.url);
      if (!sourceUrl || seen.has(sourceUrl)) continue;
      const candidate = { pageUrl, sourceUrl, sourceKind: source.kind };
      if (!matchAutomaticRoutingRule(automaticRules, candidate)) continue;
      if (seen.size >= maxPerPage) {
        if (!limitNotified) {
          limitNotified = true;
          options.onLimitReached?.();
        }
        continue;
      }
      seen.add(sourceUrl);
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
      attributeFilter: ["href", "src", "srcset"],
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
      queue.length = 0;
      settleIdle();
    },
  };
};

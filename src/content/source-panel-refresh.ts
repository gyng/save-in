import {
  collectBackgroundElements,
  collectBackgroundSourceCandidates,
  collectPageSourceCandidates,
  collectResourceHintSources,
  isPerformanceResourceTiming,
  mergePageSourcesByUrl,
  resourceTimingByUrl,
  type PageSource,
} from "./source-panel-model.ts";
import { PANEL_HOST_ID, cleanupPanelHost, panelOpenChanges } from "./source-panel-host.ts";
import type { SourcePanelContext } from "./source-panel-context.ts";

// Coalesce a burst of page mutations, but never postpone discovery past the
// max wait, however long the page keeps mutating.
const REFRESH_DEBOUNCE_MS = 200;
const REFRESH_MAX_WAIT_MS = 1000;

/** Source discovery: the initial scan, incremental DOM-mutation
 * reconciliation, background-element scanning, and resource-timing driven
 * byte-size updates. Owns ctx.allSources and the observers that keep it
 * live. */
export const wirePanelRefresh = (ctx: SourcePanelContext): void => {
  const { host } = ctx;
  const timingByUrl = resourceTimingByUrl();
  let detectionSequence = 0;
  let sourceCandidates: PageSource[] = [];
  let backgroundCandidates: PageSource[] = [];
  let resourceHintSources: PageSource[] = [];
  const firstSeen = new Map<string, { at: number; order: number }>();
  const commitSources = () => {
    ctx.allSources = mergePageSourcesByUrl(
      [sourceCandidates, backgroundCandidates, resourceHintSources].flat(),
    );
    const presentUrls = new Set(ctx.allSources.map(({ url }) => url));
    ctx.selectedSourceUrls.forEach((url) => {
      if (!presentUrls.has(url)) ctx.selectedSourceUrls.delete(url);
    });
    firstSeen.forEach((_value, url) => {
      if (!presentUrls.has(url)) firstSeen.delete(url);
    });
    ctx.allSources.forEach((source) => {
      if (!firstSeen.has(source.url)) {
        firstSeen.set(source.url, { at: Date.now(), order: ++detectionSequence });
      }
      const detection = firstSeen.get(source.url);
      /* v8 ignore next -- The immediately preceding block initializes every absent URL. */
      if (!detection) return;
      source.detectedAt = detection.at;
      source.detectedOrder = detection.order;
    });
    ctx.render();
  };
  let backgroundScanGeneration = 0;
  let backgroundScanHandle = 0;
  let backgroundScanUsesIdleCallback = false;
  let backgroundScanActive = false;
  const cancelBackgroundScan = () => {
    backgroundScanGeneration += 1;
    backgroundScanActive = false;
    if (!backgroundScanHandle) return;
    if (backgroundScanUsesIdleCallback && typeof window.cancelIdleCallback === "function")
      window.cancelIdleCallback(backgroundScanHandle);
    else window.clearTimeout(backgroundScanHandle);
    backgroundScanHandle = 0;
  };
  const scheduleBackgroundRefresh = () => {
    cancelBackgroundScan();
    if (ctx.panelOptions.includeBackgrounds === false) {
      backgroundCandidates = [];
      return;
    }
    const generation = backgroundScanGeneration;
    backgroundScanActive = true;
    const elements = collectBackgroundElements(document).filter((element) => element !== host);
    const nextBackgroundCandidates: PageSource[] = [];
    let index = 0;
    const runChunk = (deadline?: IdleDeadline) => {
      backgroundScanHandle = 0;
      let processed = 0;
      while (index < elements.length) {
        const element = elements[index++];
        /* v8 ignore next -- The loop bound guarantees an element at the incremented index. */
        if (!element) continue;
        if (element.isConnected)
          nextBackgroundCandidates.push(
            ...collectBackgroundSourceCandidates([element], timingByUrl),
          );
        processed += 1;
        if (processed >= 50 && (!deadline || deadline.timeRemaining() <= 1)) break;
      }
      if (generation !== backgroundScanGeneration) return;
      if (index >= elements.length) {
        backgroundScanActive = false;
        backgroundCandidates = nextBackgroundCandidates;
        commitSources();
        return;
      }
      queueChunk();
    };
    const queueChunk = () => {
      if (typeof window.requestIdleCallback === "function") {
        backgroundScanUsesIdleCallback = true;
        backgroundScanHandle = window.requestIdleCallback(runChunk, { timeout: 100 });
      } else {
        backgroundScanUsesIdleCallback = false;
        backgroundScanHandle = window.setTimeout(() => runChunk(), 0);
      }
    };
    queueChunk();
  };
  const refreshSources = () => {
    sourceCandidates = collectPageSourceCandidates(
      document,
      { ...ctx.panelOptions, includeBackgrounds: false, resourceHints: false },
      timingByUrl,
    );
    resourceHintSources =
      ctx.panelOptions.resourceHints === false
        ? []
        : collectResourceHintSources(timingByUrl, document.body);
    scheduleBackgroundRefresh();
    commitSources();
  };
  const removeSourcesUnder = (root: Element) => {
    sourceCandidates = sourceCandidates.filter(
      ({ element }) => element !== root && !root.contains(element),
    );
    backgroundCandidates = backgroundCandidates.filter(
      ({ element }) => element !== root && !root.contains(element),
    );
  };
  const reconcileRoot = (changedRoot: Element) => {
    const mediaOwner = changedRoot.matches("source") ? changedRoot.closest("video, audio") : null;
    const pictureOwner = changedRoot.matches("source")
      ? changedRoot.closest("picture")?.querySelector("img")
      : null;
    const root = mediaOwner || pictureOwner || changedRoot;
    removeSourcesUnder(root);
    sourceCandidates.push(
      ...collectPageSourceCandidates(
        root,
        { ...ctx.panelOptions, includeBackgrounds: false, resourceHints: false },
        timingByUrl,
      ),
    );
    if (ctx.panelOptions.includeBackgrounds !== false) {
      if (backgroundScanActive) scheduleBackgroundRefresh();
      else
        backgroundCandidates.push(
          ...collectBackgroundSourceCandidates(collectBackgroundElements(root), timingByUrl),
        );
    }
  };

  let refreshTimer = 0;
  let refreshMaxWaitTimer = 0;
  const pendingRoots = new Set<Element>();
  const removedRoots = new Set<Element>();
  let fullRefreshPending = false;
  const queueRoot = (root: Element) => {
    for (const pending of pendingRoots) {
      if (pending === root || pending.contains(root)) return;
      if (root.contains(pending)) pendingRoots.delete(pending);
    }
    pendingRoots.add(root);
  };
  const flushRefresh = () => {
    window.clearTimeout(refreshTimer);
    window.clearTimeout(refreshMaxWaitTimer);
    refreshTimer = 0;
    refreshMaxWaitTimer = 0;
    if (fullRefreshPending) {
      fullRefreshPending = false;
      pendingRoots.clear();
      removedRoots.clear();
      refreshSources();
      return;
    }
    removedRoots.forEach(removeSourcesUnder);
    removedRoots.clear();
    pendingRoots.forEach((root) => {
      if (root.isConnected) reconcileRoot(root);
    });
    pendingRoots.clear();
    commitSources();
  };
  const scheduleRefresh = () => {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(flushRefresh, REFRESH_DEBOUNCE_MS);
    // The debounce above restarts on every batch, and the observer watches
    // style/class across the whole subtree — a page animating anything (a
    // player's progress bar, a carousel, a spinner) mutates faster than the
    // debounce and would postpone discovery for as long as it runs. This bound
    // is armed once per burst and never restarted, so a busy page costs latency
    // instead of silence, and the queued roots cannot pin removed DOM forever.
    if (!refreshMaxWaitTimer) {
      refreshMaxWaitTimer = window.setTimeout(flushRefresh, REFRESH_MAX_WAIT_MS);
    }
  };
  const scheduleResponsiveRefresh = () => {
    if (ctx.panelOptions.live === false) return;
    fullRefreshPending = true;
    scheduleRefresh();
  };
  window.addEventListener("resize", scheduleResponsiveRefresh);
  window.visualViewport?.addEventListener("resize", scheduleResponsiveRefresh);
  const observer = new MutationObserver((mutations) => {
    if (!host.isConnected) {
      panelOpenChanges.get(host)?.(false);
      cleanupPanelHost(host);
      return;
    }
    if (
      mutations.every(
        ({ target }) =>
          target === host ||
          (target instanceof Element &&
            (ctx.highlightedElements.has(target) || target.closest(`#${PANEL_HOST_ID}`) === host)),
      )
    )
      return;
    mutations.forEach((mutation) => {
      const target = mutation.target instanceof Element ? mutation.target : null;
      const affectsStylesheet =
        ctx.panelOptions.includeBackgrounds !== false &&
        (Boolean(target?.closest("style")) ||
          target?.matches('link[rel~="stylesheet"]') === true ||
          [...mutation.addedNodes, ...mutation.removedNodes].some(
            (node) =>
              node instanceof Element &&
              (node.matches('style, link[rel~="stylesheet"]') ||
                Boolean(node.querySelector('style, link[rel~="stylesheet"]'))),
          ));
      const affectsBase =
        target?.matches("base") === true ||
        [...mutation.addedNodes, ...mutation.removedNodes].some(
          (node) =>
            node instanceof Element &&
            (node.matches("base") || Boolean(node.querySelector("base"))),
        );
      if (affectsStylesheet || affectsBase) {
        fullRefreshPending = true;
        return;
      }
      if (mutation.type === "attributes") {
        if (target) queueRoot(target);
        return;
      }
      mutation.removedNodes.forEach((node) => {
        if (node instanceof Element) removedRoots.add(node);
      });
      mutation.addedNodes.forEach((node) => {
        if (node instanceof Element) queueRoot(node);
      });
      if (target?.matches("video, audio, picture")) queueRoot(target);
    });
    scheduleRefresh();
  });
  const resourceObserver =
    typeof PerformanceObserver === "function"
      ? new PerformanceObserver((entries) => {
          const observed = entries.getEntries().filter(isPerformanceResourceTiming);
          observed.forEach((entry) => timingByUrl.set(entry.name, entry));
          let changed = false;
          sourceCandidates = sourceCandidates.map((source) => {
            const timing = timingByUrl.get(source.url);
            const bytes = timing?.encodedBodySize || timing?.transferSize || undefined;
            if (source.bytes === bytes) return source;
            changed = true;
            return { ...source, bytes };
          });
          backgroundCandidates = backgroundCandidates.map((source) => {
            const timing = timingByUrl.get(source.url);
            const bytes = timing?.encodedBodySize || timing?.transferSize || undefined;
            if (source.bytes === bytes) return source;
            changed = true;
            return { ...source, bytes };
          });
          if (
            ctx.panelOptions.resourceHints !== false &&
            observed.some(({ name }) => /\.(?:m3u8|mpd)(?:$|[?#])/i.test(name))
          ) {
            resourceHintSources = collectResourceHintSources(timingByUrl, document.body);
            changed = true;
          }
          if (changed) commitSources();
        })
      : null;
  const configureLiveObservers = () => {
    observer.disconnect();
    resourceObserver?.disconnect();
    if (ctx.panelOptions.live === false) return;
    const attributeFilter = ["src", "srcset", "style", "href"];
    if (ctx.panelOptions.includeBackgrounds !== false) attributeFilter.push("class", "id");
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter,
    });
    try {
      resourceObserver?.observe({ type: "resource", buffered: true });
    } catch {
      try {
        resourceObserver?.observe({ entryTypes: ["resource"] });
      } catch {
        // Some older engines expose PerformanceObserver without resource entries.
      }
    }
  };

  ctx.refreshSources = refreshSources;
  ctx.configureLiveObservers = configureLiveObservers;
  ctx.resyncResourceTiming = () =>
    resourceTimingByUrl().forEach((entry, url) => timingByUrl.set(url, entry));
  ctx.cleanupTasks.push(() => {
    observer.disconnect();
    resourceObserver?.disconnect();
    window.clearTimeout(refreshTimer);
    window.clearTimeout(refreshMaxWaitTimer);
    cancelBackgroundScan();
    window.removeEventListener("resize", scheduleResponsiveRefresh);
    window.visualViewport?.removeEventListener("resize", scheduleResponsiveRefresh);
  });
};

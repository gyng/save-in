import {
  collectBackgroundSourceCandidates,
  collectPageSourceCandidates,
  compactPageSourceCandidates,
  createPageSourceCandidateCollection,
  collectResourceHintSources,
  createPageSourcePayloadBudget,
  isPerformanceResourceTiming,
  iterateBackgroundElements,
  mergeResourceTimings,
  mergePageSourcesByUrl,
  resourceTimingByUrl,
  type PageSource,
  type PageSourceCandidate,
} from "./source-panel-model.ts";
import { PANEL_HOST_ID, cleanupPanelHost, panelOpenChanges } from "./source-panel-host.ts";
import type { SourcePanelContext } from "./source-panel-context.ts";

// Coalesce a burst of page mutations, but never postpone discovery past the
// max wait, however long the page keeps mutating.
const REFRESH_DEBOUNCE_MS = 200;
const REFRESH_MAX_WAIT_MS = 1000;
const INCREMENTAL_ROOT_LIMIT = 64;
const RESOURCE_RENDER_INTERVAL_MS = 100;

/** Source discovery: the initial scan, incremental DOM-mutation
 * reconciliation, background-element scanning, and resource-timing driven
 * byte-size updates. Owns ctx.allSources and the observers that keep it
 * live. */
export const wirePanelRefresh = (ctx: SourcePanelContext): void => {
  const { host } = ctx;
  const timingByUrl = resourceTimingByUrl();
  let detectionSequence = 0;
  let sourceCandidates: PageSourceCandidate[] = [];
  let backgroundCandidates: PageSourceCandidate[] = [];
  let resourceHintSources: PageSourceCandidate[] = [];
  let sourcesByUrl = new Map<string, PageSource>();
  const firstSeen = new Map<string, { at: number; order: number }>();
  const commitSources = () => {
    const candidates = [sourceCandidates, backgroundCandidates, resourceHintSources].flat();
    // A candidate that becomes the representative only after its duplicate is
    // removed still needs metadata observed since it was first collected.
    candidates.forEach((source) => {
      const timing = timingByUrl.get(source.url);
      if (timing) source.bytes = timing.encodedBodySize || timing.transferSize || undefined;
    });
    ctx.allSources = mergePageSourcesByUrl(candidates);
    sourcesByUrl = new Map(ctx.allSources.map((source) => [source.url, source]));
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
      const detection = firstSeen.get(source.url) as { at: number; order: number };
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
  const scheduleBackgroundRefresh = (
    payloadBudget = createPageSourcePayloadBudget(sourceCandidates),
  ) => {
    cancelBackgroundScan();
    if (ctx.panelOptions.includeBackgrounds === false) {
      backgroundCandidates = [];
      return;
    }
    const generation = backgroundScanGeneration;
    backgroundScanActive = true;
    const elements = iterateBackgroundElements(document);
    const nextBackgroundCandidates = createPageSourceCandidateCollection();
    const runChunk = (deadline?: IdleDeadline) => {
      backgroundScanHandle = 0;
      let processed = 0;
      for (;;) {
        const next = elements.next();
        if (next.done) {
          if (generation !== backgroundScanGeneration) return;
          backgroundScanActive = false;
          backgroundCandidates = nextBackgroundCandidates.values;
          commitSources();
          return;
        }
        const element = next.value;
        if (element !== host && element.isConnected)
          nextBackgroundCandidates.addAll(
            collectBackgroundSourceCandidates([element], timingByUrl, payloadBudget),
          );
        processed += 1;
        if (processed >= 50 && (!deadline || deadline.timeRemaining() <= 1)) break;
      }
      if (generation !== backgroundScanGeneration) return;
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
    const payloadBudget = createPageSourcePayloadBudget();
    sourceCandidates = collectPageSourceCandidates(
      document,
      { ...ctx.panelOptions, includeBackgrounds: false, resourceHints: false },
      timingByUrl,
      payloadBudget,
    );
    resourceHintSources =
      ctx.panelOptions.resourceHints === false
        ? []
        : collectResourceHintSources(timingByUrl, document.body);
    scheduleBackgroundRefresh(payloadBudget);
    commitSources();
  };
  const removeSourcesUnder = (root: Element) => {
    const retainOutsideRoot = (sources: PageSourceCandidate[]): PageSourceCandidate[] =>
      sources.flatMap((source) => {
        const origins = source.collectorOriginElements;
        const retained = origins.filter((element) => element !== root && !root.contains(element));
        if (retained.length === origins.length) return [source];
        if (retained.length === 0) return [];
        source.collectorOriginElements = retained;
        if (!retained.includes(source.element)) {
          source.element = retained[0] as Element;
        }
        return [source];
      });
    sourceCandidates = retainOutsideRoot(sourceCandidates);
    backgroundCandidates = retainOutsideRoot(backgroundCandidates);
  };
  const reconcileRoot = (changedRoot: Element) => {
    const mediaOwner = changedRoot.matches("source") ? changedRoot.closest("video, audio") : null;
    const pictureOwner = changedRoot.matches("source")
      ? changedRoot.closest("picture")?.querySelector("img")
      : null;
    const root = mediaOwner || pictureOwner || changedRoot;
    removeSourcesUnder(root);
    const payloadBudget = createPageSourcePayloadBudget([
      ...sourceCandidates,
      ...backgroundCandidates,
      ...resourceHintSources,
    ]);
    sourceCandidates = compactPageSourceCandidates([
      ...sourceCandidates,
      ...collectPageSourceCandidates(
        root,
        { ...ctx.panelOptions, includeBackgrounds: false, resourceHints: false },
        timingByUrl,
        payloadBudget,
      ),
    ]);
    if (ctx.panelOptions.includeBackgrounds !== false) {
      if (backgroundScanActive) scheduleBackgroundRefresh();
      else
        backgroundCandidates = compactPageSourceCandidates([
          ...backgroundCandidates,
          ...collectBackgroundSourceCandidates(
            iterateBackgroundElements(root),
            timingByUrl,
            payloadBudget,
          ),
        ]);
    }
  };

  let refreshTimer = 0;
  let refreshMaxWaitTimer = 0;
  const pendingRoots = new Set<Element>();
  const removedRoots = new Set<Element>();
  let fullRefreshPending = false;
  const queueBoundedRoot = (roots: Set<Element>, root: Element) => {
    if (fullRefreshPending) return;
    for (const pending of roots) {
      if (pending === root || pending.contains(root)) return;
      if (root.contains(pending)) roots.delete(pending);
    }
    // Each incremental reconciliation filters the complete candidate arrays.
    // Past this point one full scan is cheaper than a large burst multiplied
    // by a large source list, and it avoids retaining every changed subtree
    // until the debounce flushes.
    if (roots.size >= INCREMENTAL_ROOT_LIMIT) {
      fullRefreshPending = true;
      pendingRoots.clear();
      removedRoots.clear();
      return;
    }
    roots.add(root);
  };
  const queueRoot = (root: Element) => queueBoundedRoot(pendingRoots, root);
  const queueRemovedRoot = (root: Element) => queueBoundedRoot(removedRoots, root);
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
  const hasOversizedElementBatch = (mutation: MutationRecord): boolean => {
    let elements = 0;
    for (const nodes of [mutation.addedNodes, mutation.removedNodes]) {
      for (const node of nodes) {
        if (node instanceof Element && ++elements > INCREMENTAL_ROOT_LIMIT) return true;
      }
    }
    return false;
  };
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
      if (fullRefreshPending) return;
      if (mutation.type === "childList" && hasOversizedElementBatch(mutation)) {
        fullRefreshPending = true;
        pendingRoots.clear();
        removedRoots.clear();
        return;
      }
      const target = mutation.target instanceof Element ? mutation.target : null;
      const stylesheetRelationshipChanged =
        mutation.type === "attributes" &&
        mutation.attributeName === "rel" &&
        target?.matches("link") === true;
      const affectsStylesheet =
        ctx.panelOptions.includeBackgrounds !== false &&
        (stylesheetRelationshipChanged ||
          Boolean(target?.closest("style")) ||
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
        if (node instanceof Element) queueRemovedRoot(node);
      });
      mutation.addedNodes.forEach((node) => {
        if (node instanceof Element) queueRoot(node);
      });
      if (target?.matches("video, audio, picture")) queueRoot(target);
    });
    scheduleRefresh();
  });
  let resourceRefreshTimer = 0;
  let resourceHintsRefreshPending = false;
  const cancelResourceRefresh = () => {
    window.clearTimeout(resourceRefreshTimer);
    resourceRefreshTimer = 0;
    resourceHintsRefreshPending = false;
  };
  const scheduleResourceRefresh = (refreshResourceHints: boolean) => {
    resourceHintsRefreshPending ||= refreshResourceHints;
    if (resourceRefreshTimer) return;
    resourceRefreshTimer = window.setTimeout(() => {
      resourceRefreshTimer = 0;
      if (resourceHintsRefreshPending) {
        resourceHintsRefreshPending = false;
        resourceHintSources = collectResourceHintSources(timingByUrl, document.body);
        commitSources();
      } else {
        ctx.render();
      }
    }, RESOURCE_RENDER_INTERVAL_MS);
  };
  const resourceObserver =
    typeof PerformanceObserver === "function"
      ? new PerformanceObserver((entries) => {
          const observed = entries.getEntries().filter(isPerformanceResourceTiming);
          mergeResourceTimings(timingByUrl, observed);
          let changed = false;
          observed.forEach((timing) => {
            const source = sourcesByUrl.get(timing.name);
            if (!source) return;
            const bytes = timing?.encodedBodySize || timing?.transferSize || undefined;
            if (source.bytes === bytes) return;
            source.bytes = bytes;
            changed = true;
            ctx.rowCache.get(timing.name)?.updateBytes(bytes);
          });
          const resourceHintsChanged =
            ctx.panelOptions.resourceHints !== false &&
            observed.some(({ name }) => /\.(?:m3u8|mpd)(?:$|[?#])/i.test(name));
          // Visible byte labels were patched above, and future rows read the
          // updated source object. Only size sorting or a newly discovered
          // manifest needs whole-list work; coalesce that work to at most 10 Hz.
          if (resourceHintsChanged || (changed && ctx.sort.value === "size-desc")) {
            scheduleResourceRefresh(resourceHintsChanged);
          }
        })
      : null;
  const configureLiveObservers = () => {
    observer.disconnect();
    resourceObserver?.disconnect();
    cancelResourceRefresh();
    if (ctx.panelOptions.live === false) return;
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      // Computed backgrounds can depend on any attribute selector. Keep the
      // narrow media/link filter only when background discovery is disabled;
      // the bounded reconciliation queue contains noisy pages while the panel
      // is open.
      ...(ctx.panelOptions.includeBackgrounds === false
        ? { attributeFilter: ["src", "srcset", "style", "href"] }
        : {}),
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
    mergeResourceTimings(timingByUrl, resourceTimingByUrl().values());
  ctx.cleanupTasks.push(() => {
    observer.disconnect();
    resourceObserver?.disconnect();
    window.clearTimeout(refreshTimer);
    window.clearTimeout(refreshMaxWaitTimer);
    cancelResourceRefresh();
    cancelBackgroundScan();
    window.removeEventListener("resize", scheduleResponsiveRefresh);
    window.visualViewport?.removeEventListener("resize", scheduleResponsiveRefresh);
  });
};

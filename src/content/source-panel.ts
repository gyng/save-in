import {
  collectBackgroundElements,
  collectBackgroundSourceCandidates,
  collectPageSourceCandidates,
  collectResourceHintSources,
  createSourceTooltip,
  filterPageSources,
  isSourceSort,
  positionDraggedSourcePanel,
  positionSourceTooltip,
  sortPageSources,
  resourceTimingByUrl,
  isPerformanceResourceTiming,
  type PageSource,
  type PageSourceKind,
  type SourcePanelOptions,
  type SourceSort,
} from "./source-panel-model.ts";
import {
  DEFAULT_SOURCE_PANEL_COPY,
  SOURCE_PANEL_COPY_URL_SLOT,
  SOURCE_PANEL_COPY_VALUE_SLOT,
  formatSourcePanelCopy,
} from "../shared/source-panel-copy.ts";
import { SOURCE_PANEL_SORT_STORAGE_KEY } from "../shared/storage-keys.ts";
import SOURCE_PANEL_TOKENS_CSS from "./source-panel-tokens.css";
import SOURCE_PANEL_CSS from "./source-panel.css";
import SOURCE_PANEL_PREVIEW_CSS from "./source-panel-preview.css";

declare const SAVE_IN_CONTENT_E2E: boolean;

export {
  collectPageSources,
  collectPageSourceCandidates,
  collectResourceHintSources,
  createSourceTooltip,
  filterPageSources,
  sortPageSources,
  resourceTimingByUrl,
  urlsFromSrcset,
  type PageSource,
  type PageSourceKind,
  type SourcePanelOptions,
  type SourceSort,
} from "./source-panel-model.ts";
export { formatSourceBytes } from "./source-panel-model.ts";

const PANEL_HOST_ID = "save-in-source-panel";
const panelCleanups = new WeakMap<Element, () => void>();
const panelCloseTimers = new WeakMap<Element, number>();
const panelPreviousFocus = new WeakMap<Element, HTMLElement>();
const panelRoots = new WeakMap<HTMLElement, ShadowRoot>();
const panelOpenChanges = new WeakMap<HTMLElement, (open: boolean) => void>();
const panelUpdates = new WeakMap<
  HTMLElement,
  (sendDownload: (source: PageSource) => void, options: SourcePanelOptions) => void
>();
let activePanelHost: HTMLElement | null = null;

const loadSourceSort = (apply: (sort: SourceSort) => void) => {
  try {
    chrome.storage.local.get(SOURCE_PANEL_SORT_STORAGE_KEY, (stored) => {
      void chrome.runtime.lastError;
      const sort = stored[SOURCE_PANEL_SORT_STORAGE_KEY];
      if (isSourceSort(sort)) apply(sort);
    });
  } catch {
    // The extension may be reloaded while this content script remains alive.
  }
};

const saveSourceSort = (sort: SourceSort) => {
  try {
    chrome.storage.local.set({ [SOURCE_PANEL_SORT_STORAGE_KEY]: sort }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // The extension may be reloaded while this content script remains alive.
  }
};

export const getSourcePanelHostForTesting = (): HTMLElement | null => activePanelHost;

const cleanupPanelHost = (host: HTMLElement) => {
  panelCleanups.get(host)?.();
  panelCleanups.delete(host);
  panelPreviousFocus.delete(host);
  panelRoots.delete(host);
  panelOpenChanges.delete(host);
  panelUpdates.delete(host);
  if (activePanelHost === host) activePanelHost = null;
};

const cancelPanelRemoval = (host: Element) => {
  const timer = panelCloseTimers.get(host);
  if (timer !== undefined) window.clearTimeout(timer);
  panelCloseTimers.delete(host);
};

const schedulePanelRemoval = (host: HTMLElement) => {
  cancelPanelRemoval(host);
  panelCloseTimers.set(
    host,
    window.setTimeout(() => {
      panelCloseTimers.delete(host);
      cleanupPanelHost(host);
      host.remove();
    }, 90),
  );
};

const closePanelHost = (host: HTMLElement): false => {
  if (host.classList.contains("closing")) return false;
  panelPreviousFocus.get(host)?.focus();
  host.classList.add("closing");
  schedulePanelRemoval(host);
  panelOpenChanges.get(host)?.(false);
  return false;
};
const ICON_PATHS = {
  copy: ["M8 8h10v10H8z", "M5 15H3V3h12v2"],
  dock: ["M3 4h18v16H3z", "M15 4v16"],
  popout: ["M13 4h7v7", "M20 4 10 14", "M17 13v7H4V7h7"],
  close: ["m6 6 12 12", "m18 6-12 12"],
  check: ["m5 12 4 4L19 6"],
  error: ["M12 8v5", "M12 17h.01", "M4 20h16L12 4z"],
} as const;

const SOURCE_KIND_ICON_PATHS: Record<PageSourceKind, readonly string[]> = {
  image: ["M3 5h18v14H3z", "m3 11 4-4 4 4 3-3 5 5", "M8 9h.01"],
  video: ["M4 6h12v12H4z", "M16 9l4-3v12l-4-3z"],
  audio: [
    "M9 18V6l10-2v12",
    "M9 10l10-2",
    "M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
    "M16 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
  ],
  stream: [
    "M12 12h.01",
    "M8.5 8.5a5 5 0 0 0 0 7",
    "M15.5 8.5a5 5 0 0 1 0 7",
    "M5 5a10 10 0 0 0 0 14",
    "M19 5a10 10 0 0 1 0 14",
  ],
  document: ["M6 3h8l4 4v14H6z", "M14 3v5h5", "M9 12h6", "M9 16h6"],
  link: [
    "M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1",
    "M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1",
  ],
};

const setButtonIcon = (button: HTMLButtonElement, icon: keyof typeof ICON_PATHS) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  ICON_PATHS[icon].forEach((pathData) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    svg.append(path);
  });
  button.replaceChildren(svg);
};

const createSourceKindIcon = (kind: PageSourceKind): SVGSVGElement => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("kind-icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  SOURCE_KIND_ICON_PATHS[kind].forEach((pathData) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    svg.append(path);
  });
  return svg;
};

const resolvedPanelTheme = (theme: SourcePanelOptions["theme"]): "system" | "dark" | "light" =>
  theme === "dark" || theme === "light" ? theme : "system";

const panelLocale = (locale?: string): string | undefined => {
  if (!locale) return undefined;
  if (locale.endsWith("_AI")) return locale.slice(0, -3);
  return locale.replace("_", "-");
};

const panelFormatters = new Map<string, { date: Intl.DateTimeFormat; number: Intl.NumberFormat }>();
const getPanelFormatters = (locale?: string) => {
  const key = panelLocale(locale) || "default";
  const cached = panelFormatters.get(key);
  if (cached) return cached;
  let formatters: { date: Intl.DateTimeFormat; number: Intl.NumberFormat };
  try {
    formatters = {
      date: new Intl.DateTimeFormat(key === "default" ? undefined : key, { timeStyle: "short" }),
      number: new Intl.NumberFormat(key === "default" ? undefined : key, {
        maximumFractionDigits: 1,
      }),
    };
  } catch {
    formatters = {
      date: new Intl.DateTimeFormat(undefined, { timeStyle: "short" }),
      number: new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }),
    };
  }
  panelFormatters.set(key, formatters);
  return formatters;
};

export const toggleSourcePanel = (
  sendDownload: (source: PageSource) => void,
  options: SourcePanelOptions = {},
): boolean => {
  if (activePanelHost && !activePanelHost.isConnected) cleanupPanelHost(activePanelHost);
  const existing = activePanelHost;
  if (existing) {
    if (existing.classList.contains("closing")) {
      cancelPanelRemoval(existing);
      existing.classList.remove("closing");
      panelOpenChanges.get(existing)?.(true);
      panelRoots.get(existing)?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
      return true;
    }
    return closePanelHost(existing);
  }
  if (options.enabled === false) return false;
  let panelOptions = { ...options };
  let copy = panelOptions.copy || DEFAULT_SOURCE_PANEL_COPY;
  let formatters = getPanelFormatters(panelOptions.locale);
  let panelSendDownload = sendDownload;

  const host = document.createElement("aside");
  const previousFocus = document.activeElement;
  if (previousFocus instanceof HTMLElement) panelPreviousFocus.set(host, previousFocus);
  host.id = PANEL_HOST_ID;
  host.dataset.theme = resolvedPanelTheme(panelOptions.theme);
  const exposeShadowForTests = SAVE_IN_CONTENT_E2E === true;
  const shadow = host.attachShadow({ mode: exposeShadowForTests ? "open" : "closed" });
  panelRoots.set(host, shadow);
  panelOpenChanges.set(host, panelOptions.onOpenChange || (() => {}));
  activePanelHost = host;
  const style = document.createElement("style");
  style.textContent = [SOURCE_PANEL_TOKENS_CSS, SOURCE_PANEL_CSS, SOURCE_PANEL_PREVIEW_CSS].join(
    "\n",
  );
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", copy.title);
  const docks = ["right", "bottom", "left", "top"] as const;
  const currentDock = (): (typeof docks)[number] =>
    /* v8 ignore next -- The host dock is written exclusively from this fixed list. */
    docks.find((candidate) => candidate === host.dataset.dock) ?? "right";
  const resize = document.createElement("div");
  resize.className = "resize";
  resize.setAttribute("role", "separator");
  resize.setAttribute("aria-label", copy.resizeLabel);
  resize.addEventListener("pointerdown", (event) => {
    resize.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = host.getBoundingClientRect().width;
    const startHeight = host.getBoundingClientRect().height;
    const move = (moveEvent: PointerEvent) => {
      const dock = currentDock();
      if (dock === "right" || dock === "left") {
        const delta = dock === "right" ? startX - moveEvent.clientX : moveEvent.clientX - startX;
        host.style.width = `${Math.min(window.innerWidth * 0.92, Math.max(280, startWidth + delta))}px`;
      } else {
        const delta = dock === "bottom" ? startY - moveEvent.clientY : moveEvent.clientY - startY;
        host.style.height = `${Math.min(window.innerHeight * 0.85, Math.max(220, startHeight + delta))}px`;
      }
    };
    resize.addEventListener("pointermove", move);
    resize.addEventListener("pointerup", () => resize.removeEventListener("pointermove", move), {
      once: true,
    });
  });
  const header = document.createElement("header");
  const title = document.createElement("h2");
  const close = document.createElement("button");
  const dockButton = document.createElement("button");
  const popoutButton = document.createElement("button");
  title.textContent = copy.title;
  close.className = "header-button close";
  setButtonIcon(close, "close");
  close.title = copy.close;
  close.setAttribute("aria-label", copy.closeLabel);
  let dockIndex = 0;
  const updateDock = () => {
    /* v8 ignore next -- dockIndex is initialized and advanced modulo docks.length. */
    const dock = docks[dockIndex] ?? "right";
    host.dataset.dock = dock;
    host.classList.remove("dock-left", "dock-bottom", "dock-top");
    if (dock !== "right") host.classList.add(`dock-${dock}`);
    host.style.left = "";
    host.style.top = "";
    host.style.width = "";
    host.style.height = "";
    dockButton.title = formatSourcePanelCopy(
      copy.dockPositionTemplate,
      SOURCE_PANEL_COPY_VALUE_SLOT,
      copy.dockPositions[dock],
    );
  };
  dockButton.className = "header-button dock";
  setButtonIcon(dockButton, "dock");
  dockButton.setAttribute("aria-label", copy.changeDockLabel);
  const updatePopoutButton = (floating: boolean) => {
    popoutButton.setAttribute("aria-pressed", String(floating));
    popoutButton.setAttribute("aria-label", floating ? copy.dockPanel : copy.popOutPanel);
    popoutButton.title = floating ? copy.dockPanel : copy.popOutHelp;
  };
  dockButton.addEventListener("click", () => {
    host.classList.remove("floating");
    updatePopoutButton(false);
    dockIndex = (dockIndex + 1) % docks.length;
    updateDock();
  });
  popoutButton.className = "header-button popout";
  setButtonIcon(popoutButton, "popout");
  updatePopoutButton(false);
  popoutButton.addEventListener("click", () => {
    const floating = host.classList.toggle("floating");
    updatePopoutButton(floating);
    if (floating) {
      host.classList.remove("dock-left", "dock-bottom", "dock-top");
      host.style.width = "";
      host.style.height = "";
    } else {
      host.style.left = "";
      host.style.top = "";
      updateDock();
    }
  });
  updateDock();
  const closePanel = () => {
    closePanelHost(host);
  };
  close.addEventListener("click", closePanel);
  const headerActions = document.createElement("div");
  headerActions.className = "header-actions";
  const copyUrls = document.createElement("button");
  copyUrls.className = "header-button copy-urls";
  setButtonIcon(copyUrls, "copy");
  copyUrls.title = copy.copyFilteredUrls;
  copyUrls.setAttribute("aria-label", copy.copyFilteredUrlsLabel);
  headerActions.append(copyUrls, dockButton, popoutButton, close);
  header.append(title, headerActions);
  header.addEventListener("pointerdown", (event) => {
    if (!host.classList.contains("floating") || event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("button")) return;
    header.setPointerCapture?.(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const rect = host.getBoundingClientRect();
    const move = (moveEvent: PointerEvent) => {
      const { left, top } = positionDraggedSourcePanel(
        rect,
        { x: startX, y: startY },
        { x: moveEvent.clientX, y: moveEvent.clientY },
        { width: window.innerWidth, height: window.innerHeight },
      );
      host.style.left = `${left}px`;
      host.style.top = `${top}px`;
    };
    header.addEventListener("pointermove", move);
    header.addEventListener("pointerup", () => header.removeEventListener("pointermove", move), {
      once: true,
    });
  });
  const list = document.createElement("div");
  list.className = "list";
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";
  const filter = document.createElement("input");
  filter.type = "search";
  filter.placeholder = copy.filterSources;
  filter.setAttribute("aria-label", copy.filterLabel);
  const sort = document.createElement("select");
  sort.setAttribute("aria-label", copy.sortLabel);
  const sortOptions: ReadonlyArray<readonly [SourceSort, keyof typeof copy.sort]> = [
    ["relevance", "relevance"],
    ["detected-desc", "newest"],
    ["detected-asc", "oldest"],
    ["size-desc", "largest"],
    ["name-asc", "name"],
  ];
  sortOptions.forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = copy.sort[label];
    sort.append(option);
  });
  sort.value = "relevance";
  const applyStaticCopy = () => {
    panel.setAttribute("aria-label", copy.title);
    title.textContent = copy.title;
    resize.setAttribute("aria-label", copy.resizeLabel);
    close.title = copy.close;
    close.setAttribute("aria-label", copy.closeLabel);
    dockButton.setAttribute("aria-label", copy.changeDockLabel);
    copyUrls.setAttribute("aria-label", copy.copyFilteredUrlsLabel);
    copyUrls.title = copy.copyFilteredUrls;
    filter.placeholder = copy.filterSources;
    filter.setAttribute("aria-label", copy.filterLabel);
    sort.setAttribute("aria-label", copy.sortLabel);
    [...sort.options].forEach((option, index) => {
      const entry = sortOptions[index];
      /* v8 ignore next -- Options are created one-for-one from sortOptions. */
      if (entry) option.textContent = copy.sort[entry[1]];
    });
    const dock = currentDock();
    dockButton.title = formatSourcePanelCopy(
      copy.dockPositionTemplate,
      SOURCE_PANEL_COPY_VALUE_SLOT,
      copy.dockPositions[dock],
    );
    updatePopoutButton(host.classList.contains("floating"));
  };
  toolbar.append(filter, sort);
  const facets = document.createElement("div");
  facets.className = "facets";
  let activeKind: "all" | PageSourceKind = "all";
  const firstSeen = new Map<string, { at: number; order: number }>();
  const highlightedElements = new WeakSet<Element>();
  const highlightStates = new WeakMap<HTMLElement, { outline: string; owners: Set<object> }>();
  const acquireHighlight = (target: HTMLElement, owner: object) => {
    let state = highlightStates.get(target);
    if (!state) {
      state = { outline: target.style.outline, owners: new Set() };
      highlightStates.set(target, state);
    }
    state.owners.add(owner);
    highlightedElements.add(target);
    target.style.outline = "3px solid #0a84ff";
  };
  const releaseHighlight = (target: HTMLElement, owner: object) => {
    const state = highlightStates.get(target);
    if (!state) return;
    state.owners.delete(owner);
    if (state.owners.size > 0) return;
    target.style.outline = state.outline;
    highlightStates.delete(target);
    window.setTimeout(() => highlightedElements.delete(target));
  };
  const timingByUrl = resourceTimingByUrl();
  let detectionSequence = 0;
  let sourceCandidates: PageSource[] = [];
  let backgroundCandidates: PageSource[] = [];
  let allSources: PageSource[] = [];
  let visibleSources: PageSource[] = [];
  let resourceHintSources: PageSource[] = [];
  type CachedRow = {
    source: PageSource;
    row: HTMLElement;
    deactivate: () => void;
    updateBytes: (bytes: number | undefined) => void;
  };
  const rowCache = new Map<string, CachedRow>();
  const cachedRows = new WeakMap<HTMLElement, CachedRow>();
  const deactivateAndRemove = ({ row, deactivate }: CachedRow) => {
    deactivate();
    row.remove();
  };
  const pendingPreviewSources = new WeakMap<Element, string>();
  const previewObserver =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver(
          (entries, observer) => {
            entries.forEach((entry) => {
              if (
                !entry.isIntersecting ||
                (!(entry.target instanceof HTMLImageElement) &&
                  !(entry.target instanceof HTMLMediaElement))
              )
                return;
              const source = pendingPreviewSources.get(entry.target);
              if (source === undefined) {
                observer.unobserve(entry.target);
                return;
              }
              entry.target.src = source;
              pendingPreviewSources.delete(entry.target);
              observer.unobserve(entry.target);
            });
          },
          { root: list, rootMargin: "200px" },
        )
      : null;
  const queuePreview = (preview: HTMLImageElement | HTMLMediaElement, source: string) => {
    if (!previewObserver) {
      preview.src = source;
      return;
    }
    pendingPreviewSources.set(preview, source);
    previewObserver.observe(preview);
  };
  const commitSources = () => {
    const seen = new Set<string>();
    allSources = [sourceCandidates, backgroundCandidates, resourceHintSources]
      .flat()
      .filter(({ url }) => !seen.has(url) && Boolean(seen.add(url)));
    const presentUrls = new Set(allSources.map(({ url }) => url));
    firstSeen.forEach((_value, url) => {
      if (!presentUrls.has(url)) firstSeen.delete(url);
    });
    allSources.forEach((source) => {
      if (!firstSeen.has(source.url)) {
        firstSeen.set(source.url, { at: Date.now(), order: ++detectionSequence });
      }
      const detection = firstSeen.get(source.url);
      /* v8 ignore next -- The immediately preceding block initializes every absent URL. */
      if (!detection) return;
      source.detectedAt = detection.at;
      source.detectedOrder = detection.order;
    });
    render();
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
    if (panelOptions.includeBackgrounds === false) {
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
      { ...panelOptions, includeBackgrounds: false, resourceHints: false },
      timingByUrl,
    );
    resourceHintSources =
      panelOptions.resourceHints === false
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
        { ...panelOptions, includeBackgrounds: false, resourceHints: false },
        timingByUrl,
      ),
    );
    if (panelOptions.includeBackgrounds !== false) {
      if (backgroundScanActive) scheduleBackgroundRefresh();
      else
        backgroundCandidates.push(
          ...collectBackgroundSourceCandidates(collectBackgroundElements(root), timingByUrl),
        );
    }
  };
  const render = () => {
    previewObserver?.disconnect();
    const sourceSort = isSourceSort(sort.value) ? sort.value : "relevance";
    const sources = sortPageSources(
      filterPageSources(allSources, filter.value, activeKind),
      sourceSort,
    );
    visibleSources = sources;
    title.textContent = copy.title;
    facets.replaceChildren();
    const presentUrls = new Set(allSources.map(({ url }) => url));
    rowCache.forEach((cached, url) => {
      if (presentUrls.has(url)) return;
      deactivateAndRemove(cached);
      rowCache.delete(url);
    });
    const searchedSources = filterPageSources(allSources, filter.value, "all");
    (["all", "image", "video", "audio", "document", "stream", "link"] as const).forEach(
      (kindName) => {
        const count =
          kindName === "all"
            ? searchedSources.length
            : searchedSources.filter(({ kind }) => kind === kindName).length;
        const facet = document.createElement("button");
        facet.className = "facet";
        const label = copy.kinds[kindName];
        const facetCount = document.createElement("span");
        facetCount.className = "facet-count";
        facetCount.textContent = String(count);
        facet.append(document.createTextNode(label), facetCount);
        facet.setAttribute("aria-pressed", String(activeKind === kindName));
        facet.addEventListener("click", () => {
          activeKind = kindName;
          render();
        });
        facets.append(facet);
      },
    );
    if (!sources.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = allSources.length ? copy.noMatches : copy.noSources;
      rowCache.forEach((cached) => {
        if (cached.row.isConnected) deactivateAndRemove(cached);
      });
      list.replaceChildren(empty);
      copyUrls.disabled = true;
      return;
    }
    copyUrls.disabled = false;
    list.querySelectorAll(".empty").forEach((empty) => empty.remove());
    let rowIndex = 0;
    const placeRow = (row: HTMLElement) => {
      const current = list.children[rowIndex] || null;
      if (current !== row) list.insertBefore(row, current);
      rowIndex += 1;
    };
    sources.forEach((source) => {
      const cached = rowCache.get(source.url);
      if (
        cached &&
        cached.source.kind === source.kind &&
        cached.source.element === source.element &&
        cached.source.previewable === source.previewable
      ) {
        if (cached.source.bytes !== source.bytes) cached.updateBytes(source.bytes);
        cached.source = source;
        const preview = cached.row.querySelector<HTMLImageElement | HTMLMediaElement>("img, video");
        if (previewObserver && preview && !preview.hasAttribute("src")) {
          previewObserver.observe(preview);
        }
        placeRow(cached.row);
        return;
      }
      if (cached) deactivateAndRemove(cached);
      const row = document.createElement("div");
      row.className = "row";
      row.dataset.kind = source.kind;
      const preview =
        panelOptions.previews === false ||
        source.previewable === false ||
        !["image", "video"].includes(source.kind)
          ? document.createElement("div")
          : document.createElement(source.kind === "image" ? "img" : "video");
      if (preview instanceof HTMLImageElement) {
        preview.loading = "lazy";
        queuePreview(preview, source.url);
      } else if (preview instanceof HTMLVideoElement) {
        preview.preload = "metadata";
        preview.muted = true;
        queuePreview(preview, source.url);
      } else {
        preview.className = "audio";
        preview.textContent =
          source.kind === "stream"
            ? "≋"
            : source.kind === "document"
              ? "PDF"
              : source.kind === "link"
                ? "↗"
                : panelOptions.previews === false
                  ? source.kind === "image"
                    ? "▧"
                    : "▶"
                  : source.kind === "audio"
                    ? "♪"
                    : "•";
      }
      const sourceLink = document.createElement("a");
      const hasRichTooltip = ["image", "video", "audio"].includes(source.kind);
      sourceLink.className = "source-link";
      sourceLink.href = source.url;
      sourceLink.target = "_blank";
      sourceLink.setAttribute(
        "aria-label",
        formatSourcePanelCopy(
          copy.sourceInstructionsTemplate,
          SOURCE_PANEL_COPY_URL_SLOT,
          source.url,
        ),
      );
      if (!hasRichTooltip)
        sourceLink.title = formatSourcePanelCopy(
          copy.sourceInstructionsTemplate,
          SOURCE_PANEL_COPY_URL_SLOT,
          source.url,
        );
      const text = document.createElement("div");
      text.className = "source-text";
      const name = document.createElement("span");
      const url = document.createElement("div");
      const meta = document.createElement("div");
      name.className = "name";
      const parsed = new URL(source.url);
      name.textContent = decodeURIComponent(
        parsed.pathname.split("/").filter(Boolean).at(-1) || parsed.hostname,
      );
      url.className = "url";
      url.textContent = source.url;
      if (!hasRichTooltip) url.title = source.url;
      meta.className = "meta";
      const mediaDetails: string[] = [];
      let displayedBytes = source.bytes;
      const updateMeta = () => {
        const sourceBytes = displayedBytes || 0;
        const sourceSize = !sourceBytes
          ? copy.sizeUnknown
          : sourceBytes < 1024
            ? `${formatters.number.format(sourceBytes)} B`
            : sourceBytes < 1024 * 1024
              ? `${formatters.number.format(Math.round(sourceBytes / 1024))} KB`
              : `${formatters.number.format(sourceBytes / (1024 * 1024))} MB`;
        const kindBadge = document.createElement("span");
        kindBadge.className = "kind-badge";
        const kindLabel = document.createElement("span");
        kindLabel.className = "kind-label";
        kindLabel.textContent = copy.kinds[source.kind];
        kindBadge.append(createSourceKindIcon(source.kind), kindLabel);
        const detailText = document.createElement("span");
        detailText.className = "meta-details";
        const size = document.createElement("span");
        size.className = "source-size";
        size.dataset.sizeWeight =
          sourceBytes >= 10 * 1024 * 1024
            ? "bold"
            : sourceBytes >= 1024 * 1024
              ? "medium"
              : "regular";
        size.textContent = sourceSize;
        detailText.append(
          document.createTextNode("· "),
          size,
          document.createTextNode(
            `${mediaDetails.length ? ` · ${mediaDetails.join(" · ")}` : ""} ·`,
          ),
        );
        const detected = document.createElement("span");
        detected.className = "detected";
        detected.textContent = `#${source.detectedOrder}`;
        const detectedAt = formatSourcePanelCopy(
          copy.detectedAtTemplate,
          SOURCE_PANEL_COPY_VALUE_SLOT,
          /* v8 ignore next -- commitSources stamps every rendered source. */
          formatters.date.format(new Date(source.detectedAt ?? Date.now())),
        );
        detected.setAttribute("aria-label", detectedAt);
        if (!hasRichTooltip) detected.title = detectedAt;
        meta.replaceChildren(kindBadge, detailText, detected);
      };
      const updateBytes = (bytes: number | undefined) => {
        displayedBytes = bytes;
        updateMeta();
      };
      if (preview instanceof HTMLImageElement) {
        preview.addEventListener(
          "error",
          () => {
            const fallback = document.createElement("div");
            fallback.className = "preview-fallback";
            fallback.textContent = "▧";
            fallback.setAttribute("aria-label", copy.previewUnavailable);
            preview.replaceWith(fallback);
          },
          { once: true },
        );
        preview.addEventListener("load", () => {
          mediaDetails.splice(
            0,
            mediaDetails.length,
            `${preview.naturalWidth}×${preview.naturalHeight}`,
          );
          updateMeta();
        });
      } else if (preview instanceof HTMLVideoElement) {
        preview.addEventListener("loadedmetadata", () => {
          const duration = Number.isFinite(preview.duration)
            ? `${Math.round(preview.duration)}s`
            : "";
          const dimensions = preview.videoWidth
            ? `${preview.videoWidth}×${preview.videoHeight}`
            : "";
          mediaDetails.splice(0, mediaDetails.length, ...[duration, dimensions].filter(Boolean));
          updateMeta();
        });
      }
      updateMeta();
      text.append(name, meta, url);
      sourceLink.append(preview, text);
      const actions = document.createElement("div");
      actions.className = "actions";
      const locate = document.createElement("button");
      const locateHighlightOwner = {};
      let locateHighlightTimer = 0;
      locate.textContent = copy.locate;
      locate.addEventListener("click", () => {
        source.element.scrollIntoView?.({ behavior: "smooth", block: "center" });
        if (source.element instanceof HTMLElement) {
          const target = source.element;
          window.clearTimeout(locateHighlightTimer);
          acquireHighlight(target, locateHighlightOwner);
          locateHighlightTimer = window.setTimeout(
            () => releaseHighlight(target, locateHighlightOwner),
            1600,
          );
        }
      });
      const save = document.createElement("button");
      save.textContent = source.kind === "stream" ? copy.savePlaylist : copy.save;
      save.addEventListener("pointerdown", (event) => {
        if (event.button === 0) panelOptions.onSaveIntent?.();
      });
      save.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") panelOptions.onSaveIntent?.();
      });
      save.addEventListener("click", () => panelSendDownload(source));
      actions.append(locate, save);
      if (source.kind === "stream" || source.kind === "video") {
        const copyCommand = document.createElement("button");
        copyCommand.textContent = copy.copyYtDlp;
        copyCommand.title = copy.copyYtDlpHelp;
        copyCommand.addEventListener("click", () => {
          void navigator.clipboard
            .writeText(source.url)
            .then(() => {
              copyCommand.textContent = copy.copied;
              window.setTimeout(() => (copyCommand.textContent = copy.copyYtDlp), 1200);
            })
            .catch(() => {
              copyCommand.textContent = copy.copyFailed;
            });
        });
        actions.append(copyCommand);
      }
      const previewHighlightOwner = {};
      const highlight = (active: boolean) => {
        if (!(source.element instanceof HTMLElement)) return;
        const target = source.element;
        if (active) {
          acquireHighlight(target, previewHighlightOwner);
          if (preview instanceof HTMLVideoElement) void preview.play().catch(() => {});
        } else {
          releaseHighlight(target, previewHighlightOwner);
          if (preview instanceof HTMLVideoElement) preview.pause();
        }
      };
      let richTooltip: HTMLElement | null = null;
      let tooltipResizeObserver: ResizeObserver | null = null;
      let hovered = false;
      let focused = false;
      let previewActive = false;
      const syncPreview = () => {
        const active = hovered || focused;
        if (active === previewActive) return;
        previewActive = active;
        highlight(active);
        if (!active) {
          tooltipResizeObserver?.disconnect();
          tooltipResizeObserver = null;
          richTooltip?.querySelector<HTMLMediaElement>("video, audio")?.pause();
          richTooltip?.remove();
          richTooltip = null;
          sourceLink.removeAttribute("aria-describedby");
          return;
        }
        if (!hasRichTooltip) return;
        richTooltip = createSourceTooltip(source);
        /* v8 ignore next -- Rich-tooltip eligibility and tooltip creation use the same kinds. */
        if (!richTooltip) return;
        const tooltipId = `source-tooltip-${source.detectedOrder}`;
        richTooltip.id = tooltipId;
        sourceLink.setAttribute("aria-describedby", tooltipId);
        shadow.append(richTooltip);
        const positionTooltip = () => {
          if (!richTooltip?.isConnected) return;
          const anchorBounds = row.getBoundingClientRect();
          const panelBounds = host.getBoundingClientRect();
          const tooltipBounds = richTooltip.getBoundingClientRect();
          const position = positionSourceTooltip(
            anchorBounds,
            panelBounds,
            tooltipBounds,
            { width: window.innerWidth, height: window.innerHeight },
            host.classList.contains("floating") ? "floating" : currentDock(),
          );
          richTooltip.dataset.side = position.side;
          richTooltip.style.left = `${position.left - panelBounds.left}px`;
          richTooltip.style.top = `${position.top - panelBounds.top}px`;
        };
        positionTooltip();
        if (typeof ResizeObserver === "function") {
          tooltipResizeObserver = new ResizeObserver(positionTooltip);
          tooltipResizeObserver.observe(richTooltip);
        }
        const positionAfterLayout = () => window.requestAnimationFrame(positionTooltip);
        const media = richTooltip.querySelector<HTMLMediaElement>("video, audio");
        if (media) {
          media.addEventListener("loadedmetadata", positionAfterLayout, { once: true });
          void media.play().catch(() => {});
        } else {
          richTooltip.querySelector("img")?.addEventListener("load", positionAfterLayout, {
            once: true,
          });
        }
      };
      row.addEventListener("mouseenter", () => {
        hovered = true;
        syncPreview();
      });
      row.addEventListener("mouseleave", () => {
        hovered = false;
        syncPreview();
      });
      row.addEventListener("focusin", () => {
        focused = true;
        syncPreview();
      });
      row.addEventListener("focusout", (event) => {
        if (event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) return;
        focused = false;
        syncPreview();
      });
      row.addEventListener("click", (event) => {
        if (
          !event.altKey ||
          event.button !== 0 ||
          (event.target instanceof Element && event.target.closest("button"))
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        panelSendDownload(source);
      });
      row.addEventListener("pointerdown", (event) => {
        if (
          event.altKey &&
          event.button === 0 &&
          !(event.target instanceof Element && event.target.closest("button"))
        ) {
          panelOptions.onSaveIntent?.();
        }
      });
      row.addEventListener("keydown", (event) => {
        if (
          event.altKey &&
          (event.key === "Enter" || event.key === " ") &&
          !(event.target instanceof Element && event.target.closest("button"))
        ) {
          panelOptions.onSaveIntent?.();
        }
      });
      if (!hasRichTooltip) row.title = copy.rowInstructions;
      row.append(sourceLink, actions);
      const deactivate = () => {
        hovered = false;
        focused = false;
        syncPreview();
        window.clearTimeout(locateHighlightTimer);
        if (source.element instanceof HTMLElement)
          releaseHighlight(source.element, locateHighlightOwner);
      };
      const cachedRow = { source, row, deactivate, updateBytes };
      rowCache.set(source.url, cachedRow);
      cachedRows.set(row, cachedRow);
      placeRow(row);
    });
    while (list.children.length > rowIndex) {
      const last = list.lastElementChild;
      /* v8 ignore next -- This renderer appends only HTML row elements to the list. */
      if (!(last instanceof HTMLElement)) {
        last?.remove();
        continue;
      }
      const cached = cachedRows.get(last);
      if (cached) deactivateAndRemove(cached);
      else last.remove();
    }
  };
  let filterTimer = 0;
  filter.addEventListener("input", () => {
    window.clearTimeout(filterTimer);
    filterTimer = window.setTimeout(render, 80);
  });
  let sortChanged = false;
  sort.addEventListener("change", () => {
    if (!isSourceSort(sort.value)) return;
    sortChanged = true;
    saveSourceSort(sort.value);
    render();
  });
  copyUrls.addEventListener("click", () => {
    void navigator.clipboard
      .writeText(visibleSources.map(({ url }) => url).join("\n"))
      .then(() => {
        setButtonIcon(copyUrls, "check");
        copyUrls.title = formatSourcePanelCopy(
          copy.copiedUrlsTemplate,
          SOURCE_PANEL_COPY_VALUE_SLOT,
          visibleSources.length,
        );
        window.setTimeout(() => {
          setButtonIcon(copyUrls, "copy");
          copyUrls.title = copy.copyFilteredUrls;
        }, 1200);
      })
      .catch(() => {
        setButtonIcon(copyUrls, "error");
        copyUrls.title = copy.copyFailed;
      });
  });
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePanel();
  });
  panel.append(resize, header, toolbar, facets, list);
  shadow.append(style, panel);
  document.documentElement.append(host);
  panelOptions.onOpenChange?.(true);
  let refreshTimer = 0;
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
  const scheduleRefresh = () => {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
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
    }, 200);
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
            (highlightedElements.has(target) || target.closest(`#${PANEL_HOST_ID}`) === host)),
      )
    )
      return;
    mutations.forEach((mutation) => {
      const target = mutation.target instanceof Element ? mutation.target : null;
      const affectsStylesheet =
        panelOptions.includeBackgrounds !== false &&
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
            panelOptions.resourceHints !== false &&
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
    if (panelOptions.live === false) return;
    const attributeFilter = ["src", "srcset", "style", "href"];
    if (panelOptions.includeBackgrounds !== false) attributeFilter.push("class", "id");
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
  panelCleanups.set(host, () => {
    observer.disconnect();
    resourceObserver?.disconnect();
    previewObserver?.disconnect();
    window.clearTimeout(filterTimer);
    window.clearTimeout(refreshTimer);
    cancelBackgroundScan();
    rowCache.forEach(({ deactivate }) => deactivate());
  });
  panelUpdates.set(host, (nextSendDownload, nextOptions) => {
    const previousOptions = panelOptions;
    panelOptions = { ...nextOptions };
    const nextCopy = panelOptions.copy || DEFAULT_SOURCE_PANEL_COPY;
    const copyChanged = nextCopy !== copy || panelOptions.locale !== previousOptions.locale;
    copy = nextCopy;
    formatters = getPanelFormatters(panelOptions.locale);
    host.dataset.theme = resolvedPanelTheme(panelOptions.theme);
    panelSendDownload = nextSendDownload;
    panelOpenChanges.set(host, panelOptions.onOpenChange || (() => {}));
    if (panelOptions.enabled === false) {
      closePanelHost(host);
      return;
    }
    const discoveryChanged = (
      ["includeBackgrounds", "resourceHints", "includeLinks"] as const
    ).some((key) => previousOptions[key] !== panelOptions[key]);
    const observerConfigChanged = previousOptions.live !== panelOptions.live || discoveryChanged;
    if (observerConfigChanged) configureLiveObservers();
    const previewsChanged = previousOptions.previews !== panelOptions.previews;
    if (previewsChanged || copyChanged) {
      rowCache.forEach((cached) => deactivateAndRemove(cached));
      rowCache.clear();
    }
    if (copyChanged) applyStaticCopy();
    const liveEnabled = previousOptions.live === false && panelOptions.live !== false;
    if (discoveryChanged || liveEnabled) {
      refreshSources();
      return;
    }
    if (previewsChanged || copyChanged) render();
  });
  configureLiveObservers();
  resourceTimingByUrl().forEach((entry, url) => timingByUrl.set(url, entry));
  refreshSources();
  loadSourceSort((storedSort) => {
    if (sortChanged || activePanelHost !== host) return;
    sort.value = storedSort;
    render();
  });
  filter.focus();
  return true;
};

export const replaceSourcePanel = (
  sendDownload: (source: PageSource) => void,
  options: SourcePanelOptions = {},
): boolean => {
  const existing = activePanelHost?.isConnected ? activePanelHost : null;
  if (!existing || existing.classList.contains("closing")) return false;
  panelUpdates.get(existing)?.(sendDownload, options);
  return !existing.classList.contains("closing");
};

export const setSourcePanelOpen = (
  open: boolean,
  sendDownload: (source: PageSource) => void,
  options: SourcePanelOptions = {},
): boolean => {
  const existing = activePanelHost?.isConnected ? activePanelHost : null;
  if (existing?.classList.contains("closing")) {
    return open ? toggleSourcePanel(sendDownload, options) : false;
  }
  if (open === Boolean(existing)) return open;
  return toggleSourcePanel(sendDownload, options);
};

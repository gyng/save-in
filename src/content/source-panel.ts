import {
  collectBackgroundElements,
  collectBackgroundSourceCandidates,
  collectPageSourceCandidates,
  collectResourceHintSources,
  createSourceTooltip,
  filterPageSources,
  isSourceSort,
  sortPageSources,
  resourceTimingByUrl,
  ytDlpCommand,
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
  ytDlpCommand,
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
  const previousFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (previousFocus) panelPreviousFocus.set(host, previousFocus);
  host.id = PANEL_HOST_ID;
  host.dataset.theme = resolvedPanelTheme(panelOptions.theme);
  const exposeShadowForTests = SAVE_IN_CONTENT_E2E === true;
  const shadow = host.attachShadow({ mode: exposeShadowForTests ? "open" : "closed" });
  panelRoots.set(host, shadow);
  panelOpenChanges.set(host, panelOptions.onOpenChange || (() => {}));
  activePanelHost = host;
  const style = document.createElement("style");
  style.textContent = `
    :host{--si-text:#1f2328;--si-panel-bg:#fff;--si-control-bg:#fff;--si-border:#b1b1b3;--si-subtle-border:#d7d7db;--si-row-border:#eee;--si-hover-bg:#f0f0f4;--si-source-hover-bg:#f0f6ff;--si-preview-bg:#eee;--si-muted:#737373;--si-meta:#555;--si-count-bg:#e7e7ea;--si-primary:#0060df;all:initial;position:fixed;z-index:2147483647;isolation:isolate;inset:0 0 0 auto;width:min(360px,92vw);font:13px system-ui;color:var(--si-text);color-scheme:light;animation:si-in 110ms ease-out both}
    :host([data-theme=dark]){--si-text:#f9f9fa;--si-panel-bg:#2a2a2e;--si-control-bg:#38383d;--si-border:#737373;--si-subtle-border:#4a4a4f;--si-row-border:#4a4a4f;--si-hover-bg:#45454b;--si-source-hover-bg:#38383d;--si-preview-bg:#38383d;--si-muted:#b1b1b3;--si-meta:#d7d7db;--si-count-bg:#4a4a4f;--si-primary:#80bfff;color-scheme:dark}
    :host(.closing){pointer-events:none;animation:si-out 90ms ease-in both}@keyframes si-in{from{opacity:0;transform:translateX(8px)}to{opacity:1;transform:none}}@keyframes si-out{from{opacity:1;transform:none}to{opacity:0;transform:translateX(8px)}}
    :host(.dock-left){inset:0 auto 0 0}:host(.dock-bottom){inset:auto 0 0;width:100vw;height:min(42vh,520px)}:host(.dock-top){inset:0 0 auto;width:100vw;height:min(42vh,520px)}
    :host(.floating){inset:80px auto auto 80px;width:min(520px,calc(100vw - 32px));height:min(70vh,620px)}
    .panel{height:100vh;box-sizing:border-box;background:var(--si-panel-bg);box-shadow:-8px 0 28px #0003;display:flex;flex-direction:column}
    :host(.dock-bottom) .panel,:host(.dock-top) .panel,:host(.floating) .panel{height:100%}:host(.floating) .panel{border:1px solid var(--si-border);border-radius:6px;box-shadow:0 10px 36px #0005;overflow:hidden}:host(.floating) .resize{display:none}.resize{position:absolute;inset:0 auto 0 -4px;width:8px;cursor:ew-resize}:host(.dock-left) .resize{inset:0 -4px 0 auto}:host(.dock-bottom) .resize{inset:-4px 0 auto;width:auto;height:8px;cursor:ns-resize}:host(.dock-top) .resize{inset:auto 0 -4px;width:auto;height:8px;cursor:ns-resize}header{display:flex;align-items:center;justify-content:space-between;padding:8px 10px 3px}:host(.floating) header{cursor:grab;user-select:none}:host(.floating) header:active{cursor:grabbing}h2{font-size:16px;margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.header-actions{display:flex;align-items:center;gap:2px;flex:none}button,input,select{font:inherit;color:inherit}button{cursor:pointer}.header-button{display:grid;place-items:center;width:30px;height:30px;padding:0;border:1px solid transparent;border-radius:4px;background:none;line-height:1}.header-button svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.header-button:hover{border-color:var(--si-border);background:var(--si-hover-bg)}
    .toolbar{display:grid;grid-template-columns:1fr auto;gap:6px;padding:4px 10px 6px}.toolbar input,.toolbar select{min-width:0;padding:5px 7px;border:1px solid var(--si-border);border-radius:4px;background:var(--si-control-bg)}.facets{display:flex;flex-wrap:wrap;gap:4px;padding:0 10px 6px;border-bottom:1px solid var(--si-subtle-border)}.facet{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;padding:2px 6px;border:1px solid var(--si-border);border-radius:99px;background:var(--si-control-bg)}.facet-count{min-width:15px;padding:0 3px;border-radius:99px;background:var(--si-count-bg);color:var(--si-meta);font-size:10px;line-height:15px;text-align:center}.facet[aria-pressed=true]{color:#fff;background:#0060df;border-color:#0060df}.facet[aria-pressed=true] .facet-count{background:#fff3;color:#fff}
    .list{overflow:auto;padding:0 7px 8px}.row{--si-kind:#57606a;padding:2px 0;border-bottom:1px solid var(--si-row-border)}.row[data-kind=image]{--si-kind:#8250df}.row[data-kind=video]{--si-kind:#0969da}.row[data-kind=audio]{--si-kind:#b45309}.row[data-kind=stream]{--si-kind:#087f5b}.row[data-kind=document]{--si-kind:#cf222e}.source-link{display:grid;grid-template-columns:30px minmax(0,1fr);gap:7px;align-items:center;min-height:38px;padding:3px 5px;border-radius:4px;color:inherit;text-decoration:none}.source-link:hover,.source-link:focus-visible{background:color-mix(in srgb,var(--si-kind) 12%,var(--si-panel-bg));outline:none}.source-text{min-width:0}
    img,video,.preview-fallback{width:30px;height:30px;object-fit:contain;background:var(--si-preview-bg);border-radius:3px}.preview-fallback,.audio{display:grid;place-items:center;color:var(--si-muted);font-size:17px}.name,.url{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.name{font-weight:600;color:var(--si-primary)}.row .name{color:color-mix(in srgb,var(--si-kind) 72%,var(--si-text))}.url{font-size:11px;color:var(--si-muted)}.meta{display:flex;align-items:center;gap:4px;min-width:0;margin-top:2px;overflow:hidden;font-size:10px;color:var(--si-meta);text-transform:uppercase;white-space:nowrap}.kind-badge{display:inline-flex;flex:none;align-items:center;gap:3px;max-width:48%;padding:1px 5px 1px 4px;border-radius:99px;background:var(--si-kind);color:#fff;font-weight:700;line-height:15px}.kind-label,.meta-details{overflow:hidden;text-overflow:ellipsis}.source-size{font-weight:400}.source-size[data-size-weight=medium]{font-weight:600}.source-size[data-size-weight=bold]{font-weight:700}.kind-icon{flex:none;width:11px;height:11px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.detected{flex:none}.media-tooltip{position:fixed;z-index:2;display:grid;place-items:center;box-sizing:border-box;max-width:min(360px,45vw);max-height:min(280px,55vh);padding:6px;border:1px solid var(--si-border);border-radius:6px;background:var(--si-panel-bg);box-shadow:0 10px 32px #0005;pointer-events:none}.media-tooltip img,.media-tooltip video{width:auto;height:auto;max-width:340px;max-height:260px;object-fit:contain;background:#111}.media-tooltip audio{width:min(300px,40vw);pointer-events:none}
    .actions{display:flex;flex-wrap:wrap;gap:4px;margin:1px 5px 3px 42px}.actions button{min-height:26px;padding:3px 7px;border:1px solid var(--si-border);border-radius:3px;background:var(--si-control-bg)}.actions button:last-child{border-color:var(--si-primary);color:var(--si-primary)}.empty{padding:24px 12px;color:var(--si-muted);text-align:center}
    @media (prefers-color-scheme:dark){:host([data-theme=system]){--si-text:#f9f9fa;--si-panel-bg:#2a2a2e;--si-control-bg:#38383d;--si-border:#737373;--si-subtle-border:#4a4a4f;--si-row-border:#4a4a4f;--si-hover-bg:#45454b;--si-source-hover-bg:#38383d;--si-preview-bg:#38383d;--si-muted:#b1b1b3;--si-meta:#d7d7db;--si-count-bg:#4a4a4f;--si-primary:#80bfff;color-scheme:dark}}@media(prefers-reduced-motion:reduce){:host,:host(.closing){animation:none}}
  `;
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", copy.title);
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
      const dock = host.dataset.dock || "right";
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
  const docks = ["right", "bottom", "left", "top"] as const;
  let dockIndex = 0;
  const updateDock = () => {
    const dock = docks[dockIndex]!;
    host.dataset.dock = dock;
    host.classList.remove("dock-left", "dock-bottom", "dock-top");
    if (dock !== "right") host.classList.add(`dock-${dock}`);
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
      const left = Math.min(
        window.innerWidth - rect.width - 8,
        Math.max(8, rect.left + moveEvent.clientX - startX),
      );
      const top = Math.min(
        window.innerHeight - rect.height - 8,
        Math.max(8, rect.top + moveEvent.clientY - startY),
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
      const key = sortOptions[index]?.[1];
      if (key) option.textContent = copy.sort[key];
    });
    const dock = host.dataset.dock || "right";
    dockButton.title = formatSourcePanelCopy(
      copy.dockPositionTemplate,
      SOURCE_PANEL_COPY_VALUE_SLOT,
      copy.dockPositions[dock as keyof typeof copy.dockPositions],
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
  type CachedRow = { source: PageSource; row: HTMLElement; deactivate: () => void };
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
              if (source) {
                entry.target.src = source;
                pendingPreviewSources.delete(entry.target);
              }
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
      const detection = firstSeen.get(source.url)!;
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
        const element = elements[index++]!;
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
    const sources = sortPageSources(
      filterPageSources(allSources, filter.value, activeKind),
      sort.value as SourceSort,
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
    list.querySelectorAll(":scope > .empty").forEach((empty) => empty.remove());
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
        cached.source.bytes === source.bytes &&
        cached.source.previewable === source.previewable
      ) {
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
      const hasRichTooltip =
        panelOptions.previews !== false && ["image", "video", "audio"].includes(source.kind);
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
      try {
        const parsed = new URL(source.url);
        name.textContent = decodeURIComponent(
          parsed.pathname.split("/").filter(Boolean).at(-1) || parsed.hostname || source.kind,
        );
      } catch {
        name.textContent = source.kind;
      }
      url.className = "url";
      url.textContent = source.url;
      if (!hasRichTooltip) url.title = source.url;
      meta.className = "meta";
      const mediaDetails: string[] = [];
      const updateMeta = () => {
        const sourceBytes = source.bytes || 0;
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
          formatters.date.format(new Date(source.detectedAt || Date.now())),
        );
        detected.setAttribute("aria-label", detectedAt);
        if (!hasRichTooltip) detected.title = detectedAt;
        meta.replaceChildren(kindBadge, detailText, detected);
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
            .writeText(ytDlpCommand(source.url))
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
      let hovered = false;
      let focused = false;
      let previewActive = false;
      const syncPreview = () => {
        const active = hovered || focused;
        if (active === previewActive) return;
        previewActive = active;
        highlight(active);
        if (!active) {
          richTooltip?.querySelector<HTMLMediaElement>("video, audio")?.pause();
          richTooltip?.remove();
          richTooltip = null;
          sourceLink.removeAttribute("aria-describedby");
          return;
        }
        if (!hasRichTooltip) return;
        richTooltip = createSourceTooltip(source);
        if (!richTooltip) return;
        const tooltipId = `source-tooltip-${source.detectedOrder}`;
        richTooltip.id = tooltipId;
        sourceLink.setAttribute("aria-describedby", tooltipId);
        shadow.append(richTooltip);
        const positionTooltip = () => {
          if (!richTooltip?.isConnected) return;
          const bounds = row.getBoundingClientRect();
          const tooltipBounds = richTooltip.getBoundingClientRect();
          const left =
            bounds.left >= tooltipBounds.width + 12
              ? bounds.left - tooltipBounds.width - 8
              : bounds.right + 8;
          richTooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - tooltipBounds.width - 8, left))}px`;
          richTooltip.style.top = `${Math.max(8, Math.min(window.innerHeight - tooltipBounds.height - 8, bounds.top))}px`;
        };
        positionTooltip();
        const media = richTooltip.querySelector<HTMLMediaElement>("video, audio");
        if (media) {
          media.addEventListener("loadedmetadata", positionTooltip, { once: true });
          void media.play().catch(() => {});
        } else {
          richTooltip.querySelector("img")?.addEventListener("load", positionTooltip, {
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
      const cachedRow = { source, row, deactivate };
      rowCache.set(source.url, cachedRow);
      cachedRows.set(row, cachedRow);
      placeRow(row);
    });
    while (list.children.length > rowIndex) {
      const last = list.lastElementChild;
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
      if (!(mutation.target instanceof Element)) return;
      const affectsStylesheet =
        panelOptions.includeBackgrounds !== false &&
        (mutation.target.closest("style") ||
          mutation.target.matches('link[rel~="stylesheet"]') ||
          [...mutation.addedNodes, ...mutation.removedNodes].some(
            (node) =>
              node instanceof Element &&
              (node.matches('style, link[rel~="stylesheet"]') ||
                Boolean(node.querySelector('style, link[rel~="stylesheet"]'))),
          ));
      const affectsBase =
        mutation.target.matches("base") ||
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
        queueRoot(mutation.target);
        return;
      }
      mutation.removedNodes.forEach((node) => {
        if (node instanceof Element) removedRoots.add(node);
      });
      mutation.addedNodes.forEach((node) => {
        if (node instanceof Element) queueRoot(node);
      });
      if (mutation.target.matches("video, audio, picture")) queueRoot(mutation.target);
    });
    scheduleRefresh();
  });
  const resourceObserver =
    typeof PerformanceObserver === "function"
      ? new PerformanceObserver((entries) => {
          const observed = entries.getEntries() as PerformanceResourceTiming[];
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

import { normalizeUiTheme, type UiTheme } from "../config/content-options.ts";
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
  mergePageSourcesByUrl,
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
import {
  SOURCE_PANEL_LAYOUT_STORAGE_KEY,
  SOURCE_PANEL_SORT_STORAGE_KEY,
} from "../shared/storage-keys.ts";
import { positionFloatingElement } from "../shared/floating-position.ts";
import { preferredScrollBehavior } from "../shared/motion-preference.ts";
import SOURCE_PANEL_TOKENS_CSS from "./source-panel-tokens.css";
import SOURCE_PANEL_CSS from "./source-panel.css";
import SOURCE_PANEL_PREVIEW_CSS from "./source-panel-preview.css";
import SOURCE_PANEL_RESPONSIVE_CSS from "./source-panel-responsive.css";
import SOURCE_PANEL_RESULTS_CSS from "./source-panel-results.css";

declare const SAVE_IN_CONTENT_E2E: boolean;

export {
  collectPageSources,
  collectPageSourceCandidates,
  collectResourceHintSources,
  createSourceTooltip,
  filterPageSources,
  sortPageSources,
  resourceTimingByUrl,
  candidatesFromSrcset,
  urlsFromSrcset,
  type PageSource,
  type PageSourceKind,
  type SourcePanelOptions,
  type SourceSort,
} from "./source-panel-model.ts";
export { formatSourceBytes } from "./source-panel-model.ts";

const PANEL_HOST_ID = "save-in-source-panel";
const PANEL_DOCKS = ["right", "bottom", "left", "top"] as const;
type PanelDock = (typeof PANEL_DOCKS)[number];
type PanelPlacement = PanelDock | "floating";
type SourcePanelLayout = {
  placement: PanelPlacement;
  sideWidth: number;
  dockHeight: number;
  floatingLeft: number;
  floatingTop: number;
  floatingWidth: number;
  floatingHeight: number;
};
const DEFAULT_SOURCE_PANEL_LAYOUT: SourcePanelLayout = {
  placement: "right",
  sideWidth: 400,
  dockHeight: 420,
  floatingLeft: 80,
  floatingTop: 80,
  floatingWidth: 520,
  floatingHeight: 620,
};
const finiteLayoutNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const normalizeSourcePanelLayout = (value: unknown): SourcePanelLayout => {
  const stored =
    value != null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const placement = [...PANEL_DOCKS, "floating"].includes(stored.placement as PanelPlacement)
    ? (stored.placement as PanelPlacement)
    : DEFAULT_SOURCE_PANEL_LAYOUT.placement;
  return {
    placement,
    sideWidth: finiteLayoutNumber(stored.sideWidth, DEFAULT_SOURCE_PANEL_LAYOUT.sideWidth),
    dockHeight: finiteLayoutNumber(stored.dockHeight, DEFAULT_SOURCE_PANEL_LAYOUT.dockHeight),
    floatingLeft: finiteLayoutNumber(stored.floatingLeft, DEFAULT_SOURCE_PANEL_LAYOUT.floatingLeft),
    floatingTop: finiteLayoutNumber(stored.floatingTop, DEFAULT_SOURCE_PANEL_LAYOUT.floatingTop),
    floatingWidth: finiteLayoutNumber(
      stored.floatingWidth,
      DEFAULT_SOURCE_PANEL_LAYOUT.floatingWidth,
    ),
    floatingHeight: finiteLayoutNumber(
      stored.floatingHeight,
      DEFAULT_SOURCE_PANEL_LAYOUT.floatingHeight,
    ),
  };
};
let sourcePanelLayout = { ...DEFAULT_SOURCE_PANEL_LAYOUT };
try {
  chrome.storage.local.get(SOURCE_PANEL_LAYOUT_STORAGE_KEY, (stored) => {
    void chrome.runtime.lastError;
    sourcePanelLayout = normalizeSourcePanelLayout(stored[SOURCE_PANEL_LAYOUT_STORAGE_KEY]);
  });
} catch {
  // The extension may be reloaded while this content script remains alive.
}

const saveSourcePanelLayout = (layout: SourcePanelLayout) => {
  sourcePanelLayout = { ...layout };
  try {
    chrome.storage.local.set({ [SOURCE_PANEL_LAYOUT_STORAGE_KEY]: sourcePanelLayout }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // The extension may be reloaded while this content script remains alive.
  }
};

export const resetSourcePanelLayoutForTesting = () => {
  sourcePanelLayout = { ...DEFAULT_SOURCE_PANEL_LAYOUT };
};
const panelCleanups = new WeakMap<Element, () => void>();
const panelCloseTimers = new WeakMap<Element, number>();
const panelPreviousFocus = new WeakMap<Element, HTMLElement>();
const panelRoots = new WeakMap<HTMLElement, ShadowRoot>();
const panelOpenChanges = new WeakMap<HTMLElement, (open: boolean) => void>();
export type SourcePanelDownload = (source: PageSource) => void | boolean | Promise<void | boolean>;
const panelUpdates = new WeakMap<
  HTMLElement,
  (sendDownload: SourcePanelDownload, options: SourcePanelOptions) => void
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
  more: ["M6 12h.01", "M12 12h.01", "M18 12h.01"],
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

const setButtonIcon = (button: HTMLElement, icon: keyof typeof ICON_PATHS) => {
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

const resolvedPanelTheme = (theme: SourcePanelOptions["theme"]): UiTheme => normalizeUiTheme(theme);

const panelLocale = (locale?: string): string | undefined => {
  if (!locale) return undefined;
  if (locale.endsWith("_AI")) return locale.slice(0, -3);
  return locale.replace("_", "-");
};

const sourcePanelViewport = () => {
  const viewport = window.visualViewport;
  return viewport
    ? {
        left: viewport.offsetLeft,
        top: viewport.offsetTop,
        width: viewport.width,
        height: viewport.height,
      }
    : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
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
  sendDownload: SourcePanelDownload,
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
  let panelMenuFrame: number | undefined;
  type OpenPanelMenu = { trigger: HTMLElement; menu: HTMLElement };
  const openPanelMenus = new Map<HTMLDetailsElement, OpenPanelMenu>();
  const positionPanelMenus = () => {
    panelMenuFrame = undefined;
    const panelBounds = panel.getBoundingClientRect();
    openPanelMenus.forEach(({ trigger, menu }, details) => {
      if (!details.isConnected || !trigger.isConnected || !menu.isConnected) {
        openPanelMenus.delete(details);
        return;
      }
      menu.style.inset = "auto";
      positionFloatingElement(menu, trigger.getBoundingClientRect(), {
        align: getComputedStyle(details).direction === "rtl" ? "start" : "end",
        prefer: "below",
        relativeTo: panelBounds,
        viewport: {
          left: panelBounds.left,
          top: panelBounds.top,
          width: panelBounds.width,
          height: panelBounds.height,
        },
      });
    });
  };
  const schedulePanelMenuPosition = () => {
    if (panelMenuFrame !== undefined) cancelAnimationFrame(panelMenuFrame);
    panelMenuFrame = requestAnimationFrame(positionPanelMenus);
  };
  shadow.addEventListener("scroll", schedulePanelMenuPosition, true);
  window.addEventListener("resize", schedulePanelMenuPosition);
  window.visualViewport?.addEventListener("resize", schedulePanelMenuPosition);
  window.visualViewport?.addEventListener("scroll", schedulePanelMenuPosition);
  panelRoots.set(host, shadow);
  panelOpenChanges.set(host, panelOptions.onOpenChange || (() => {}));
  activePanelHost = host;
  const style = document.createElement("style");
  style.textContent = [
    SOURCE_PANEL_TOKENS_CSS,
    SOURCE_PANEL_CSS,
    SOURCE_PANEL_RESULTS_CSS,
    SOURCE_PANEL_RESPONSIVE_CSS,
    SOURCE_PANEL_PREVIEW_CSS,
  ].join("\n");
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", copy.title);
  let panelMenuSequence = 0;
  const setPanelMenuOpen = (
    details: HTMLDetailsElement,
    trigger: HTMLElement,
    menu: HTMLElement,
    open: boolean,
  ) => {
    if (open) {
      openPanelMenus.forEach((entry, candidate) => {
        setPanelMenuOpen(candidate, entry.trigger, entry.menu, false);
      });
      details.open = true;
      trigger.setAttribute("aria-expanded", "true");
      menu.hidden = false;
      panel.append(menu);
      openPanelMenus.set(details, { trigger, menu });
      schedulePanelMenuPosition();
      queueMicrotask(() => {
        if (details.open)
          menu.querySelector<HTMLElement>('[role^="menuitem"]:not([disabled])')?.focus();
      });
      return;
    }
    const restoreFocus = menu.contains(shadow.activeElement);
    openPanelMenus.delete(details);
    details.open = false;
    trigger.setAttribute("aria-expanded", "false");
    menu.hidden = true;
    details.append(menu);
    if (restoreFocus) trigger.focus();
  };
  const wirePanelMenu = (details: HTMLDetailsElement, trigger: HTMLElement, menu: HTMLElement) => {
    menu.id = `save-in-source-panel-menu-${++panelMenuSequence}`;
    trigger.setAttribute("aria-controls", menu.id);
    menu.addEventListener("keydown", (event) => {
      const items = [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')].filter(
        (item) => !(item instanceof HTMLButtonElement) || !item.disabled,
      );
      if (items.length === 0) return;
      const activeIndex = items.indexOf(shadow.activeElement as HTMLElement);
      let nextIndex: number | undefined;
      if (event.key === "ArrowDown") nextIndex = (activeIndex + 1) % items.length;
      else if (event.key === "ArrowUp") nextIndex = (activeIndex - 1 + items.length) % items.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = items.length - 1;
      else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setPanelMenuOpen(details, trigger, menu, false);
        trigger.focus();
        return;
      } else return;
      event.preventDefault();
      items[nextIndex]?.focus();
    });
  };
  let layout = { ...sourcePanelLayout };
  const currentDock = (): PanelDock =>
    /* v8 ignore next -- The host dock is written exclusively from this fixed list. */
    PANEL_DOCKS.find((candidate) => candidate === host.dataset.dock) ?? "right";
  const clamp = (value: number, minimum: number, maximum: number) =>
    Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
  const resize = document.createElement("div");
  resize.className = "resize";
  resize.tabIndex = 0;
  resize.setAttribute("aria-label", copy.resizeLabel);
  resize.title = copy.resizeLabel;
  /* v8 ignore next -- Assigned before applyLayout is first invoked. */
  let updatePlacementControls = () => {};
  const updateResizeAccessibility = () => {
    const placement = layout.placement;
    const viewport = sourcePanelViewport();
    if (placement === "floating") {
      resize.setAttribute("role", "separator");
      resize.setAttribute("aria-orientation", "vertical");
      resize.setAttribute("aria-valuemin", "320");
      resize.setAttribute("aria-valuemax", String(Math.max(320, Math.floor(viewport.width - 16))));
      resize.setAttribute("aria-valuenow", String(Math.round(layout.floatingWidth)));
      resize.setAttribute(
        "aria-valuetext",
        `${Math.round(layout.floatingWidth)} × ${Math.round(layout.floatingHeight)}`,
      );
      return;
    }
    const sideDock = placement === "right" || placement === "left";
    const maximum = Math.floor(sideDock ? viewport.width * 0.92 : viewport.height * 0.85);
    resize.setAttribute("role", "separator");
    resize.setAttribute("aria-orientation", sideDock ? "vertical" : "horizontal");
    resize.setAttribute("aria-valuemin", String(sideDock ? 280 : 220));
    resize.setAttribute("aria-valuemax", String(Math.max(sideDock ? 280 : 220, maximum)));
    resize.setAttribute(
      "aria-valuenow",
      String(Math.round(sideDock ? layout.sideWidth : layout.dockHeight)),
    );
    resize.removeAttribute("aria-valuetext");
  };
  const applyLayout = () => {
    const placement = layout.placement;
    const viewport = sourcePanelViewport();
    if (placement === "floating" && viewport.width > 480) {
      layout.floatingWidth = clamp(layout.floatingWidth, 320, viewport.width - 16);
      layout.floatingHeight = clamp(layout.floatingHeight, 260, viewport.height - 16);
      layout.floatingLeft = clamp(
        layout.floatingLeft,
        viewport.left + 8,
        viewport.left + viewport.width - layout.floatingWidth - 8,
      );
      layout.floatingTop = clamp(
        layout.floatingTop,
        viewport.top + 8,
        viewport.top + viewport.height - layout.floatingHeight - 8,
      );
    }
    host.dataset.dock = placement;
    host.classList.remove("dock-left", "dock-bottom", "dock-top", "floating");
    if (placement === "floating") host.classList.add("floating");
    else if (placement !== "right") host.classList.add(`dock-${placement}`);
    host.style.setProperty("--source-panel-side-size", `${layout.sideWidth}px`);
    host.style.setProperty("--source-panel-dock-size", `${layout.dockHeight}px`);
    host.style.setProperty("--source-panel-floating-left", `${layout.floatingLeft}px`);
    host.style.setProperty("--source-panel-floating-top", `${layout.floatingTop}px`);
    host.style.setProperty("--source-panel-floating-width", `${layout.floatingWidth}px`);
    host.style.setProperty("--source-panel-floating-height", `${layout.floatingHeight}px`);
    updateResizeAccessibility();
    updatePlacementControls();
  };
  const commitLayout = () => saveSourcePanelLayout(layout);
  resize.addEventListener("pointerdown", (event) => {
    resize.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = host.getBoundingClientRect().width;
    const startHeight = host.getBoundingClientRect().height;
    const move = (moveEvent: PointerEvent) => {
      const viewport = sourcePanelViewport();
      if (layout.placement === "floating") {
        layout.floatingWidth = clamp(
          startWidth + moveEvent.clientX - startX,
          320,
          viewport.width - 16,
        );
        layout.floatingHeight = clamp(
          startHeight + moveEvent.clientY - startY,
          260,
          viewport.height - 16,
        );
        applyLayout();
        return;
      }
      const dock = currentDock();
      if (dock === "right" || dock === "left") {
        const delta = dock === "right" ? startX - moveEvent.clientX : moveEvent.clientX - startX;
        layout.sideWidth = clamp(startWidth + delta, 280, viewport.width * 0.92);
      } else {
        const delta = dock === "bottom" ? startY - moveEvent.clientY : moveEvent.clientY - startY;
        layout.dockHeight = clamp(startHeight + delta, 220, viewport.height * 0.85);
      }
      applyLayout();
    };
    const finish = () => {
      resize.removeEventListener("pointermove", move);
      commitLayout();
    };
    resize.addEventListener("pointermove", move);
    resize.addEventListener("pointerup", finish, { once: true });
    resize.addEventListener("pointercancel", finish, { once: true });
  });
  resize.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 32 : 12;
    const viewport = sourcePanelViewport();
    let handled = true;
    if (layout.placement === "floating") {
      if (event.key === "ArrowLeft") layout.floatingWidth -= step;
      else if (event.key === "ArrowRight") layout.floatingWidth += step;
      else if (event.key === "ArrowUp") layout.floatingHeight -= step;
      else if (event.key === "ArrowDown") layout.floatingHeight += step;
      else handled = false;
      layout.floatingWidth = clamp(layout.floatingWidth, 320, viewport.width - 16);
      layout.floatingHeight = clamp(layout.floatingHeight, 260, viewport.height - 16);
    } else if (layout.placement === "right" || layout.placement === "left") {
      const boundaryDelta =
        event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      if (boundaryDelta === 0) handled = false;
      else layout.sideWidth += layout.placement === "right" ? -boundaryDelta : boundaryDelta;
      layout.sideWidth = clamp(layout.sideWidth, 280, viewport.width * 0.92);
    } else {
      const boundaryDelta = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      if (boundaryDelta === 0) handled = false;
      else layout.dockHeight += layout.placement === "bottom" ? -boundaryDelta : boundaryDelta;
      layout.dockHeight = clamp(layout.dockHeight, 220, viewport.height * 0.85);
    }
    if (!handled) return;
    event.preventDefault();
    applyLayout();
    commitLayout();
  });
  resize.addEventListener("dblclick", () => {
    if (layout.placement === "floating") {
      layout.floatingWidth = DEFAULT_SOURCE_PANEL_LAYOUT.floatingWidth;
      layout.floatingHeight = DEFAULT_SOURCE_PANEL_LAYOUT.floatingHeight;
    } else if (layout.placement === "right" || layout.placement === "left") {
      layout.sideWidth = DEFAULT_SOURCE_PANEL_LAYOUT.sideWidth;
    } else {
      layout.dockHeight = DEFAULT_SOURCE_PANEL_LAYOUT.dockHeight;
    }
    applyLayout();
    commitLayout();
  });
  const header = document.createElement("header");
  const title = document.createElement("h2");
  const close = document.createElement("button");
  title.textContent = copy.title;
  close.className = "header-button close";
  setButtonIcon(close, "close");
  close.title = copy.close;
  close.setAttribute("aria-label", copy.closeLabel);
  const dockPicker = document.createElement("details");
  dockPicker.className = "dock-picker";
  const dockButton = document.createElement("summary");
  dockButton.className = "header-button dock";
  setButtonIcon(dockButton, "dock");
  dockButton.setAttribute("aria-label", copy.changeDockLabel);
  dockButton.setAttribute("aria-haspopup", "menu");
  dockButton.setAttribute("aria-expanded", "false");
  const dockMenu = document.createElement("div");
  dockMenu.className = "dock-menu";
  dockMenu.setAttribute("role", "menu");
  dockMenu.hidden = true;
  const placementButtons = new Map<PanelPlacement, HTMLButtonElement>();
  ([...PANEL_DOCKS, "floating"] as const).forEach((placement) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.placement = placement;
    button.setAttribute("role", "menuitemradio");
    button.textContent = copy.dockPositions[placement];
    button.addEventListener("click", () => {
      layout.placement = placement;
      setPanelMenuOpen(dockPicker, dockButton, dockMenu, false);
      applyLayout();
      commitLayout();
    });
    placementButtons.set(placement, button);
    dockMenu.append(button);
  });
  updatePlacementControls = () => {
    const placement = layout.placement;
    dockButton.title = formatSourcePanelCopy(
      copy.dockPositionTemplate,
      SOURCE_PANEL_COPY_VALUE_SLOT,
      copy.dockPositions[placement],
    );
    placementButtons.forEach((button, value) => {
      button.setAttribute("aria-checked", String(value === placement));
    });
  };
  dockPicker.append(dockButton, dockMenu);
  wirePanelMenu(dockPicker, dockButton, dockMenu);
  dockButton.addEventListener("click", (event) => {
    event.preventDefault();
    setPanelMenuOpen(dockPicker, dockButton, dockMenu, !dockPicker.open);
  });
  applyLayout();
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
  const titleGroup = document.createElement("div");
  titleGroup.className = "title-group";
  const dragGrip = document.createElement("span");
  dragGrip.className = "drag-grip";
  dragGrip.setAttribute("aria-hidden", "true");
  const sourceCount = document.createElement("span");
  sourceCount.className = "source-count";
  titleGroup.append(dragGrip, title, sourceCount);
  headerActions.append(copyUrls, dockPicker, close);
  header.append(titleGroup, headerActions);
  header.addEventListener("pointerdown", (event) => {
    if (!host.classList.contains("floating") || event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("button, summary")) return;
    header.setPointerCapture?.(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const rect = host.getBoundingClientRect();
    const move = (moveEvent: PointerEvent) => {
      const { left, top } = positionDraggedSourcePanel(
        rect,
        { x: startX, y: startY },
        { x: moveEvent.clientX, y: moveEvent.clientY },
        sourcePanelViewport(),
      );
      layout.floatingLeft = left;
      layout.floatingTop = top;
      applyLayout();
    };
    const finish = () => {
      header.removeEventListener("pointermove", move);
      commitLayout();
    };
    header.addEventListener("pointermove", move);
    header.addEventListener("pointerup", finish, { once: true });
    header.addEventListener("pointercancel", finish, { once: true });
  });
  const list = document.createElement("ul");
  list.className = "list";
  list.setAttribute("role", "list");
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
    selectFiltered.textContent = copy.selectFiltered;
    clearSelection.textContent = copy.clearSelection;
    saveSelected.textContent = copy.saveSelected;
    cancelBatch.textContent = copy.batchCancel;
    continueBatch.textContent = copy.batchContinue;
    filter.placeholder = copy.filterSources;
    filter.setAttribute("aria-label", copy.filterLabel);
    sort.setAttribute("aria-label", copy.sortLabel);
    [...sort.options].forEach((option, index) => {
      const entry = sortOptions[index];
      /* v8 ignore next -- Options are created one-for-one from sortOptions. */
      if (entry) option.textContent = copy.sort[entry[1]];
    });
    placementButtons.forEach((button, placement) => {
      button.textContent = copy.dockPositions[placement];
    });
    updatePlacementControls();
  };
  toolbar.append(filter, sort);
  const facets = document.createElement("div");
  facets.className = "facets";
  facets.setAttribute("aria-label", copy.filterLabel);
  const selectionBar = document.createElement("div");
  selectionBar.className = "selection-bar";
  selectionBar.setAttribute("role", "group");
  selectionBar.setAttribute("aria-label", copy.saveSelected);
  const selectionCount = document.createElement("span");
  selectionCount.className = "selection-count";
  const selectedCount = document.createElement("span");
  const hiddenSelectedCount = document.createElement("span");
  hiddenSelectedCount.className = "hidden-selection-count";
  selectionCount.append(selectedCount, hiddenSelectedCount);
  const selectFiltered = document.createElement("button");
  selectFiltered.type = "button";
  const clearSelection = document.createElement("button");
  clearSelection.type = "button";
  const saveSelected = document.createElement("button");
  saveSelected.type = "button";
  saveSelected.className = "batch-save";
  selectionBar.append(selectionCount, selectFiltered, clearSelection, saveSelected);
  const batchDialog = document.createElement("dialog");
  batchDialog.className = "batch-dialog";
  const batchQuestion = document.createElement("p");
  batchQuestion.id = "save-in-source-panel-batch-question";
  batchDialog.setAttribute("aria-label", copy.batchContinue);
  batchDialog.setAttribute("aria-describedby", batchQuestion.id);
  const batchDialogActions = document.createElement("div");
  batchDialogActions.className = "batch-dialog-actions";
  const cancelBatch = document.createElement("button");
  cancelBatch.type = "button";
  const continueBatch = document.createElement("button");
  continueBatch.type = "button";
  continueBatch.className = "primary-action";
  selectFiltered.textContent = copy.selectFiltered;
  clearSelection.textContent = copy.clearSelection;
  saveSelected.textContent = copy.saveSelected;
  cancelBatch.textContent = copy.batchCancel;
  continueBatch.textContent = copy.batchContinue;
  batchDialogActions.append(cancelBatch, continueBatch);
  batchDialog.append(batchQuestion, batchDialogActions);
  const liveStatus = document.createElement("div");
  liveStatus.className = "visually-hidden live-status";
  liveStatus.setAttribute("role", "status");
  liveStatus.setAttribute("aria-live", "polite");
  const announce = (message: string) => {
    liveStatus.textContent = message;
  };
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
  const selectedSourceUrls = new Set<string>();
  let batchSaving = false;
  const suppressedSelectionClicks = new WeakSet<HTMLInputElement>();
  let resourceHintSources: PageSource[] = [];
  type CachedRow = {
    source: PageSource;
    row: HTMLElement;
    deactivate: () => void;
    updateBytes: (bytes: number | undefined) => void;
    updateSelection: (selected: boolean, disabled: boolean) => void;
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
    allSources = mergePageSourcesByUrl(
      [sourceCandidates, backgroundCandidates, resourceHintSources].flat(),
    );
    const presentUrls = new Set(allSources.map(({ url }) => url));
    selectedSourceUrls.forEach((url) => {
      if (!presentUrls.has(url)) selectedSourceUrls.delete(url);
    });
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
  const decodeSourcePart = (value: string): string => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  const sourceDisplay = (source: PageSource): { name: string; url: string } => {
    const parsed = new URL(source.url);
    if (parsed.protocol === "data:") {
      const mediaType = source.url.slice(5).split(/[;,]/, 1)[0] || "data";
      return { name: copy.embeddedSource, url: `data:${mediaType}` };
    }
    if (parsed.protocol === "blob:") return { name: copy.embeddedSource, url: "blob:" };
    const path = decodeSourcePart(parsed.pathname);
    const filename = path.split("/").filter(Boolean).at(-1);
    return {
      name:
        filename ||
        /* v8 ignore next -- Every non-data/blob discoverable URL has a hostname. */
        parsed.hostname,
      url: `${parsed.hostname}${path === "/" ? "" : path}`,
    };
  };
  const updateSelectionUi = () => {
    const count = selectedSourceUrls.size;
    selectedCount.textContent = formatSourcePanelCopy(
      copy.selectedCountTemplate,
      SOURCE_PANEL_COPY_VALUE_SLOT,
      count,
    );
    const visibleUrls = new Set(visibleSources.map(({ url }) => url));
    const hiddenCount = [...selectedSourceUrls].filter((url) => !visibleUrls.has(url)).length;
    hiddenSelectedCount.hidden = hiddenCount === 0;
    hiddenSelectedCount.textContent = hiddenCount
      ? formatSourcePanelCopy(
          copy.hiddenSelectedCountTemplate,
          SOURCE_PANEL_COPY_VALUE_SLOT,
          hiddenCount,
        )
      : "";
    const hasSelection = count > 0;
    selectionBar.hidden = !hasSelection && visibleSources.length === 0;
    selectionBar.dataset.hasSelection = String(hasSelection);
    selectionCount.hidden = !hasSelection;
    selectFiltered.hidden = hasSelection;
    clearSelection.hidden = !hasSelection;
    saveSelected.hidden = !hasSelection;
    clearSelection.disabled = batchSaving;
    saveSelected.disabled = batchSaving;
    selectFiltered.disabled = batchSaving || visibleSources.length === 0;
    selectionBar.setAttribute("aria-busy", String(batchSaving));
    list.inert = batchSaving;
    list.setAttribute("aria-busy", String(batchSaving));
  };
  const updateAllSelectionRows = () => {
    rowCache.forEach((cached, url) =>
      cached.updateSelection(selectedSourceUrls.has(url), batchSaving),
    );
  };
  type SelectionPaint = {
    origin: HTMLInputElement;
    pointerId: number;
    selected: boolean;
    visited: Set<string>;
  };
  let selectionPaint: SelectionPaint | null = null;
  const clearSelectionPaint = () => {
    const origin = selectionPaint?.origin;
    selectionPaint = null;
    delete panel.dataset.selecting;
    document.removeEventListener("pointermove", moveSelectionPaint, true);
    document.removeEventListener("pointerup", finishSelectionPaint, true);
    document.removeEventListener("pointercancel", finishSelectionPaint, true);
    if (origin) window.setTimeout(() => suppressedSelectionClicks.delete(origin));
  };
  const paintSelection = (input: HTMLInputElement) => {
    const url = input.dataset.sourceUrl;
    if (!selectionPaint || !url || selectionPaint.visited.has(url)) return;
    selectionPaint.visited.add(url);
    if (selectionPaint.selected) selectedSourceUrls.add(url);
    else selectedSourceUrls.delete(url);
    rowCache.get(url)?.updateSelection(selectedSourceUrls.has(url), batchSaving);
    updateSelectionUi();
  };
  const selectionInputAt = (event: PointerEvent): HTMLInputElement | null => {
    const hit = shadow.elementFromPoint?.(event.clientX, event.clientY);
    const target = hit || (event.composedPath()[0] as Element | undefined);
    return target instanceof Element
      ? target.closest(".row")?.querySelector<HTMLInputElement>(".source-selection input") || null
      : null;
  };
  const moveSelectionPaint = (event: PointerEvent) => {
    if (!selectionPaint || event.pointerId !== selectionPaint.pointerId) return;
    const input = selectionInputAt(event);
    if (input) paintSelection(input);
  };
  const finishSelectionPaint = (event: PointerEvent) => {
    if (!selectionPaint || event.pointerId !== selectionPaint.pointerId) return;
    const count = selectedSourceUrls.size;
    clearSelectionPaint();
    announce(
      formatSourcePanelCopy(copy.selectedCountTemplate, SOURCE_PANEL_COPY_VALUE_SLOT, count),
    );
  };
  const startSelectionPaint = (event: PointerEvent, input: HTMLInputElement) => {
    if (batchSaving || selectionPaint || event.button !== 0) return;
    const url = input.dataset.sourceUrl;
    if (!url) return;
    event.preventDefault();
    selectionPaint = {
      origin: input,
      pointerId: event.pointerId,
      selected: !selectedSourceUrls.has(url),
      visited: new Set(),
    };
    panel.dataset.selecting = selectionPaint.selected ? "select" : "clear";
    suppressedSelectionClicks.add(input);
    paintSelection(input);
    try {
      input.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is unavailable in some embedded page contexts.
    }
    document.addEventListener("pointermove", moveSelectionPaint, true);
    document.addEventListener("pointerup", finishSelectionPaint, true);
    document.addEventListener("pointercancel", finishSelectionPaint, true);
  };
  const confirmLargeBatch = (count: number): Promise<boolean> => {
    if (count <= 20) return Promise.resolve(true);
    batchQuestion.textContent = formatSourcePanelCopy(
      copy.batchConfirmTemplate,
      SOURCE_PANEL_COPY_VALUE_SLOT,
      count,
    );
    return new Promise((resolve) => {
      function finish(accepted: boolean) {
        cancelBatch.removeEventListener("click", cancel);
        continueBatch.removeEventListener("click", proceed);
        batchDialog.removeEventListener("cancel", cancel);
        if (typeof batchDialog.close === "function") batchDialog.close();
        else batchDialog.removeAttribute("open");
        resolve(accepted);
      }
      function cancel() {
        finish(false);
      }
      function proceed() {
        finish(true);
      }
      cancelBatch.addEventListener("click", cancel);
      continueBatch.addEventListener("click", proceed);
      batchDialog.addEventListener("cancel", cancel);
      if (typeof batchDialog.showModal === "function") batchDialog.showModal();
      else batchDialog.setAttribute("open", "");
    });
  };
  const saveSelectedSources = async () => {
    const sources = allSources.filter(({ url }) => selectedSourceUrls.has(url));
    if (sources.length === 0 || !(await confirmLargeBatch(sources.length))) return;
    batchSaving = true;
    updateSelectionUi();
    updateAllSelectionRows();
    panelOptions.onSaveIntent?.();
    let started = 0;
    const failed: PageSource[] = [];
    for (const [index, source] of sources.entries()) {
      saveSelected.textContent = formatSourcePanelCopy(
        copy.batchSavingTemplate,
        SOURCE_PANEL_COPY_VALUE_SLOT,
        `${index + 1}/${sources.length}`,
      );
      try {
        if ((await panelSendDownload(source)) !== false) started += 1;
        else failed.push(source);
      } catch {
        failed.push(source);
      }
    }
    batchSaving = false;
    selectedSourceUrls.clear();
    failed.forEach(({ url }) => {
      if (allSources.some((source) => source.url === url)) selectedSourceUrls.add(url);
    });
    saveSelected.textContent = copy.saveSelected;
    updateSelectionUi();
    updateAllSelectionRows();
    announce(formatSourcePanelCopy(copy.batchSavedTemplate, SOURCE_PANEL_COPY_VALUE_SLOT, started));
  };
  selectFiltered.addEventListener("click", () => {
    visibleSources.forEach(({ url }) => selectedSourceUrls.add(url));
    updateSelectionUi();
    updateAllSelectionRows();
  });
  clearSelection.addEventListener("click", () => {
    selectedSourceUrls.clear();
    updateSelectionUi();
    updateAllSelectionRows();
  });
  saveSelected.addEventListener("click", () => void saveSelectedSources());
  const render = () => {
    previewObserver?.disconnect();
    const sourceSort = isSourceSort(sort.value) ? sort.value : "relevance";
    const sources = sortPageSources(
      filterPageSources(allSources, filter.value, activeKind),
      sourceSort,
    );
    visibleSources = sources;
    updateSelectionUi();
    updateAllSelectionRows();
    title.textContent = copy.title;
    const totalCount = formatSourcePanelCopy(
      copy.sourceCountTemplate,
      SOURCE_PANEL_COPY_VALUE_SLOT,
      allSources.length,
    );
    sourceCount.textContent = String(allSources.length);
    sourceCount.title = totalCount;
    sourceCount.setAttribute("aria-label", totalCount);
    facets.replaceChildren();
    const presentUrls = new Set(allSources.map(({ url }) => url));
    rowCache.forEach((cached, url) => {
      if (presentUrls.has(url)) return;
      deactivateAndRemove(cached);
      rowCache.delete(url);
    });
    (["all", "image", "video", "audio", "document", "stream", "link"] as const).forEach(
      (kindName) => {
        const count =
          kindName === "all"
            ? allSources.length
            : allSources.filter(({ kind }) => kind === kindName).length;
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
      const empty = document.createElement("li");
      empty.className = "empty";
      const emptyMessage = document.createElement("p");
      const normalizedFilter = filter.value.trim();
      const message = allSources.length
        ? normalizedFilter
          ? formatSourcePanelCopy(
              copy.noMatchesFilterTemplate,
              SOURCE_PANEL_COPY_VALUE_SLOT,
              normalizedFilter,
            )
          : copy.noMatches
        : copy.noSources;
      emptyMessage.textContent = message;
      empty.append(emptyMessage);
      if (allSources.length) {
        const clearFilters = document.createElement("button");
        clearFilters.type = "button";
        clearFilters.textContent = copy.clearFilters;
        clearFilters.addEventListener("click", () => {
          filter.value = "";
          activeKind = "all";
          render();
          filter.focus();
        });
        empty.append(clearFilters);
      }
      rowCache.forEach((cached) => {
        if (cached.row.isConnected) deactivateAndRemove(cached);
      });
      list.replaceChildren(empty);
      copyUrls.disabled = true;
      announce(message);
      return;
    }
    copyUrls.disabled = false;
    announce(
      formatSourcePanelCopy(copy.sourceCountTemplate, SOURCE_PANEL_COPY_VALUE_SLOT, sources.length),
    );
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
        cached.source.previewable === source.previewable &&
        cached.source.responsive?.descriptor === source.responsive?.descriptor &&
        cached.source.responsive?.selected === source.responsive?.selected
      ) {
        if (cached.source.bytes !== source.bytes) cached.updateBytes(source.bytes);
        cached.source = source;
        cached.updateSelection(selectedSourceUrls.has(source.url), batchSaving);
        const preview = cached.row.querySelector<HTMLImageElement | HTMLMediaElement>("img, video");
        if (previewObserver && preview && !preview.hasAttribute("src")) {
          previewObserver.observe(preview);
        }
        placeRow(cached.row);
        return;
      }
      if (cached) deactivateAndRemove(cached);
      const row = document.createElement("li");
      row.className = "row";
      row.dataset.kind = source.kind;
      const selection = document.createElement("label");
      selection.className = "source-selection";
      const selectionInput = document.createElement("input");
      selectionInput.type = "checkbox";
      selectionInput.dataset.sourceUrl = source.url;
      selectionInput.checked = selectedSourceUrls.has(source.url);
      selectionInput.setAttribute("aria-label", source.url);
      selectionInput.addEventListener("pointerdown", (event) =>
        startSelectionPaint(event, selectionInput),
      );
      selectionInput.addEventListener("click", (event) => {
        if (!suppressedSelectionClicks.has(selectionInput)) return;
        if (event.detail === 0) {
          suppressedSelectionClicks.delete(selectionInput);
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        selectionInput.checked = selectedSourceUrls.has(source.url);
        window.setTimeout(() => suppressedSelectionClicks.delete(selectionInput));
      });
      selectionInput.addEventListener("change", () => {
        if (selectionInput.checked) selectedSourceUrls.add(source.url);
        else selectedSourceUrls.delete(source.url);
        rowCache.get(source.url)?.updateSelection(selectedSourceUrls.has(source.url), batchSaving);
        updateSelectionUi();
      });
      selection.append(selectionInput);
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
      const display = sourceDisplay(source);
      name.textContent = display.name;
      url.className = "url";
      url.textContent = display.url;
      url.title = source.url;
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
        if (source.responsive?.selected) {
          const current = document.createElement("span");
          current.className = "current-source";
          current.textContent = copy.current;
          current.setAttribute("aria-current", "true");
          detailText.append(current, document.createTextNode(" · "));
        }
        detailText.append(size);
        if (source.responsive?.descriptor)
          detailText.append(document.createTextNode(` · ${source.responsive.descriptor}`));
        if (mediaDetails.length)
          detailText.append(document.createTextNode(` · ${mediaDetails.join(" · ")}`));
        const detectedAt = formatSourcePanelCopy(
          copy.detectedAtTemplate,
          SOURCE_PANEL_COPY_VALUE_SLOT,
          /* v8 ignore next -- commitSources stamps every rendered source. */
          formatters.date.format(new Date(source.detectedAt ?? Date.now())),
        );
        meta.title = detectedAt;
        meta.replaceChildren(kindBadge, detailText);
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
      const more = document.createElement("details");
      more.className = "row-more";
      const moreButton = document.createElement("summary");
      moreButton.setAttribute("aria-label", copy.moreActions);
      moreButton.setAttribute("aria-haspopup", "menu");
      moreButton.setAttribute("aria-expanded", "false");
      moreButton.title = copy.moreActions;
      setButtonIcon(moreButton, "more");
      const actionMenu = document.createElement("div");
      actionMenu.className = "action-menu";
      actionMenu.setAttribute("role", "menu");
      actionMenu.hidden = true;
      const locate = document.createElement("button");
      locate.type = "button";
      locate.setAttribute("role", "menuitem");
      const locateHighlightOwner = {};
      let locateHighlightTimer = 0;
      locate.textContent = copy.locate;
      locate.addEventListener("click", () => {
        setPanelMenuOpen(more, moreButton, actionMenu, false);
        source.element.scrollIntoView?.({
          behavior: preferredScrollBehavior(),
          block: "center",
        });
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
      save.type = "button";
      save.className = "primary-action";
      save.textContent = copy.save;
      save.addEventListener("pointerdown", (event) => {
        if (event.button === 0) panelOptions.onSaveIntent?.();
      });
      save.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") panelOptions.onSaveIntent?.();
      });
      save.addEventListener("click", () => panelSendDownload(source));
      actionMenu.append(locate);
      if (panelOptions.onCreateRule) {
        const createRule = document.createElement("button");
        createRule.type = "button";
        createRule.setAttribute("role", "menuitem");
        createRule.textContent = copy.createAutomaticRule;
        createRule.addEventListener("click", () => {
          setPanelMenuOpen(more, moreButton, actionMenu, false);
          void panelOptions.onCreateRule?.(source);
        });
        actionMenu.append(createRule);
      }
      if (source.kind === "stream" || source.kind === "video") {
        const copyCommand = document.createElement("button");
        copyCommand.type = "button";
        copyCommand.setAttribute("role", "menuitem");
        copyCommand.textContent = copy.copyYtDlp;
        copyCommand.title = copy.copyYtDlpHelp;
        copyCommand.addEventListener("click", () => {
          void navigator.clipboard
            .writeText(source.url)
            .then(() => {
              copyCommand.textContent = copy.copied;
              announce(copy.copied);
              window.setTimeout(() => (copyCommand.textContent = copy.copyYtDlp), 1200);
            })
            .catch(() => {
              copyCommand.textContent = copy.copyFailed;
              announce(copy.copyFailed);
            });
        });
        actionMenu.append(copyCommand);
      }
      more.append(moreButton, actionMenu);
      wirePanelMenu(more, moreButton, actionMenu);
      moreButton.addEventListener("click", (event) => {
        event.preventDefault();
        setPanelMenuOpen(more, moreButton, actionMenu, !more.open);
      });
      actions.append(save, more);
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
            sourcePanelViewport(),
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
      sourceLink.addEventListener("mouseenter", () => {
        hovered = true;
        syncPreview();
      });
      sourceLink.addEventListener("mouseleave", () => {
        hovered = false;
        syncPreview();
      });
      sourceLink.addEventListener("focus", () => {
        focused = true;
        syncPreview();
      });
      sourceLink.addEventListener("blur", () => {
        focused = false;
        syncPreview();
      });
      row.addEventListener("click", (event) => {
        if (
          !event.altKey ||
          event.button !== 0 ||
          (event.target instanceof Element && event.target.closest("button, summary"))
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
          !(event.target instanceof Element && event.target.closest("button, summary"))
        ) {
          panelOptions.onSaveIntent?.();
        }
      });
      row.addEventListener("keydown", (event) => {
        if (
          event.altKey &&
          (event.key === "Enter" || event.key === " ") &&
          !(event.target instanceof Element && event.target.closest("button, summary"))
        ) {
          panelOptions.onSaveIntent?.();
        }
      });
      row.append(selection, sourceLink, actions);
      const deactivate = () => {
        hovered = false;
        focused = false;
        syncPreview();
        setPanelMenuOpen(more, moreButton, actionMenu, false);
        window.clearTimeout(locateHighlightTimer);
        if (source.element instanceof HTMLElement)
          releaseHighlight(source.element, locateHighlightOwner);
      };
      const cachedRow = {
        source,
        row,
        deactivate,
        updateBytes,
        updateSelection: (selected: boolean, disabled: boolean) => {
          selectionInput.checked = selected;
          selectionInput.disabled = disabled;
          row.dataset.selected = String(selected);
        },
      };
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
        const copiedMessage = formatSourcePanelCopy(
          copy.copiedUrlsTemplate,
          SOURCE_PANEL_COPY_VALUE_SLOT,
          visibleSources.length,
        );
        copyUrls.title = copiedMessage;
        copyUrls.setAttribute("aria-label", copiedMessage);
        announce(copiedMessage);
        window.setTimeout(() => {
          setButtonIcon(copyUrls, "copy");
          copyUrls.title = copy.copyFilteredUrls;
          copyUrls.setAttribute("aria-label", copy.copyFilteredUrlsLabel);
        }, 1200);
      })
      .catch(() => {
        setButtonIcon(copyUrls, "error");
        copyUrls.title = copy.copyFailed;
        copyUrls.setAttribute("aria-label", copy.copyFailed);
        announce(copy.copyFailed);
      });
  });
  const closeOpenMenus = () => {
    const entries = [...openPanelMenus];
    entries.forEach(([details, { trigger, menu }]) => {
      setPanelMenuOpen(details, trigger, menu, false);
    });
    return entries.length > 0;
  };
  const closeMenusOutside = (event: PointerEvent) => {
    if (event.target !== host) closeOpenMenus();
  };
  const closeMenusInsidePanel = (event: Event) => {
    if (
      event.target instanceof Element &&
      event.target.closest(".dock-picker, .row-more, .dock-menu, .action-menu") !== null
    )
      return;
    closeOpenMenus();
  };
  document.addEventListener("pointerdown", closeMenusOutside, true);
  shadow.addEventListener("pointerdown", closeMenusInsidePanel);
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (closeOpenMenus()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    closePanel();
  });
  panel.append(resize, header, toolbar, facets, selectionBar, liveStatus, list, batchDialog);
  shadow.append(style, panel);
  document.documentElement.append(host);
  const pageRoot = document.documentElement;
  const previousRootOverflow = pageRoot.style.getPropertyValue("overflow");
  const previousRootOverflowPriority = pageRoot.style.getPropertyPriority("overflow");
  let pageScrollLocked = false;
  const restorePageScroll = () => {
    if (
      pageRoot.style.getPropertyValue("overflow") !== "hidden" ||
      pageRoot.style.getPropertyPriority("overflow") !== "important"
    )
      return;
    if (previousRootOverflow)
      pageRoot.style.setProperty("overflow", previousRootOverflow, previousRootOverflowPriority);
    else pageRoot.style.removeProperty("overflow");
  };
  const syncPageScrollLock = () => {
    const shouldLock = window.innerWidth <= 480;
    if (shouldLock === pageScrollLocked) return;
    pageScrollLocked = shouldLock;
    if (shouldLock) pageRoot.style.setProperty("overflow", "hidden", "important");
    else restorePageScroll();
  };
  syncPageScrollLock();
  window.addEventListener("resize", syncPageScrollLock);
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
  const scheduleResponsiveRefresh = () => {
    if (panelOptions.live === false) return;
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
    clearSelectionPaint();
    window.clearTimeout(filterTimer);
    window.clearTimeout(refreshTimer);
    cancelBackgroundScan();
    rowCache.forEach(({ deactivate }) => deactivate());
    document.removeEventListener("pointerdown", closeMenusOutside, true);
    shadow.removeEventListener("pointerdown", closeMenusInsidePanel);
    if (panelMenuFrame !== undefined) cancelAnimationFrame(panelMenuFrame);
    shadow.removeEventListener("scroll", schedulePanelMenuPosition, true);
    window.removeEventListener("resize", schedulePanelMenuPosition);
    window.visualViewport?.removeEventListener("resize", schedulePanelMenuPosition);
    window.visualViewport?.removeEventListener("scroll", schedulePanelMenuPosition);
    window.removeEventListener("resize", syncPageScrollLock);
    window.removeEventListener("resize", scheduleResponsiveRefresh);
    window.visualViewport?.removeEventListener("resize", scheduleResponsiveRefresh);
    restorePageScroll();
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
  sendDownload: SourcePanelDownload,
  options: SourcePanelOptions = {},
): boolean => {
  const existing = activePanelHost?.isConnected ? activePanelHost : null;
  if (!existing || existing.classList.contains("closing")) return false;
  panelUpdates.get(existing)?.(sendDownload, options);
  return !existing.classList.contains("closing");
};

export const setSourcePanelOpen = (
  open: boolean,
  sendDownload: SourcePanelDownload,
  options: SourcePanelOptions = {},
): boolean => {
  const existing = activePanelHost?.isConnected ? activePanelHost : null;
  if (existing?.classList.contains("closing")) {
    return open ? toggleSourcePanel(sendDownload, options) : false;
  }
  if (open === Boolean(existing)) return open;
  return toggleSourcePanel(sendDownload, options);
};

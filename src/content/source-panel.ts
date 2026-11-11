import type { SourcePanelOptions } from "./source-panel-model.ts";
import type { PageSourceKind } from "../shared/page-source.ts";
export { resetSourcePanelLayoutForTesting } from "./source-panel-layout.ts";
import { loadSourceSort } from "./source-panel-layout.ts";
import { resolvedPanelTheme } from "./source-panel-format.ts";
import {
  PANEL_HOST_ID,
  panelCleanups,
  panelOpenChanges,
  panelPreviousFocus,
  panelRoots,
  panelUpdates,
  panelScriptMedia,
  activePanelHost,
  setActivePanelHost,
  cancelPanelRemoval,
  cleanupPanelHost,
  closePanelHost,
  type SourcePanelDownload,
} from "./source-panel-host.ts";
export { getSourcePanelHostForTesting, type SourcePanelDownload } from "./source-panel-host.ts";
import { createSourcePanelContext } from "./source-panel-context.ts";
import { wirePanelMenus } from "./source-panel-menus.ts";
import { wirePanelResize } from "./source-panel-resize.ts";
import { wirePanelHeader } from "./source-panel-header.ts";
import { wirePanelFilterSort } from "./source-panel-filter-sort.ts";
import { wirePanelPreview } from "./source-panel-preview.ts";
import { wirePanelSelection } from "./source-panel-selection.ts";
import { wirePanelRowRender } from "./source-panel-row-render.ts";
import { wirePanelRefresh } from "./source-panel-refresh.ts";
import { wirePanelViewportLock } from "./source-panel-viewport-lock.ts";
import { buildPanelUpdate } from "./source-panel-update.ts";
import SOURCE_PANEL_TOKENS_CSS from "./source-panel-tokens.css";
import SOURCE_PANEL_THEMES_CSS from "./source-panel-themes.css";
import SOURCE_PANEL_THEMES_PREMIUM_CSS from "./source-panel-themes-premium.css";
import SOURCE_PANEL_CSS from "./source-panel.css";
import SOURCE_PANEL_CONTROLS_CSS from "./source-panel-controls.css";
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

// Firefox destroys a content script's context when the extension updates but
// leaves the DOM it built, then injects a fresh script. The old panel is then a
// dead sheet nothing can close, and below 480px its scroll lock stays on the
// page. This instance never owned it, so it can only be removed. The selector
// names the exact shape and place Save In builds, because a page may own an
// unrelated element with the same id and that one must be left alone.
const reclaimOrphanedPanelHosts = (): void => {
  const orphans = [
    ...document.querySelectorAll(`:root > aside#${PANEL_HOST_ID}[data-theme]`),
  ].filter((orphan) => orphan !== activePanelHost);
  if (orphans.length === 0) return;
  orphans.forEach((orphan) => orphan.remove());
  const root = document.documentElement;
  if (
    root.style.getPropertyValue("overflow") === "hidden" &&
    root.style.getPropertyPriority("overflow") === "important"
  ) {
    root.style.removeProperty("overflow");
  }
};

// toggleSourcePanel builds one SourcePanelContext per panel instance and
// hands it to a fixed sequence of builders, each owning a cohesive slice of
// DOM/behavior (menus, resize, header, filter/sort, preview, selection, row
// rendering, source refresh, viewport lock). Builders run synchronously and
// in dependency order — e.g. wirePanelHeader calls ctx.applyLayout(), so
// wirePanelResize must run first — before any panel event can fire, so a
// builder that reads a ctx field another builder owns (assigned later in
// this function but always before the return) is safe. See
// source-panel-context.ts for why the context is one mutable object rather
// than per-builder parameters/return values.
export const toggleSourcePanel = (
  sendDownload: SourcePanelDownload,
  options: SourcePanelOptions = {},
  // An ambient restore (the panel was left open and another page loaded) must
  // not pull focus off the page's own autofocused field on every navigation.
  takeFocus = true,
): boolean => {
  if (activePanelHost && !activePanelHost.isConnected) cleanupPanelHost(activePanelHost);
  const existing = activePanelHost;
  if (existing) {
    if (existing.classList.contains("closing")) {
      cancelPanelRemoval(existing);
      existing.classList.remove("closing");
      panelOpenChanges.get(existing)?.(true);
      if (takeFocus) {
        panelRoots.get(existing)?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
      }
      return true;
    }
    return closePanelHost(existing);
  }
  if (options.enabled === false) return false;
  reclaimOrphanedPanelHosts();
  const initialOptions = { ...options };

  const host = document.createElement("aside");
  const previousFocus = document.activeElement;
  if (previousFocus instanceof HTMLElement) panelPreviousFocus.set(host, previousFocus);
  host.id = PANEL_HOST_ID;
  host.dataset.theme = resolvedPanelTheme(initialOptions.theme);
  const exposeShadowForTests = SAVE_IN_CONTENT_E2E === true;
  const shadow = host.attachShadow({ mode: exposeShadowForTests ? "open" : "closed" });
  panelRoots.set(host, shadow);
  panelOpenChanges.set(host, initialOptions.onOpenChange || (() => {}));
  setActivePanelHost(host);
  const style = document.createElement("style");
  style.textContent = [
    SOURCE_PANEL_TOKENS_CSS,
    SOURCE_PANEL_THEMES_CSS,
    SOURCE_PANEL_THEMES_PREMIUM_CSS,
    SOURCE_PANEL_CSS,
    SOURCE_PANEL_CONTROLS_CSS,
    SOURCE_PANEL_RESULTS_CSS,
    SOURCE_PANEL_RESPONSIVE_CSS,
    SOURCE_PANEL_PREVIEW_CSS,
  ].join("\n");
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.setAttribute("role", "dialog");
  const list = document.createElement("ul");
  list.className = "list";
  list.setAttribute("role", "list");
  const liveStatus = document.createElement("div");
  liveStatus.className = "visually-hidden live-status";
  liveStatus.setAttribute("role", "status");
  liveStatus.setAttribute("aria-live", "polite");
  const announce = (message: string) => {
    liveStatus.textContent = message;
  };

  const ctx = createSourcePanelContext(
    host,
    shadow,
    panel,
    list,
    liveStatus,
    announce,
    initialOptions,
  );
  panel.setAttribute("aria-label", ctx.copy.title);
  ctx.panelSendDownload = sendDownload;

  // Dependency order: menus/resize before header (header wires the dock
  // picker through both and calls applyLayout once); filter-sort, preview,
  // and selection before row-render (row-render reads their ctx fields);
  // refresh after row-render (refresh calls ctx.render/reads
  // ctx.highlightedElements).
  wirePanelMenus(ctx);
  wirePanelResize(ctx);
  wirePanelHeader(ctx);
  wirePanelFilterSort(ctx);
  wirePanelPreview(ctx);
  wirePanelSelection(ctx);
  wirePanelRowRender(ctx);
  wirePanelRefresh(ctx);

  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (ctx.closeOpenMenus()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    ctx.closePanel();
  });

  // Key events are composed and retargeted to the host, so a page hotkey
  // handler that exempts INPUT targets does not exempt the panel's filter box:
  // typing there paused videos and ran site shortcuts. Registered after the
  // panel's own handlers, in the bubble phase, so those still run first.
  (["keydown", "keypress", "keyup"] as const).forEach((type) =>
    panel.addEventListener(type, (event) => event.stopPropagation()),
  );

  panel.append(
    ctx.resize,
    ctx.header,
    ctx.toolbar,
    ctx.facets,
    ctx.selectionBar,
    liveStatus,
    list,
    ctx.batchDialog,
  );
  shadow.append(style, panel);
  document.documentElement.append(host);
  wirePanelViewportLock(ctx);
  ctx.panelOptions.onOpenChange?.(true);

  panelCleanups.set(host, () => ctx.cleanupTasks.forEach((task) => task()));
  panelUpdates.set(host, buildPanelUpdate(ctx));
  panelScriptMedia.set(host, ctx.addScriptMediaSources);

  ctx.configureLiveObservers();
  ctx.resyncResourceTiming();
  ctx.refreshSources();
  loadSourceSort(ctx.applyStoredSortPreference);
  if (takeFocus) ctx.filter.focus();
  return true;
};

// Merge opt-in script-loaded media (from the background webRequest collector)
// into the live panel, if one is open. No-ops when the panel is closed; the
// background replays the tab's buffer on the next SOURCE_PANEL_STATE open.
export const mergeScriptMediaSources = (
  sources: Array<{ url: string; kind: PageSourceKind }>,
): void => {
  const host = activePanelHost?.isConnected ? activePanelHost : null;
  if (host) panelScriptMedia.get(host)?.(sources);
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
    return open ? toggleSourcePanel(sendDownload, options, false) : false;
  }
  if (open === Boolean(existing)) return open;
  return toggleSourcePanel(sendDownload, options, false);
};

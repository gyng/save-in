import type { SourcePanelOptions } from "./source-panel-model.ts";
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

  ctx.configureLiveObservers();
  ctx.resyncResourceTiming();
  ctx.refreshSources();
  loadSourceSort(ctx.applyStoredSortPreference);
  ctx.filter.focus();
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

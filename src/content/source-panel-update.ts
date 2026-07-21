import { DEFAULT_SOURCE_PANEL_COPY } from "../shared/source-panel-copy.ts";
import type { SourcePanelOptions } from "./source-panel-model.ts";
import { getPanelFormatters, resolvedPanelTheme } from "./source-panel-format.ts";
import { closePanelHost, panelOpenChanges, type SourcePanelDownload } from "./source-panel-host.ts";
import type { SourcePanelContext } from "./source-panel-context.ts";

/** Re-applies every static copy string across the panel (header, toolbar,
 * selection bar, dock picker) after a locale/copy change. Lives beside the
 * options-diffing update path because that is its only caller. */
const applyStaticCopy = (ctx: SourcePanelContext) => {
  const { copy } = ctx;
  ctx.panel.setAttribute("aria-label", copy.title);
  ctx.title.textContent = copy.title;
  ctx.resize.setAttribute("aria-label", copy.resizeLabel);
  ctx.close.title = copy.close;
  ctx.close.setAttribute("aria-label", copy.closeLabel);
  ctx.dockButton.setAttribute("aria-label", copy.changeDockLabel);
  ctx.copyUrls.setAttribute("aria-label", copy.copyFilteredUrlsLabel);
  ctx.copyUrls.title = copy.copyFilteredUrls;
  ctx.selectFiltered.textContent = copy.selectFiltered;
  ctx.clearSelection.textContent = copy.clearSelection;
  ctx.saveSelected.textContent = copy.saveSelected;
  ctx.cancelBatch.textContent = copy.batchCancel;
  ctx.continueBatch.textContent = copy.batchContinue;
  ctx.filter.placeholder = copy.filterSources;
  ctx.filter.setAttribute("aria-label", copy.filterLabel);
  ctx.sort.setAttribute("aria-label", copy.sortLabel);
  [...ctx.sort.options].forEach((option, index) => {
    const entry = ctx.sortOptions[index] as (typeof ctx.sortOptions)[number];
    option.textContent = copy.sort[entry[1]];
  });
  ctx.placementButtons.forEach((button, placement) => {
    button.textContent = copy.dockPositions[placement];
  });
  ctx.updatePlacementControls();
};

/** The options-diffing update path behind replaceSourcePanel/
 * setSourcePanelOpen: diffs the incoming options against the panel's
 * current ones and does the minimum work each change requires (re-observe,
 * re-render, or just relabel). */
export const buildPanelUpdate = (
  ctx: SourcePanelContext,
): ((sendDownload: SourcePanelDownload, options: SourcePanelOptions) => void) => {
  return (nextSendDownload, nextOptions) => {
    const previousOptions = ctx.panelOptions;
    ctx.panelOptions = { ...nextOptions };
    const nextCopy = ctx.panelOptions.copy || DEFAULT_SOURCE_PANEL_COPY;
    const copyChanged = nextCopy !== ctx.copy || ctx.panelOptions.locale !== previousOptions.locale;
    ctx.copy = nextCopy;
    ctx.formatters = getPanelFormatters(ctx.panelOptions.locale);
    ctx.host.dataset.theme = resolvedPanelTheme(ctx.panelOptions.theme);
    ctx.panelSendDownload = nextSendDownload;
    panelOpenChanges.set(ctx.host, ctx.panelOptions.onOpenChange || (() => {}));
    if (ctx.panelOptions.enabled === false) {
      closePanelHost(ctx.host);
      return;
    }
    const discoveryChanged = (
      ["includeBackgrounds", "resourceHints", "includeLinks"] as const
    ).some((key) => previousOptions[key] !== ctx.panelOptions[key]);
    const observerConfigChanged =
      previousOptions.live !== ctx.panelOptions.live || discoveryChanged;
    if (observerConfigChanged) ctx.configureLiveObservers();
    const previewsChanged = previousOptions.previews !== ctx.panelOptions.previews;
    if (previewsChanged || copyChanged) {
      ctx.rowCache.forEach((cached) => ctx.deactivateAndRemove(cached));
      ctx.rowCache.clear();
    }
    if (copyChanged) applyStaticCopy(ctx);
    const liveEnabled = previousOptions.live === false && ctx.panelOptions.live !== false;
    if (discoveryChanged || liveEnabled) {
      ctx.refreshSources();
      return;
    }
    if (previewsChanged || copyChanged) ctx.render();
  };
};

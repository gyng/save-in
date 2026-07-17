import {
  SOURCE_PANEL_COPY_VALUE_SLOT,
  formatSourcePanelCopy,
} from "../shared/source-panel-copy.ts";
import type { PageSource } from "./source-panel-model.ts";
import type { SourcePanelContext } from "./source-panel-context.ts";

/** Multi-select: the selection bar, click-and-drag checkbox painting, the
 * large-batch confirmation dialog, and the batch save loop. */
export const wirePanelSelection = (ctx: SourcePanelContext): void => {
  const selectionBar = document.createElement("div");
  selectionBar.className = "selection-bar";
  selectionBar.setAttribute("role", "group");
  selectionBar.setAttribute("aria-label", ctx.copy.saveSelected);
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
  batchDialog.setAttribute("aria-label", ctx.copy.batchContinue);
  batchDialog.setAttribute("aria-describedby", batchQuestion.id);
  const batchDialogActions = document.createElement("div");
  batchDialogActions.className = "batch-dialog-actions";
  const cancelBatch = document.createElement("button");
  cancelBatch.type = "button";
  const continueBatch = document.createElement("button");
  continueBatch.type = "button";
  continueBatch.className = "primary-action";
  selectFiltered.textContent = ctx.copy.selectFiltered;
  clearSelection.textContent = ctx.copy.clearSelection;
  saveSelected.textContent = ctx.copy.saveSelected;
  cancelBatch.textContent = ctx.copy.batchCancel;
  continueBatch.textContent = ctx.copy.batchContinue;
  batchDialogActions.append(cancelBatch, continueBatch);
  batchDialog.append(batchQuestion, batchDialogActions);

  const updateSelectionUi = () => {
    const count = ctx.selectedSourceUrls.size;
    selectedCount.textContent = formatSourcePanelCopy(
      ctx.copy.selectedCountTemplate,
      SOURCE_PANEL_COPY_VALUE_SLOT,
      count,
    );
    const visibleUrls = new Set(ctx.visibleSources.map(({ url }) => url));
    const hiddenCount = [...ctx.selectedSourceUrls].filter((url) => !visibleUrls.has(url)).length;
    hiddenSelectedCount.hidden = hiddenCount === 0;
    hiddenSelectedCount.textContent = hiddenCount
      ? formatSourcePanelCopy(
          ctx.copy.hiddenSelectedCountTemplate,
          SOURCE_PANEL_COPY_VALUE_SLOT,
          hiddenCount,
        )
      : "";
    const hasSelection = count > 0;
    selectionBar.hidden = !hasSelection && ctx.visibleSources.length === 0;
    selectionBar.dataset.hasSelection = String(hasSelection);
    selectionCount.hidden = !hasSelection;
    selectFiltered.hidden = hasSelection;
    clearSelection.hidden = !hasSelection;
    saveSelected.hidden = !hasSelection;
    clearSelection.disabled = ctx.batchSaving;
    saveSelected.disabled = ctx.batchSaving;
    selectFiltered.disabled = ctx.batchSaving || ctx.visibleSources.length === 0;
    selectionBar.setAttribute("aria-busy", String(ctx.batchSaving));
    ctx.list.inert = ctx.batchSaving;
    ctx.list.setAttribute("aria-busy", String(ctx.batchSaving));
  };
  const updateAllSelectionRows = () => {
    ctx.rowCache.forEach((cached, url) =>
      cached.updateSelection(ctx.selectedSourceUrls.has(url), ctx.batchSaving),
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
    delete ctx.panel.dataset.selecting;
    document.removeEventListener("pointermove", moveSelectionPaint, true);
    document.removeEventListener("pointerup", finishSelectionPaint, true);
    document.removeEventListener("pointercancel", finishSelectionPaint, true);
    if (origin) window.setTimeout(() => ctx.suppressedSelectionClicks.delete(origin));
  };
  const paintSelection = (input: HTMLInputElement) => {
    const url = input.dataset.sourceUrl;
    if (!selectionPaint || !url || selectionPaint.visited.has(url)) return;
    selectionPaint.visited.add(url);
    if (selectionPaint.selected) ctx.selectedSourceUrls.add(url);
    else ctx.selectedSourceUrls.delete(url);
    ctx.rowCache.get(url)?.updateSelection(ctx.selectedSourceUrls.has(url), ctx.batchSaving);
    updateSelectionUi();
  };
  const selectionInputAt = (event: PointerEvent): HTMLInputElement | null => {
    const hit = ctx.shadow.elementFromPoint?.(event.clientX, event.clientY);
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
    const count = ctx.selectedSourceUrls.size;
    clearSelectionPaint();
    ctx.announce(
      formatSourcePanelCopy(ctx.copy.selectedCountTemplate, SOURCE_PANEL_COPY_VALUE_SLOT, count),
    );
  };
  const startSelectionPaint = (event: PointerEvent, input: HTMLInputElement) => {
    if (ctx.batchSaving || selectionPaint || event.button !== 0) return;
    const url = input.dataset.sourceUrl;
    if (!url) return;
    event.preventDefault();
    selectionPaint = {
      origin: input,
      pointerId: event.pointerId,
      selected: !ctx.selectedSourceUrls.has(url),
      visited: new Set(),
    };
    ctx.panel.dataset.selecting = selectionPaint.selected ? "select" : "clear";
    ctx.suppressedSelectionClicks.add(input);
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
      ctx.copy.batchConfirmTemplate,
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
    const sources = ctx.allSources.filter(({ url }) => ctx.selectedSourceUrls.has(url));
    if (sources.length === 0 || !(await confirmLargeBatch(sources.length))) return;
    ctx.batchSaving = true;
    updateSelectionUi();
    updateAllSelectionRows();
    ctx.panelOptions.onSaveIntent?.();
    let started = 0;
    const failed: PageSource[] = [];
    for (const [index, source] of sources.entries()) {
      saveSelected.textContent = formatSourcePanelCopy(
        ctx.copy.batchSavingTemplate,
        SOURCE_PANEL_COPY_VALUE_SLOT,
        `${index + 1}/${sources.length}`,
      );
      try {
        if ((await ctx.panelSendDownload(source)) !== false) started += 1;
        else failed.push(source);
      } catch {
        failed.push(source);
      }
    }
    ctx.batchSaving = false;
    ctx.selectedSourceUrls.clear();
    failed.forEach(({ url }) => {
      if (ctx.allSources.some((source) => source.url === url)) ctx.selectedSourceUrls.add(url);
    });
    saveSelected.textContent = ctx.copy.saveSelected;
    updateSelectionUi();
    updateAllSelectionRows();
    ctx.announce(
      formatSourcePanelCopy(ctx.copy.batchSavedTemplate, SOURCE_PANEL_COPY_VALUE_SLOT, started),
    );
  };
  selectFiltered.addEventListener("click", () => {
    ctx.visibleSources.forEach(({ url }) => ctx.selectedSourceUrls.add(url));
    updateSelectionUi();
    updateAllSelectionRows();
  });
  clearSelection.addEventListener("click", () => {
    ctx.selectedSourceUrls.clear();
    updateSelectionUi();
    updateAllSelectionRows();
  });
  saveSelected.addEventListener("click", () => void saveSelectedSources());

  ctx.selectionBar = selectionBar;
  ctx.batchDialog = batchDialog;
  ctx.selectFiltered = selectFiltered;
  ctx.clearSelection = clearSelection;
  ctx.saveSelected = saveSelected;
  ctx.cancelBatch = cancelBatch;
  ctx.continueBatch = continueBatch;
  ctx.startSelectionPaint = startSelectionPaint;
  ctx.updateSelectionUi = updateSelectionUi;
  ctx.updateAllSelectionRows = updateAllSelectionRows;
  ctx.cleanupTasks.push(clearSelectionPaint);
};

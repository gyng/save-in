// Composition root for the options page's history panel: it wires the table,
// filters, columns, and toolbar together and owns nothing else.
//
// The panel's pieces each own one concern — history-model.ts (pure row/sort/
// format logic), history-panel-state.ts (view state), history-table.ts +
// history-row.ts (rendering), history-filters.ts, history-columns.ts,
// history-toolbar.ts, history-actions.ts (row actions), history-progress.ts
// (live download polling), and history-refresh.ts (the background round trip).
//
// renderHistory, setHistoryLocalizer, and showClearHistoryDialog are
// re-exported because entries/options.ts, core/options.ts, and the panel tests
// import them from this path; that import path is a preserved contract.

import {
  clearHistoryColumnOptionLabels,
  reloadVisibleHistoryColumns,
  setupHistoryColumnOptions,
} from "./history-columns.ts";
import { setupHistoryFilters } from "./history-filters.ts";
import { resetHistoryPanelState } from "./history-panel-state.ts";
import { stopHistoryProgress } from "./history-progress.ts";
import { setHistoryTableRenderer } from "./history-refresh.ts";
import { renderHistoryTable } from "./history-table.ts";
import { setupHistoryToolbar, updateHistoryActionAvailability } from "./history-toolbar.ts";

export { renderHistory } from "./history-refresh.ts";
export { setHistoryLocalizer } from "./history-messages.ts";
export { showClearHistoryDialog } from "./history-clear-dialog.ts";

// history-refresh.ts cannot import the table it repaints without creating a
// cycle, so the composition root is the one place that connects them.
setHistoryTableRenderer(renderHistoryTable);

export const setupHistoryPanel = (): void => {
  stopHistoryProgress();
  resetHistoryPanelState();
  reloadVisibleHistoryColumns();
  clearHistoryColumnOptionLabels();
  updateHistoryActionAvailability(false);

  setupHistoryFilters(renderHistoryTable);
  setupHistoryColumnOptions(renderHistoryTable);
  setupHistoryToolbar();
};

setupHistoryPanel();

// The controls above the table: export, clear, and the availability of both.
//
// Export and clear are meaningless with no entries, so every control marked
// [data-history-requires-entries] is disabled together — by the table after a
// repaint, and by the clear path once it knows what survived.

import { webExtensionApi } from "../../platform/web-extension-api.ts";
import { sendInternalMessage } from "../../platform/messaging.ts";
import { MESSAGE_TYPES } from "../../shared/constants.ts";
import { closeDetailsAndRestoreFocus } from "../ui/dismissible-details.ts";
import { historyCsv, historyTsv } from "./history-model.ts";
import { historyColumns, historyMessage } from "./history-messages.ts";
import { historyState } from "./history-panel-state.ts";
import { historyFeedback, renderHistoryFeedback } from "./history-feedback.ts";
import { renderHistory } from "./history-refresh.ts";
import { showClearHistoryDialog } from "./history-clear-dialog.ts";

export const updateHistoryActionAvailability = (hasEntries: boolean): void => {
  document.querySelectorAll<HTMLElement>("[data-history-requires-entries]").forEach((control) => {
    // A <details> menu cannot be disabled; inert takes it out of play instead.
    if (control instanceof HTMLButtonElement) control.disabled = !hasEntries;
    else control.inert = !hasEntries;
    if (hasEntries) control.removeAttribute("aria-disabled");
    else control.setAttribute("aria-disabled", "true");
  });
};

type ExportFormat = "json" | "csv" | "tsv";

const EXPORT_MIME: Record<ExportFormat, string> = {
  json: "application/json",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
};

const exportContent = (format: ExportFormat): string =>
  format === "json"
    ? JSON.stringify(historyState.entries, null, 2)
    : format === "tsv"
      ? historyTsv(historyState.entries, historyColumns())
      : historyCsv(historyState.entries, historyColumns());

// Exports the whole cached history, not the filtered page: the file is a
// backup of what is stored, and the filters are a way to look at it.
const downloadHistoryExport = (format: ExportFormat): void => {
  const url = URL.createObjectURL(new Blob([exportContent(format)], { type: EXPORT_MIME[format] }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `save-in-history.${format}`;
  link.click();
  URL.revokeObjectURL(url);
};

const removeHistory = async (): Promise<void> => {
  const clearButton = document.querySelector<HTMLButtonElement>("#history-clear");
  if (clearButton) clearButton.disabled = true;
  renderHistoryFeedback(historyFeedback(), {
    message: historyMessage("historyClearing", "Deleting history…"),
  });
  try {
    const response = await sendInternalMessage(webExtensionApi.runtime, {
      type: MESSAGE_TYPES.HISTORY_CLEAR,
    });
    if (response?.type !== MESSAGE_TYPES.OK) throw new Error("History clear failed");
    await renderHistory();
  } catch {
    renderHistoryFeedback(historyFeedback(), {
      message: historyMessage("historyClearFailed", "Could not delete history."),
      error: true,
      actionLabel: historyMessage("historyRetry", "Retry"),
      onAction: () => void removeHistory(),
    });
  } finally {
    updateHistoryActionAvailability(historyState.entries.length > 0);
  }
};

const clearHistory = async (): Promise<void> => {
  if (await showClearHistoryDialog()) await removeHistory();
};

export const setupHistoryToolbar = (): void => {
  for (const format of ["json", "csv", "tsv"] as const) {
    const button = document.querySelector<HTMLButtonElement>(`#history-export-${format}`);
    button?.addEventListener("click", () => {
      downloadHistoryExport(format);
      const menu = button.closest<HTMLDetailsElement>(".history-export-menu");
      if (menu) closeDetailsAndRestoreFocus(menu);
    });
  }
  document.querySelector("#history-clear")?.addEventListener("click", () => void clearHistory());
};

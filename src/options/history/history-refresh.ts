// The reload seam: fetch history from the background and repaint.
//
// The table, its row actions, and the progress poller all need to trigger a
// reload, and renderHistory needs to repaint the table — importing
// history-table.ts back would be a cycle check-import-cycles.js forbids. So the
// table registers itself here through an owner-controlled live binding (the
// activePanelHost pattern in content/source-panel-host.ts) and everything else
// imports this leaf. history-panel.ts is the sole registrar.

import { webExtensionApi } from "../../platform/web-extension-api.ts";
import { sendInternalMessage } from "../../platform/messaging.ts";
import { MESSAGE_TYPES } from "../../shared/constants.ts";
import { normalizeHistory } from "../../shared/history-normalization.ts";
import { historyFeedback, renderHistoryFeedback } from "./history-feedback.ts";
import { historyMessage } from "./history-messages.ts";
import { historyState } from "./history-panel-state.ts";

/* v8 ignore next -- Placeholder overwritten by history-panel.ts at import, before any call site can run. */
let renderTable: () => void = () => {};

export const setHistoryTableRenderer = (render: () => void): void => {
  renderTable = render;
};

export const renderHistory = async (): Promise<void> => {
  try {
    const response = await sendInternalMessage(webExtensionApi.runtime, {
      type: MESSAGE_TYPES.HISTORY_GET,
    });
    const entries = "entries" in response.body ? response.body.entries : undefined;
    if (!Array.isArray(entries)) throw new Error("Invalid history response");
    historyState.entries = normalizeHistory(entries).toReversed(); // newest first
    renderHistoryFeedback(historyFeedback());
    renderTable();
  } catch {
    renderHistoryFeedback(historyFeedback(), {
      message: historyMessage("historyLoadFailed", "Could not load history."),
      error: true,
      actionLabel: historyMessage("historyRetry", "Retry"),
      onAction: () => void renderHistory(),
    });
  }
};

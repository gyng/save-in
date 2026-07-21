// The confirm-before-deleting-everything modal. Built on demand so it can
// return focus to whichever History control opened it.
import { showHistoryConfirmDialog } from "./history-confirm-dialog.ts";
import { historyMessage } from "./history-messages.ts";

export const showClearHistoryDialog = (): Promise<boolean> =>
  showHistoryConfirmDialog({
    className: "history-clear-dialog",
    id: "history-clear-dialog",
    title: historyMessage("historyDeleteConfirmTitle", "Delete all history?"),
    description: historyMessage(
      "historyDeleteConfirmDescription",
      "This permanently deletes every saved history entry. This cannot be undone.",
    ),
    cancel: historyMessage("historyKeepHistory", "Keep history"),
    confirm: historyMessage("historyDeleteAll", "Delete all history"),
  });

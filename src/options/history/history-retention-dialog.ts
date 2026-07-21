import { showHistoryConfirmDialog } from "./history-confirm-dialog.ts";
import { historyMessage } from "./history-messages.ts";

export const showHistoryRetentionDialog = (): Promise<boolean> =>
  showHistoryConfirmDialog({
    className: "history-retention-dialog",
    id: "history-retention-dialog",
    title: historyMessage("historyRetentionConfirmTitle", "Lower History limit?"),
    description: historyMessage(
      "historyRetentionConfirmDescription",
      "Older finished entries above the new limit will be permanently deleted. Active saves are kept. This cannot be undone.",
    ),
    cancel: historyMessage("historyRetentionKeepLimit", "Keep current limit"),
    confirm: historyMessage("historyRetentionLowerLimit", "Lower limit"),
  });

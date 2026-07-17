// What a history row's buttons actually do. Every action reports its outcome
// through the feedback area and leaves the row in place: undo and move mark the
// entry rather than deleting it, so a failure or a file-already-gone case can
// still be reported against a surviving row.

import { webExtensionApi } from "../../platform/web-extension-api.ts";
import { sendInternalMessage } from "../../platform/messaging.ts";
import { MESSAGE_TYPES } from "../../shared/constants.ts";
import { buildTree } from "../../menus/menu-tree.ts";
import { splitLines } from "../../shared/util.ts";
import { historyFeedback, renderHistoryFeedback } from "./history-feedback.ts";
import { historyMessage } from "./history-messages.ts";
import { renderHistory } from "./history-refresh.ts";

// Opens the containing folder for a completed download (best-effort; the
// browser may have forgotten the download)
export const showInFolder = async (downloadId: number | null): Promise<void> => {
  if (downloadId == null || !webExtensionApi.downloads || !webExtensionApi.downloads.show) {
    renderHistoryFeedback(historyFeedback(), {
      message: historyMessage(
        "historyShowFolderUnavailable",
        "Could not open the folder. This browser no longer knows the download.",
      ),
      error: true,
    });
    return;
  }
  try {
    await webExtensionApi.downloads.show(downloadId);
    renderHistoryFeedback(historyFeedback());
  } catch {
    renderHistoryFeedback(historyFeedback(), {
      message: historyMessage(
        "historyShowFolderFailed",
        "Could not open the folder. The file may have moved or been removed.",
      ),
      error: true,
    });
  }
};

export const undoSave = async (historyId: string): Promise<void> => {
  try {
    const response = await sendInternalMessage(webExtensionApi.runtime, {
      type: MESSAGE_TYPES.HISTORY_UNDO,
      body: { historyId },
    });
    // The protocol error variant shares the response type; the body's shape
    // is the discriminant
    if (
      response.type !== MESSAGE_TYPES.HISTORY_UNDO ||
      !("undone" in response.body) ||
      !response.body.undone
    ) {
      renderHistoryFeedback(historyFeedback(), {
        message: historyMessage("historyUndoFailed", "Could not undo this save."),
        error: true,
      });
      return;
    }
    // Re-render first: renderHistory clears the feedback area, so the
    // outcome message must land after the refreshed rows
    await renderHistory();
    renderHistoryFeedback(historyFeedback(), {
      message: response.body.fileMissing
        ? historyMessage(
            "historyUndoFileMissing",
            "Save undone. The file had already been moved or removed.",
          )
        : historyMessage("historyUndoDone", "Save undone. The file was removed."),
    });
  } catch {
    renderHistoryFeedback(historyFeedback(), {
      message: historyMessage("historyUndoFailed", "Could not undo this save."),
      error: true,
    });
  }
};

// The reroute destinations mirror the configured menu directories: the paths
// textarea is the same source the menu preview reads, so no background
// round-trip is needed. Downloads root is always offered.
export const rerouteDestinations = (): { dir: string; title: string }[] => {
  const textarea = document.querySelector<HTMLTextAreaElement>("#paths");
  const tree = buildTree(splitLines(textarea?.value ?? ""));
  const dirs = new Map<string, string>([
    [".", historyMessage("historyMoveDownloadsRoot", "Downloads")],
  ]);
  for (const item of tree.items) {
    if (item.kind === "path" && !dirs.has(item.parsedDir)) {
      dirs.set(item.parsedDir, item.title);
    }
  }
  return [...dirs].map(([dir, title]) => ({ dir, title }));
};

// A move is honestly a re-download to the new folder plus a verified removal
// of the original — the downloads API has no filesystem move. The original
// row is marked, never deleted, so both outcomes stay auditable.
export const rerouteSave = async (historyId: string, destination: string): Promise<void> => {
  try {
    const response = await sendInternalMessage(webExtensionApi.runtime, {
      type: MESSAGE_TYPES.HISTORY_REROUTE,
      body: { historyId, destination },
    });
    if (
      response.type !== MESSAGE_TYPES.HISTORY_REROUTE ||
      !("rerouted" in response.body) ||
      !response.body.rerouted
    ) {
      renderHistoryFeedback(historyFeedback(), {
        message: historyMessage("historyMoveFailed", "Could not move this save."),
        error: true,
      });
      return;
    }
    // Re-render first: renderHistory clears the feedback area, so the
    // outcome message must land after the refreshed rows
    await renderHistory();
    renderHistoryFeedback(historyFeedback(), {
      message: response.body.pending
        ? historyMessage(
            "historyMovePending",
            "Downloading to the new folder. The original will be removed after it completes.",
          )
        : response.body.oldRemoved
          ? historyMessage(
              "historyMoveDone",
              "Save moved. The file was downloaded to the new folder.",
            )
          : historyMessage(
              "historyMoveOriginalKept",
              "Saved to the new folder. The original file could not be removed.",
            ),
      ...(response.body.oldRemoved || response.body.pending ? {} : { error: true }),
    });
  } catch {
    renderHistoryFeedback(historyFeedback(), {
      message: historyMessage("historyMoveFailed", "Could not move this save."),
      error: true,
    });
  }
};

export const cancelSave = async (historyId: string): Promise<void> => {
  await sendInternalMessage(webExtensionApi.runtime, {
    type: MESSAGE_TYPES.HISTORY_CANCEL,
    body: { historyId },
  });
  await renderHistory();
};

export const copyHistoryValue = async (value: string, successMessage: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(value);
    renderHistoryFeedback(historyFeedback(), { message: successMessage });
  } catch {
    renderHistoryFeedback(historyFeedback(), {
      message: historyMessage("historyCopyFailed", "Could not copy to the clipboard."),
      error: true,
    });
  }
};

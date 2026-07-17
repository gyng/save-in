// The status cell: the status badge plus the row's per-entry actions.
//
// Each action is gated on what the entry can still support. Show in folder and
// undo both need a completed save the browser still knows (a download id);
// move additionally needs the recorded source URL, because it re-downloads.

import type { HistoryRow } from "../../shared/history-types.ts";
import { statusClass, statusLabel } from "./history-model.ts";
import { historyLocalize, historyMessage } from "./history-messages.ts";
import { folderIcon, historyActionIcon } from "./history-icons.ts";
import {
  cancelSave,
  copyHistoryValue,
  rerouteDestinations,
  rerouteSave,
  showInFolder,
  undoSave,
} from "./history-actions.ts";

const actionButton = (className: string, label: string, ariaLabel = label): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.title = label;
  button.setAttribute("aria-label", ariaLabel);
  return button;
};

const statusBadge = (row: HistoryRow): HTMLSpanElement => {
  const badge = document.createElement("span");
  badge.className = `status-pill status-badge ${statusClass(row.status)}`;
  badge.textContent = statusLabel(row.status, historyLocalize);
  badge.title = row.status;
  return badge;
};

const showInFolderButton = (row: HistoryRow): HTMLButtonElement => {
  const open = actionButton(
    "history-open",
    historyMessage("historyShowInFolder", "Show in folder"),
  );
  open.append(folderIcon());
  open.addEventListener("click", () => void showInFolder(row.downloadId));
  return open;
};

const undoButton = (row: HistoryRow, historyId: string): HTMLButtonElement => {
  const undo = actionButton(
    "history-open history-undo",
    historyMessage("historyUndoSave", "Undo save"),
    historyMessage("historyUndoSaveNamed", `Undo save of ${row.file}`, row.file),
  );
  undo.append(historyActionIcon("undo"));
  undo.addEventListener("click", () => {
    undo.disabled = true;
    void undoSave(historyId).finally(() => {
      undo.disabled = false;
    });
  });
  return undo;
};

// The destination picker is built on demand and toggles: a second click on the
// move button dismisses it rather than stacking another picker.
const openMovePicker = (
  status: HTMLTableCellElement,
  move: HTMLButtonElement,
  historyId: string,
): void => {
  const existing = status.querySelector(".history-move-picker");
  if (existing) {
    existing.remove();
    return;
  }
  const picker = document.createElement("span");
  picker.className = "history-move-picker";
  const select = document.createElement("select");
  select.setAttribute("aria-label", historyMessage("historyMoveDestination", "Destination folder"));
  for (const { dir, title } of rerouteDestinations()) {
    const option = document.createElement("option");
    option.value = dir;
    option.textContent = title;
    select.append(option);
  }
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "history-open history-move-confirm";
  confirm.textContent = historyMessage("historyMoveConfirm", "Move");
  confirm.addEventListener("click", () => {
    move.disabled = true;
    confirm.disabled = true;
    void rerouteSave(historyId, select.value).finally(() => {
      move.disabled = false;
      picker.remove();
    });
  });
  picker.append(select, confirm);
  status.append(picker);
  select.focus();
};

const moveButton = (
  row: HistoryRow,
  historyId: string,
  status: HTMLTableCellElement,
): HTMLButtonElement => {
  // The help text carries the honest mechanics: this is a re-download,
  // not a filesystem move.
  const move = actionButton(
    "history-open history-move",
    historyMessage("historyMoveSave", "Move save (downloads it again to the chosen folder)"),
    historyMessage("historyMoveSaveNamed", `Move save of ${row.file}`, row.file),
  );
  move.append(historyActionIcon("move"));
  move.addEventListener("click", () => openMovePicker(status, move, historyId));
  return move;
};

const copyButton = (
  className: string,
  label: string,
  icon: "copy" | "link",
  value: string,
  copiedMessage: string,
): HTMLButtonElement => {
  const copy = actionButton(className, label);
  copy.append(historyActionIcon(icon));
  copy.addEventListener("click", () => void copyHistoryValue(value, copiedMessage));
  return copy;
};

const cancelButton = (row: HistoryRow, historyId: string): HTMLButtonElement => {
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "history-cancel";
  cancel.textContent = historyMessage("historyCancelDownload", "Cancel");
  cancel.title = historyMessage("historyCancelDownloadTitle", "Cancel this download");
  cancel.setAttribute(
    "aria-label",
    historyMessage("historyCancelDownloadNamed", `Cancel ${row.file}`, row.file),
  );
  cancel.addEventListener("click", async () => {
    cancel.disabled = true;
    cancel.textContent = historyMessage("historyCancelingDownload", "Canceling…");
    try {
      await cancelSave(historyId);
    } catch {
      cancel.disabled = false;
      cancel.textContent = historyMessage("historyCancelDownload", "Cancel");
    }
  });
  return cancel;
};

export const buildHistoryStatusCell = (row: HistoryRow): HTMLTableCellElement => {
  const status = document.createElement("td");
  status.className = "history-status";
  status.append(statusBadge(row));

  const known = row.status === "complete" && row.downloadId != null;
  if (known) status.append(showInFolderButton(row));
  if (known && row.historyId) status.append(undoButton(row, row.historyId));
  if (row.reroutable && row.historyId) status.append(moveButton(row, row.historyId, status));
  if (row.fullPath) {
    status.append(
      copyButton(
        "history-open history-copy-path",
        historyMessage("historyCopyPath", "Copy saved path"),
        "copy",
        row.fullPath,
        historyMessage("historyPathCopied", "Saved path copied."),
      ),
    );
  }
  if (row.url) {
    status.append(
      copyButton(
        "history-open history-copy-source",
        historyMessage("historyCopySource", "Copy source URL"),
        "link",
        row.url,
        historyMessage("historySourceCopied", "Source URL copied."),
      ),
    );
  }
  if (row.status === "pending" && row.historyId) {
    status.append(cancelButton(row, row.historyId));
  }
  return status;
};

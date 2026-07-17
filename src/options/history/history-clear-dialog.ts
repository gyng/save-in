// The confirm-before-deleting-everything modal. Built on demand rather than
// declared in options.html because it is the only history dialog and it must
// return focus to whatever opened it.

import { historyMessage } from "./history-messages.ts";

export const showClearHistoryDialog = (): Promise<boolean> =>
  new Promise((resolve) => {
    const opener =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null;
    const dialog = document.createElement("dialog");
    dialog.className = "app-dialog history-clear-dialog";
    dialog.setAttribute("aria-labelledby", "history-clear-dialog-title");
    dialog.setAttribute("aria-describedby", "history-clear-dialog-description");

    const title = document.createElement("h2");
    title.id = "history-clear-dialog-title";
    title.textContent = historyMessage("historyDeleteConfirmTitle", "Delete all history?");
    const description = document.createElement("p");
    description.id = "history-clear-dialog-description";
    description.textContent = historyMessage(
      "historyDeleteConfirmDescription",
      "This permanently deletes every saved history entry. This cannot be undone.",
    );
    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = historyMessage("historyKeepHistory", "Keep history");
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "button-danger danger-button";
    confirm.textContent = historyMessage("historyDeleteAll", "Delete all history");
    actions.append(cancel, confirm);
    dialog.append(title, description, actions);
    document.body.append(dialog);

    const finish = (confirmed: boolean): void => {
      dialog.remove();
      if (opener?.isConnected) opener.focus();
      resolve(confirmed);
    };
    cancel.addEventListener("click", () => finish(false));
    confirm.addEventListener("click", () => finish(true));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(false);
    });
    // jsdom and older engines lack showModal; the open attribute still shows it.
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    cancel.focus();
  });

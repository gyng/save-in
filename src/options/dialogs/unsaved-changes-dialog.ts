import { getMessage } from "../../platform/localization.ts";

export type UnsavedChangesChoice = "discard" | "keep";

type GetMessage = (key: string) => string;

export const showUnsavedChangesDialog = (
  message: string,
  localize: GetMessage = getMessage,
): Promise<UnsavedChangesChoice> =>
  new Promise((resolve) => {
    const opener =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null;
    const dialog = document.createElement("dialog");
    dialog.className = "app-dialog unsaved-changes-dialog";
    dialog.setAttribute("aria-labelledby", "unsaved-changes-title");
    dialog.setAttribute("aria-describedby", "unsaved-changes-description");

    const title = document.createElement("h2");
    title.id = "unsaved-changes-title";
    title.textContent = localize("optionsEditorUnsaved") || "Unsaved changes";
    const body = document.createElement("p");
    body.id = "unsaved-changes-description";
    body.textContent = message;
    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    const keep = document.createElement("button");
    keep.type = "button";
    keep.textContent = localize("optionsKeepEditing") || "Keep editing";
    const discard = document.createElement("button");
    discard.type = "button";
    discard.className = "button-danger danger-button";
    discard.textContent = localize("optionsDiscardChanges") || "Discard changes";
    actions.append(keep, discard);
    dialog.append(title, body, actions);
    document.body.appendChild(dialog);

    const finish = (choice: UnsavedChangesChoice) => {
      dialog.remove();
      if (opener?.isConnected) opener.focus();
      resolve(choice);
    };
    keep.addEventListener("click", () => finish("keep"));
    discard.addEventListener("click", () => finish("discard"));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish("keep");
    });
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    keep.focus();
  });

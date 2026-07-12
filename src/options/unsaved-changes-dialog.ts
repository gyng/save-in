export type UnsavedChangesChoice = "discard" | "keep";

export const showUnsavedChangesDialog = (message: string): Promise<UnsavedChangesChoice> =>
  new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "unsaved-changes-dialog";
    dialog.setAttribute("aria-labelledby", "unsaved-changes-title");

    const title = document.createElement("h2");
    title.id = "unsaved-changes-title";
    title.textContent = "Unsaved changes";
    const body = document.createElement("p");
    body.textContent = message;
    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    const keep = document.createElement("button");
    keep.type = "button";
    keep.textContent = "Keep editing";
    const discard = document.createElement("button");
    discard.type = "button";
    discard.className = "danger-button";
    discard.textContent = "Discard changes";
    actions.append(keep, discard);
    dialog.append(title, body, actions);
    document.body.appendChild(dialog);

    const finish = (choice: UnsavedChangesChoice) => {
      dialog.remove();
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

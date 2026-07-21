type HistoryConfirmDialogOptions = {
  className: string;
  id: string;
  title: string;
  description: string;
  cancel: string;
  confirm: string;
};

export const showHistoryConfirmDialog = ({
  className,
  id,
  title: titleText,
  description: descriptionText,
  cancel: cancelText,
  confirm: confirmText,
}: HistoryConfirmDialogOptions): Promise<boolean> =>
  new Promise((resolve) => {
    const opener =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null;
    const dialog = document.createElement("dialog");
    dialog.className = "app-dialog " + className;
    dialog.setAttribute("aria-labelledby", `${id}-title`);
    dialog.setAttribute("aria-describedby", `${id}-description`);

    const title = document.createElement("h2");
    title.id = `${id}-title`;
    title.textContent = titleText;
    const description = document.createElement("p");
    description.id = `${id}-description`;
    description.textContent = descriptionText;
    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = cancelText;
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "button-danger danger-button";
    confirm.textContent = confirmText;
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
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    cancel.focus();
  });

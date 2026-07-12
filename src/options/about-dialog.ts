export const setupAboutDialog = () => {
  const dialog = document.querySelector<HTMLDialogElement>("#about-dialog");
  const open = document.querySelector<HTMLButtonElement>("#about-open");
  const close = dialog?.querySelector<HTMLButtonElement>(".about-close");
  if (!dialog || !open || !close) return;
  open.addEventListener("click", () => dialog.showModal());
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
};

setupAboutDialog();

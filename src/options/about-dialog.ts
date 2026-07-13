import { webExtensionApi } from "../platform/web-extension-api.ts";

export const setupAboutDialog = () => {
  const dialog = document.querySelector<HTMLDialogElement>("#about-dialog");
  const open = document.querySelector<HTMLButtonElement>("#about-open");
  const close = dialog?.querySelector<HTMLButtonElement>(".about-close");
  if (!dialog || !open || !close) return;
  open.addEventListener("click", () => {
    open.closest("details")?.removeAttribute("open");
    dialog.showModal();
  });
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  const version = webExtensionApi.runtime.getManifest().version;
  const versionEl = dialog.querySelector<HTMLElement>("#about-version");
  if (versionEl) versionEl.textContent = version ? `v${version}` : "Unavailable";

  const mascot = dialog.querySelector<HTMLButtonElement>(".about-mascot-button");
  let mascotClicks = 0;
  const stopCelebration = () => {
    mascotClicks = 0;
    mascot?.classList.remove("is-celebrating");
  };
  dialog.addEventListener("close", stopCelebration);
  mascot?.addEventListener("click", () => {
    mascotClicks += 1;
    if (mascotClicks < 5) return;
    mascotClicks = 0;
    mascot.classList.remove("is-celebrating");
    void mascot.offsetWidth;
    mascot.classList.add("is-celebrating");
  });
};

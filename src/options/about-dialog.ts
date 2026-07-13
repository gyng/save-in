import { webExtensionApi } from "../platform/web-extension-api.ts";

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

  const version = webExtensionApi.runtime.getManifest().version;
  const versionEl = dialog.querySelector<HTMLElement>("#about-version");
  if (versionEl) versionEl.textContent = version ? `v${version}` : "Unavailable";
  const commitEl = dialog.querySelector<HTMLAnchorElement>("#about-commit");
  fetch("version.json")
    .then((response) => response.json())
    .then(({ commit, date }) => {
      if (commitEl && commit && commit !== "unknown") {
        commitEl.textContent = commit;
        commitEl.href = `https://github.com/gyng/save-in/commit/${commit}`;
      }
      const dateEl = dialog.querySelector<HTMLElement>("#about-build-date");
      if (dateEl && date) dateEl.textContent = date;
    })
    .catch(() => {});

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

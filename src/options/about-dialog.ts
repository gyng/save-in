import { webExtensionApi } from "../platform/web-extension-api.ts";
import { BROWSERS, CURRENT_BROWSER } from "../platform/chrome-detector.ts";
import { showWelcomeDialog } from "./welcome-dialog.ts";

const STORE_LINK_IDS = {
  [BROWSERS.CHROME]: "about-store-chrome",
  [BROWSERS.FIREFOX]: "about-store-firefox",
} as const;

export const setupAboutDialog = (openWelcome: () => boolean = () => showWelcomeDialog()) => {
  const dialog = document.querySelector<HTMLDialogElement>("#about-dialog");
  const open = document.querySelector<HTMLButtonElement>("#about-open");
  const close = dialog?.querySelector<HTMLButtonElement>(".about-close");
  if (!dialog || !open || !close) return;
  open.addEventListener("click", () => {
    open.closest("details")?.removeAttribute("open");
    dialog.showModal();
  });
  close.addEventListener("click", () => dialog.close());
  dialog.querySelector<HTMLAnchorElement>("#about-welcome")?.addEventListener("click", (event) => {
    event.preventDefault();
    dialog.close();
    openWelcome();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  const version = webExtensionApi.runtime.getManifest().version;
  const versionEl = dialog.querySelector<HTMLElement>("#about-version");
  if (versionEl) versionEl.textContent = version ? `v${version}` : "Unavailable";

  const storeLinks = dialog.querySelectorAll<HTMLAnchorElement>("[data-about-store]");
  storeLinks.forEach((link) => (link.hidden = true));
  const storeLinkId = Reflect.get(STORE_LINK_IDS, CURRENT_BROWSER) as string | undefined;
  if (storeLinkId) {
    const storeLink = dialog.querySelector<HTMLAnchorElement>(`#${storeLinkId}`);
    if (storeLink) storeLink.hidden = false;
  }

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

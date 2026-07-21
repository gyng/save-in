import { getMessage } from "../../platform/localization.ts";
import { assertApplySucceeded } from "./options-save.ts";
import { optionsRuntime } from "./options-runtime.ts";

type LanguageSelectorPorts = {
  apply(locale: string): Promise<unknown>;
  reload(): void;
  getMessage(key: string): string;
  afterClose?(): Promise<void>;
};

export const afterNativePopupClose = (): Promise<void> => {
  // A native popup cannot remain visible after its document is hidden, so
  // avoid waiting for a rendering signal the browser intentionally suspends.
  if (document.visibilityState === "hidden") return Promise.resolve();

  return new Promise((resolve) => {
    // Native select popups are browser UI. Prefer a rendering turn after
    // removing their anchor, but background tabs may suspend animation frames.
    // The fallback keeps a selection from waiting forever if the user switches
    // tabs immediately after choosing a language.
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(fallback);
      resolve();
    };
    const fallback = setTimeout(finish, 100);
    requestAnimationFrame(finish);
  });
};

const defaultPorts: LanguageSelectorPorts = {
  apply: (uiLocale) => optionsRuntime.apply({ uiLocale }),
  reload: location.reload.bind(location),
  getMessage,
  afterClose: afterNativePopupClose,
};

export const setupLanguageSelector = (ports: LanguageSelectorPorts = defaultPorts) => {
  const select = document.querySelector<HTMLSelectElement>("#uiLocale");
  const error = document.querySelector<HTMLElement>("#language-error");
  if (!select || !error) return;
  const container = select.closest<HTMLElement>(".language-selector");
  const parent = select.parentNode as ParentNode;
  const nextSibling = select.nextSibling;
  const originalContainerWidth = container?.style.width ?? "";
  const originalContainerHeight = container?.style.height ?? "";

  // `change` may arrive only after a native select popup has decided to close.
  // `input` arrives when the option is selected, so the popup anchor can be
  // removed before any settings work begins.
  select.addEventListener("input", async () => {
    const bounds = select.getBoundingClientRect();
    if (container && bounds.width > 0 && bounds.height > 0) {
      container.style.width = `${bounds.width}px`;
      container.style.height = `${bounds.height}px`;
    }
    select.blur();
    select.disabled = true;
    select.remove();
    error.hidden = true;
    try {
      await (ports.afterClose?.() ?? Promise.resolve());
      assertApplySucceeded(await ports.apply(select.value));
      ports.reload();
    } catch {
      error.textContent =
        ports.getMessage("o_lLanguageChangeFailed") || "Could not change the language. Try again.";
      error.hidden = false;
      parent.insertBefore(select, nextSibling);
      select.disabled = false;
      if (container) {
        container.style.width = originalContainerWidth;
        container.style.height = originalContainerHeight;
      }
      select.focus();
    }
  });
};

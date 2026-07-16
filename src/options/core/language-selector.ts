import { getMessage } from "../../platform/localization.ts";
import { assertApplySucceeded } from "./options-save.ts";
import { optionsRuntime } from "./options-runtime.ts";

type LanguageSelectorPorts = {
  apply(locale: string): Promise<unknown>;
  reload(): void;
  getMessage(key: string): string;
  afterClose?(): Promise<void>;
};

const afterNativePopupClose = (): Promise<void> =>
  new Promise((resolve) => {
    // Native select popups are browser UI. Give the browser a rendering turn
    // after removing their anchor before starting extension messaging.
    requestAnimationFrame(() => resolve());
  });

const defaultPorts: LanguageSelectorPorts = {
  apply: (uiLocale) => optionsRuntime.apply({ uiLocale }),
  /* v8 ignore next -- navigation is owned by the real options-page browser context. */
  reload: () => location.reload(),
  getMessage,
  afterClose: afterNativePopupClose,
};

export const setupLanguageSelector = (ports: LanguageSelectorPorts = defaultPorts) => {
  const select = document.querySelector<HTMLSelectElement>("#uiLocale");
  const error = document.querySelector<HTMLElement>("#language-error");
  if (!select || !error) return;
  const container = select.closest<HTMLElement>(".language-selector");
  const parent = select.parentNode;
  const nextSibling = select.nextSibling;
  /* v8 ignore next -- The options document contract owns the selector container. */
  const originalContainerWidth = container?.style.width ?? "";
  /* v8 ignore next -- The options document contract owns the selector container. */
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
      /* v8 ignore next -- A selector found in the document always has its captured parent. */
      if (parent && !select.isConnected) parent.insertBefore(select, nextSibling);
      select.disabled = false;
      /* v8 ignore next -- The options document contract owns the selector container. */
      if (container) {
        container.style.width = originalContainerWidth;
        container.style.height = originalContainerHeight;
      }
      select.focus();
    }
  });
};

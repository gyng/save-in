import { getMessage } from "../platform/localization.ts";
import { assertApplySucceeded } from "./options-save.ts";
import { optionsRuntime } from "./options-runtime.ts";

type LanguageSelectorPorts = {
  apply(locale: string): Promise<unknown>;
  reload(): void;
  getMessage(key: string): string;
};

const defaultPorts: LanguageSelectorPorts = {
  apply: (uiLocale) => optionsRuntime.apply({ uiLocale }),
  /* v8 ignore next -- navigation is owned by the real options-page browser context. */
  reload: () => location.reload(),
  getMessage,
};

export const setupLanguageSelector = (ports: LanguageSelectorPorts = defaultPorts) => {
  const select = document.querySelector<HTMLSelectElement>("#uiLocale");
  const error = document.querySelector<HTMLElement>("#language-error");
  if (!select || !error) return;
  const container = select.closest<HTMLElement>(".language-selector");
  const originalContainerWidth = container?.style.width ?? "";
  const originalContainerHeight = container?.style.height ?? "";

  select.addEventListener("change", async () => {
    const bounds = select.getBoundingClientRect();
    if (container && bounds.width > 0 && bounds.height > 0) {
      container.style.width = `${bounds.width}px`;
      container.style.height = `${bounds.height}px`;
    }
    select.disabled = true;
    select.blur();
    select.hidden = true;
    error.hidden = true;
    try {
      assertApplySucceeded(await ports.apply(select.value));
      ports.reload();
    } catch {
      error.textContent =
        ports.getMessage("o_lLanguageChangeFailed") || "Could not change the language. Try again.";
      error.hidden = false;
      select.hidden = false;
      select.disabled = false;
      if (container) {
        container.style.width = originalContainerWidth;
        container.style.height = originalContainerHeight;
      }
      select.focus();
    }
  });
};

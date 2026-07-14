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

  select.addEventListener("change", async () => {
    select.disabled = true;
    select.blur();
    select.classList.add("language-switching");
    error.hidden = true;
    try {
      assertApplySucceeded(await ports.apply(select.value));
      ports.reload();
    } catch {
      error.textContent =
        ports.getMessage("o_lLanguageChangeFailed") || "Could not change the language. Try again.";
      error.hidden = false;
      select.classList.remove("language-switching");
      select.disabled = false;
      select.focus();
    }
  });
};

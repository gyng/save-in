import { webExtensionApi } from "../platform/web-extension-api.ts";

const COMMAND = "toggle-source-panel";

export const setupSourceShortcut = () => {
  const input = document.querySelector<HTMLInputElement>("#sourcePanelShortcut");
  const apply = document.querySelector<HTMLButtonElement>("#sourcePanelShortcutApply");
  const reset = document.querySelector<HTMLButtonElement>("#sourcePanelShortcutReset");
  const status = document.querySelector<HTMLElement>("#sourcePanelShortcutStatus");
  if (!input || !apply || !reset || !status || !webExtensionApi.commands) return;

  const announce = (message: string, error = false) => {
    status.textContent = message;
    status.classList.toggle("error", error);
  };
  const load = () =>
    webExtensionApi.commands.getAll().then((commands) => {
      input.value = commands.find(({ name }) => name === COMMAND)?.shortcut || "";
    });

  apply.addEventListener("click", () => {
    const shortcut = input.value.trim();
    if (!shortcut) {
      announce("Enter a shortcut or use Reset.", true);
      return;
    }
    void webExtensionApi.commands
      .update({ name: COMMAND, shortcut })
      .then(() => load())
      .then(() => announce("Shortcut updated."))
      .catch((error) => announce(String(error), true));
  });
  reset.addEventListener("click", () => {
    void webExtensionApi.commands
      .reset(COMMAND)
      .then(() => load())
      .then(() => announce("Shortcut reset."))
      .catch((error) => announce(String(error), true));
  });
  void load().catch((error) => announce(String(error), true));
};

document.addEventListener("DOMContentLoaded", setupSourceShortcut);

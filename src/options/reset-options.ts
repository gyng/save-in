import { webExtensionApi } from "../platform/web-extension-api.ts";
import { markSavedNow } from "./saved-indicator.ts";

type ResetOptionsDependencies = {
  restoreOptions: () => void;
  updateErrors: () => void;
  getOptionNames: () => Promise<string[]>;
  window?: Window;
};

export const setupResetOptions = ({
  restoreOptions,
  updateErrors,
  getOptionNames,
  window: hostWindow = globalThis.window,
}: ResetOptionsDependencies) => {
  document.querySelector<HTMLButtonElement>("#reset")?.addEventListener("click", (event) => {
    event.preventDefault();
    /* eslint-disable no-alert */
    if (!hostWindow.confirm("Reset settings to defaults?")) return;

    void (async () => {
      const names = await getOptionNames();
      await webExtensionApi.storage.local.remove(names);
      await webExtensionApi.runtime.sendMessage({ type: "OPTIONS_LOADED" });

      markSavedNow();
      restoreOptions();
      updateErrors();
      hostWindow.alert("Settings have been reset to defaults.");
    })().catch((error) => hostWindow.alert(`Failed to reset settings: ${String(error)}`));
    /* eslint-enable no-alert */
  });
};

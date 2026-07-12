import { webExtensionApi } from "../platform/web-extension-api.ts";
import { markSavedNow } from "./saved-indicator.ts";

type ResetOptionsDependencies = {
  restoreOptions: () => void;
  updateErrors: () => void;
  window?: Window;
};

export const setupResetOptions = ({
  restoreOptions,
  updateErrors,
  window: hostWindow = globalThis.window,
}: ResetOptionsDependencies) => {
  document.querySelector<HTMLButtonElement>("#reset")?.addEventListener("click", (event) => {
    event.preventDefault();
    /* eslint-disable no-alert */
    if (!hostWindow.confirm("Reset settings to defaults?")) return;

    void webExtensionApi.storage.local.clear().then(() => {
      void webExtensionApi.runtime.sendMessage({ type: "OPTIONS_LOADED" });

      markSavedNow();

      restoreOptions();
      updateErrors();
      hostWindow.alert("Settings have been reset to defaults.");
    });
    /* eslint-enable no-alert */
  });
};

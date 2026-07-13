import { webExtensionApi } from "../platform/web-extension-api.ts";
import { MESSAGE_TYPES } from "../shared/constants.ts";
import { sendInternalMessage } from "../shared/message-protocol.ts";
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
    if (!hostWindow.confirm("Reset settings to defaults?")) return;

    void (async () => {
      const names = await getOptionNames();
      await webExtensionApi.storage.local.remove(names);
      await sendInternalMessage(webExtensionApi.runtime, { type: MESSAGE_TYPES.OPTIONS_LOADED });

      markSavedNow();
      restoreOptions();
      updateErrors();
      hostWindow.alert("Settings have been reset to defaults.");
    })().catch((error) => hostWindow.alert(`Failed to reset settings: ${String(error)}`));
  });
};

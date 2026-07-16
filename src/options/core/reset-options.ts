import { getMessage } from "../../platform/localization.ts";
import { webExtensionApi } from "../../platform/web-extension-api.ts";
import { MESSAGE_TYPES } from "../../shared/constants.ts";
import { sendInternalMessage } from "../../shared/message-protocol.ts";
import { markSavedNow } from "./saved-indicator.ts";

type Localize = (key: string) => string;

type ResetOptionsDependencies = {
  restoreOptions: () => void;
  updateErrors: () => void;
  getOptionNames: () => Promise<string[]>;
  localize?: Localize;
};

export const showRestoreDefaultsDialog = (localize: Localize = getMessage): Promise<boolean> =>
  new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "app-dialog reset-settings-dialog";
    dialog.setAttribute("aria-labelledby", "reset-settings-title");
    dialog.setAttribute("aria-describedby", "reset-settings-description");

    const title = document.createElement("h2");
    title.id = "reset-settings-title";
    title.textContent = localize("o_cRestoreDefaults") || "Restore defaults";
    const description = document.createElement("p");
    description.id = "reset-settings-description";
    description.textContent =
      localize("restoreDefaultsConfirm") ||
      "Restore all settings to their defaults? Download history will be kept.";
    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = localize("restoreDefaultsCancel") || "Keep current settings";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "button-danger danger-button reset-settings-confirm";
    confirm.textContent = localize("o_cRestoreDefaults") || "Restore defaults";
    actions.append(cancel, confirm);
    dialog.append(title, description, actions);
    document.body.append(dialog);

    const finish = (confirmed: boolean) => {
      dialog.remove();
      resolve(confirmed);
    };
    cancel.addEventListener("click", () => finish(false));
    confirm.addEventListener("click", () => finish(true));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(false);
    });
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    cancel.focus();
  });

const renderResetStatus = (message: string, error: boolean): void => {
  const status = document.querySelector<HTMLElement>("#settings-reset-status");
  if (!status) return;
  status.textContent = message;
  status.hidden = !message;
  status.classList.toggle("feedback-success", Boolean(message) && !error);
  status.classList.toggle("feedback-error", Boolean(message) && error);
  status.setAttribute("role", error ? "alert" : "status");
};

export const setupResetOptions = ({
  restoreOptions,
  updateErrors,
  getOptionNames,
  localize = getMessage,
}: ResetOptionsDependencies) => {
  document.querySelector<HTMLButtonElement>("#reset")?.addEventListener("click", async (event) => {
    event.preventDefault();
    const button = event.currentTarget;
    /* v8 ignore next -- This listener is installed only on the reset button. */
    if (!(button instanceof HTMLButtonElement)) return;
    button.disabled = true;
    const confirmed = await showRestoreDefaultsDialog(localize);
    if (!confirmed) {
      button.disabled = false;
      return;
    }
    renderResetStatus("", false);

    try {
      const names = await getOptionNames();
      await webExtensionApi.storage.local.remove(names);
      await sendInternalMessage(webExtensionApi.runtime, { type: MESSAGE_TYPES.OPTIONS_LOADED });

      markSavedNow();
      restoreOptions();
      updateErrors();
      renderResetStatus(localize("restoreDefaultsSuccess") || "Default settings restored.", false);
    } catch {
      renderResetStatus(
        localize("restoreDefaultsFailure") || "Could not restore default settings.",
        true,
      );
    } finally {
      button.disabled = false;
    }
  });
};

import { getMessage } from "../platform/localization.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";
import {
  createSaveWebhookPayload,
  createTestWebhookPayload,
  getWebhookDataTypes,
  postWebhook,
  validateWebhookUrl,
  type WebhookDataType,
  type WebhookFieldSelection,
} from "../shared/webhook.ts";
import { optionsRuntime } from "./options-runtime.ts";
import { assertApplySucceeded } from "./options-save.ts";

type DataCollectionPermissions = { data_collection?: string[] | undefined };
type DataCollectionPermissionsApi = {
  getAll(): Promise<DataCollectionPermissions>;
  request(permissions: { data_collection: WebhookDataType[] }): Promise<boolean>;
  remove?(permissions: { data_collection: WebhookDataType[] }): Promise<boolean>;
};

export type WebhookPanelDependencies = {
  permissions?: DataCollectionPermissionsApi | undefined;
  apply(config: Record<string, unknown>): Promise<unknown>;
  post(endpoint: string): Promise<{ ok: boolean; status: number }>;
  message(key: string, fallback: string): string;
};

const defaultDependencies = (): WebhookPanelDependencies => {
  const messages: Record<string, string> = {
    webhookPermissionDenied: getMessage("webhookPermissionDenied"),
    webhookPermissionMissing: getMessage("webhookPermissionMissing"),
    webhookPermissionCheckFailed: getMessage("webhookPermissionCheckFailed"),
    webhookSendingTest: getMessage("webhookSendingTest"),
    webhookTestDelivered: getMessage("webhookTestDelivered"),
    webhookTestRejected: getMessage("webhookTestRejected"),
    webhookTestFailed: getMessage("webhookTestFailed"),
    webhookEnabledSaved: getMessage("webhookEnabledSaved"),
    webhookDisabledSaved: getMessage("webhookDisabledSaved"),
    webhookSaveFailed: getMessage("webhookSaveFailed"),
    webhookFieldsSaved: getMessage("webhookFieldsSaved"),
  };
  return {
    permissions: webExtensionApi.permissions as unknown as DataCollectionPermissionsApi,
    apply: async (config) => assertApplySucceeded(await optionsRuntime.apply(config)),
    post: (endpoint) => postWebhook(endpoint, createTestWebhookPayload()),
    message: (key, fallback) => messages[key] || fallback,
  };
};

export const setupWebhookPanel = (
  dependencies: WebhookPanelDependencies = defaultDependencies(),
): void => {
  const endpoint = document.querySelector<HTMLInputElement>("#webhookUrl");
  const enabled = document.querySelector<HTMLInputElement>("#webhookEnabled");
  const test = document.querySelector<HTMLButtonElement>("#webhook-test");
  const status = document.querySelector<HTMLElement>("#webhook-status");
  const preview = document.querySelector<HTMLElement>("#webhook-payload-preview");
  const fieldControls = {
    includePageUrl: document.querySelector<HTMLInputElement>("#webhookIncludePageUrl"),
    includePageTitle: document.querySelector<HTMLInputElement>("#webhookIncludePageTitle"),
    includeSelectionText: document.querySelector<HTMLInputElement>("#webhookIncludeSelectionText"),
  };
  if (
    !endpoint ||
    !enabled ||
    !test ||
    !status ||
    !preview ||
    Object.values(fieldControls).some((control) => !control)
  ) {
    return;
  }

  const fields = (): WebhookFieldSelection => ({
    includePageUrl: fieldControls.includePageUrl?.checked === true,
    includePageTitle: fieldControls.includePageTitle?.checked === true,
    includeSelectionText: fieldControls.includeSelectionText?.checked === true,
  });
  const setStatus = (message: string, error = false) => {
    status.textContent = message;
    status.classList.toggle("is-error", error);
  };
  const renderPreview = () => {
    preview.textContent = JSON.stringify(
      createSaveWebhookPayload(
        {
          selectedUrl: "https://cdn.example.com/image.jpg",
          pageUrl: "https://example.com/gallery",
          pageTitle: "Example gallery",
          selectionText: "Example selected text",
        },
        fields(),
      ),
      null,
      2,
    );
  };
  const endpointValidation = (showError = false) => {
    const result = validateWebhookUrl(endpoint.value);
    endpoint.setCustomValidity(result.ok || !showError ? "" : result.message);
    test.disabled = !result.ok || test.dataset.sending === "true";
    return result;
  };

  let dataPermissionsSupported = false;
  let grantedDataTypes: string[] = [];
  let permissionCheckFailed = false;
  const showPermissionState = () => {
    if (
      dataPermissionsSupported &&
      enabled.checked &&
      !getWebhookDataTypes(fields()).every((type) => grantedDataTypes.includes(type))
    ) {
      setStatus(
        dependencies.message(
          "webhookPermissionMissing",
          "Firefox data permission is off. Turn webhooks off and on to enable it.",
        ),
        true,
      );
    }
  };
  const refreshPermissionSupport = async () => {
    enabled.disabled = true;
    try {
      const current = await dependencies.permissions?.getAll();
      dataPermissionsSupported = Array.isArray(current?.data_collection);
      grantedDataTypes = current?.data_collection ?? [];
    } catch {
      dataPermissionsSupported = false;
      grantedDataTypes = [];
      permissionCheckFailed = true;
      setStatus(
        dependencies.message(
          "webhookPermissionCheckFailed",
          "Could not check browser data permission.",
        ),
        true,
      );
    } finally {
      enabled.disabled = permissionCheckFailed;
      showPermissionState();
    }
  };
  const requestDataTypes = (selection: WebhookFieldSelection): Promise<boolean> => {
    if (!dataPermissionsSupported || !dependencies.permissions) return Promise.resolve(true);
    const requested = getWebhookDataTypes(selection);
    if (requested.every((type) => grantedDataTypes.includes(type))) return Promise.resolve(true);
    // Called directly from the checkbox event so Firefox retains user activation.
    return dependencies.permissions.request({ data_collection: requested }).then((granted) => {
      if (granted) grantedDataTypes = [...new Set([...grantedDataTypes, ...requested])];
      return granted;
    });
  };
  const permissionDenied = () =>
    setStatus(
      dependencies.message(
        "webhookPermissionDenied",
        "Firefox did not allow the selected webhook data.",
      ),
      true,
    );

  let endpointSaveTimer: number | undefined;
  const saveEndpoint = async () => {
    if (endpointSaveTimer !== undefined) window.clearTimeout(endpointSaveTimer);
    endpointSaveTimer = undefined;
    const validation = validateWebhookUrl(endpoint.value);
    if (!validation.ok && endpoint.value.trim() !== "") return;
    try {
      await dependencies.apply({ webhookUrl: validation.ok ? validation.url : "" });
    } catch {
      setStatus(
        dependencies.message("webhookSaveFailed", "Could not save the webhook setting."),
        true,
      );
    }
  };
  endpoint.addEventListener("input", () => {
    endpointValidation(false);
    if (endpointSaveTimer !== undefined) window.clearTimeout(endpointSaveTimer);
    endpointSaveTimer = window.setTimeout(() => void saveEndpoint(), 400);
  });
  endpoint.addEventListener("blur", () => {
    endpointValidation(endpoint.value.trim() !== "");
    void saveEndpoint();
  });
  test.addEventListener("click", async () => {
    const validation = endpointValidation(true);
    if (!validation.ok) {
      endpoint.reportValidity();
      return;
    }
    test.dataset.sending = "true";
    test.disabled = true;
    setStatus(dependencies.message("webhookSendingTest", "Sending test…"));
    try {
      const response = await dependencies.post(validation.url);
      if (response.ok) {
        setStatus(dependencies.message("webhookTestDelivered", "Test delivered."));
      } else {
        setStatus(dependencies.message("webhookTestRejected", "Endpoint rejected the test."), true);
      }
    } catch {
      setStatus(
        dependencies.message("webhookTestFailed", "Could not deliver the test webhook."),
        true,
      );
    } finally {
      delete test.dataset.sending;
      endpointValidation(false);
    }
  });

  enabled.addEventListener("change", async () => {
    const next = enabled.checked;
    if (next) {
      const validation = endpointValidation(true);
      if (!validation.ok) {
        enabled.checked = false;
        endpoint.reportValidity();
        return;
      }
      if (!(await requestDataTypes(fields()))) {
        enabled.checked = false;
        permissionDenied();
        return;
      }
    }
    enabled.disabled = true;
    try {
      await dependencies.apply({
        webhookEnabled: next,
        ...(next ? { webhookUrl: endpoint.value.trim() } : {}),
      });
      setStatus(
        dependencies.message(
          next ? "webhookEnabledSaved" : "webhookDisabledSaved",
          next ? "Webhooks enabled." : "Webhooks disabled.",
        ),
      );
      if (!next && dataPermissionsSupported) {
        const allTypes = getWebhookDataTypes({
          includePageUrl: true,
          includePageTitle: true,
          includeSelectionText: true,
        });
        const removal = dependencies.permissions?.remove?.({ data_collection: allTypes });
        const removed = await removal?.catch(() => false);
        if (removed) grantedDataTypes = [];
      }
    } catch {
      enabled.checked = !next;
      setStatus(
        dependencies.message("webhookSaveFailed", "Could not save the webhook setting."),
        true,
      );
    } finally {
      enabled.disabled = false;
    }
  });

  Object.entries(fieldControls).forEach(([field, control]) => {
    control?.addEventListener("change", async () => {
      const next = control.checked;
      if (next && enabled.checked && !(await requestDataTypes(fields()))) {
        control.checked = false;
        renderPreview();
        permissionDenied();
        return;
      }
      control.disabled = true;
      try {
        await dependencies.apply({
          [`webhook${field[0]?.toUpperCase() ?? ""}${field.slice(1)}`]: next,
        });
        setStatus(dependencies.message("webhookFieldsSaved", "Webhook data updated."));
      } catch {
        control.checked = !next;
        setStatus(
          dependencies.message("webhookSaveFailed", "Could not save the webhook setting."),
          true,
        );
      } finally {
        control.disabled = false;
        renderPreview();
      }
    });
  });

  document.addEventListener("options-restored", () => {
    renderPreview();
    endpointValidation(false);
    showPermissionState();
  });
  renderPreview();
  endpointValidation(false);
  void refreshPermissionSupport();
};

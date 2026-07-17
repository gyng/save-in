import { getMessage } from "../../platform/localization.ts";
import { webExtensionApi } from "../../platform/web-extension-api.ts";
import {
  createSaveWebhookPayload,
  createTestWebhookPayload,
  getWebhookDataTypes,
  parseWebhookEndpoints,
  postWebhook,
  WEBHOOK_DATA_TYPES,
  type WebhookDataType,
  type WebhookFieldSelection,
} from "../../shared/webhook.ts";
import { optionsRuntime } from "../core/options-runtime.ts";
import { assertApplySucceeded } from "../core/options-save.ts";

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

const webhookDataTypes = new Set<string>(Object.values(WEBHOOK_DATA_TYPES));

const isWebhookDataType = (value: unknown): value is WebhookDataType =>
  typeof value === "string" && webhookDataTypes.has(value);

export const createDataCollectionPermissionsApi = (
  candidate: unknown,
): DataCollectionPermissionsApi | undefined => {
  if (candidate === null || (typeof candidate !== "object" && typeof candidate !== "function")) {
    return undefined;
  }
  const getAll = Reflect.get(candidate, "getAll");
  const request = Reflect.get(candidate, "request");
  const remove = Reflect.get(candidate, "remove");
  if (typeof getAll !== "function" || typeof request !== "function") return undefined;

  const invoke = async (method: (...args: unknown[]) => unknown, argument?: unknown) => {
    const result: unknown = await Reflect.apply(
      method,
      candidate,
      argument === undefined ? [] : [argument],
    );
    return result;
  };

  return {
    getAll: async () => {
      const current = await invoke(getAll);
      if (current === null || typeof current !== "object") return {};
      const dataCollection: unknown = Reflect.get(current, "data_collection");
      return Array.isArray(dataCollection)
        ? { data_collection: dataCollection.filter(isWebhookDataType) }
        : {};
    },
    request: async (permissions) => (await invoke(request, permissions)) === true,
    ...(typeof remove === "function"
      ? { remove: async (permissions) => (await invoke(remove, permissions)) === true }
      : {}),
  };
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
    webhookStateOn: getMessage("webhookStateOn"),
    webhookStateOff: getMessage("webhookStateOff"),
  };
  return {
    permissions: createDataCollectionPermissionsApi(webExtensionApi.permissions),
    apply: async (config) => assertApplySucceeded(await optionsRuntime.apply(config)),
    post: (endpoint) => postWebhook(endpoint, createTestWebhookPayload()),
    message: (key, fallback) => messages[key] || fallback,
  };
};

export const setupWebhookPanel = (
  dependencies: WebhookPanelDependencies = defaultDependencies(),
): void => {
  const endpoint = document.querySelector<HTMLTextAreaElement>("#webhookUrl");
  const enabled = document.querySelector<HTMLInputElement>("#webhookEnabled");
  const test = document.querySelector<HTMLButtonElement>("#webhook-test");
  const status = document.querySelector<HTMLElement>("#webhook-status");
  const stateBadge = document.querySelector<HTMLElement>("#webhook-state-badge");
  const preview = document.querySelector<HTMLElement>("#webhook-payload-preview");
  const fieldControls = {
    includePageUrl: document.querySelector<HTMLInputElement>("#webhookIncludePageUrl"),
    includePageTitle: document.querySelector<HTMLInputElement>("#webhookIncludePageTitle"),
    includeSelectionText: document.querySelector<HTMLInputElement>("#webhookIncludeSelectionText"),
  };
  const { includePageUrl, includePageTitle, includeSelectionText } = fieldControls;
  if (
    !endpoint ||
    !enabled ||
    !test ||
    !status ||
    !preview ||
    !includePageUrl ||
    !includePageTitle ||
    !includeSelectionText
  ) {
    return;
  }

  const controls = {
    includePageUrl,
    includePageTitle,
    includeSelectionText,
  };

  const fields = (): WebhookFieldSelection => ({
    includePageUrl: controls.includePageUrl.checked,
    includePageTitle: controls.includePageTitle.checked,
    includeSelectionText: controls.includeSelectionText.checked,
  });
  const setStatus = (message: string, error = false) => {
    status.textContent = message;
    status.classList.toggle("is-error", error);
    status.classList.toggle("feedback-error", error);
    status.classList.toggle("feedback-success", Boolean(message) && !error);
  };
  const renderEnabledState = () => {
    if (!stateBadge) return;
    stateBadge.dataset.state = enabled.checked ? "on" : "off";
    stateBadge.textContent = enabled.checked
      ? dependencies.message("webhookStateOn", "On")
      : dependencies.message("webhookStateOff", "Off");
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
  // One endpoint per line. The field is usable when every line it names is one
  // the extension will send to: a line it would not send to is reported where
  // it was written rather than quietly ignored, so the list never claims more
  // than it delivers. Reading the field is separate from reporting on it — the
  // blur handler validates and then saves, and a save must not erase the
  // message the blur just showed.
  const readEndpoints = () => {
    const parsed = parseWebhookEndpoints(endpoint.value);
    const firstIssue = parsed.issues[0];
    return {
      ok: parsed.entries.length > 0 && firstIssue === undefined,
      endpoints: parsed.entries.map((entry) => entry.value),
      // Validation text has always come from validateWebhookUrl untranslated;
      // the line prefix keeps that, and says which line the reason is about.
      message: firstIssue
        ? `Line ${firstIssue.line}: ${firstIssue.error.message}`
        : "Enter an HTTPS webhook URL",
    };
  };
  const endpointValidation = (showError = false) => {
    const result = readEndpoints();
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
    const validation = readEndpoints();
    if (!validation.ok && endpoint.value.trim() !== "") return;
    try {
      // The stored value is the text as written, so the lines a user is editing
      // come back as they left them; the schema accepts it only when every line
      // is an endpoint that would be sent to.
      await dependencies.apply({ webhookUrl: validation.ok ? endpoint.value.trim() : "" });
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
    endpointSaveTimer = window.setTimeout(() => {
      endpointSaveTimer = undefined;
      void saveEndpoint();
    }, 400);
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
      // Every endpoint is tested, and each one's outcome is its own: the button
      // reports what the save path would actually do, which is deliver to the
      // ones that answer and not to the ones that do not.
      const outcomes = await Promise.all(
        validation.endpoints.map((url) =>
          dependencies.post(url).then(
            (response) => (response.ok ? "delivered" : "rejected"),
            () => "failed",
          ),
        ),
      );
      const delivered = outcomes.filter((outcome) => outcome === "delivered").length;
      if (delivered === outcomes.length) {
        setStatus(dependencies.message("webhookTestDelivered", "Test delivered."));
      } else if (outcomes.includes("rejected")) {
        setStatus(dependencies.message("webhookTestRejected", "Endpoint rejected the test."), true);
      } else {
        setStatus(
          dependencies.message("webhookTestFailed", "Could not deliver the test webhook."),
          true,
        );
      }
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
      renderEnabledState();
    }
  });

  Object.entries(controls).forEach(([field, control]) => {
    control.addEventListener("change", async () => {
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
          [`webhook${field.charAt(0).toUpperCase()}${field.slice(1)}`]: next,
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
    renderEnabledState();
  });
  renderPreview();
  endpointValidation(false);
  renderEnabledState();
  void refreshPermissionSupport();
};

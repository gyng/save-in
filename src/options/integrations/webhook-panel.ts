import { getMessage } from "../../platform/localization.ts";
import { webExtensionApi } from "../../platform/web-extension-api.ts";
import {
  createSaveWebhookPayload,
  createTestWebhookPayload,
  getWebhookDataTypes,
  parseWebhookEndpoints,
  postWebhook,
  WEBHOOK_CONTENT_TYPE,
  WEBHOOK_DATA_TYPES,
  WEBHOOK_REQUEST_METHOD,
  type WebhookDataType,
  type WebhookEndpointPolicy,
  type WebhookFieldSelection,
} from "../../shared/webhook.ts";
import { optionsRuntime } from "../core/options-runtime.ts";
import { assertApplySucceeded } from "../core/options-save.ts";
import { setSyntaxEditorAnalysisOptions } from "../syntax-editor/syntax-editor.ts";

type DataCollectionPermissions = { data_collection?: string[] | undefined };
type DataCollectionPermissionsApi = {
  getAll(): Promise<DataCollectionPermissions>;
  request(permissions: { data_collection: WebhookDataType[] }): Promise<boolean>;
  remove?(permissions: { data_collection: WebhookDataType[] }): Promise<boolean>;
};

export type WebhookPanelDependencies = {
  permissions?: DataCollectionPermissionsApi | undefined;
  apply(config: Record<string, unknown>): Promise<unknown>;
  // The policy travels with the endpoint: postWebhook re-validates before it
  // fetches and defaults to HTTPS-only, so a test of an allowed http:// target
  // has to say so or it would be refused here rather than by the server.
  post(endpoint: string, policy: WebhookEndpointPolicy): Promise<{ ok: boolean; status: number }>;
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
    post: (endpoint, policy) => postWebhook(endpoint, createTestWebhookPayload(), { policy }),
    message: (key, fallback) => messages[key] || fallback,
  };
};

export const setupWebhookPanel = (
  dependencies: WebhookPanelDependencies = defaultDependencies(),
): void => {
  const endpoint = document.querySelector<HTMLTextAreaElement>("#webhookUrl");
  const enabled = document.querySelector<HTMLInputElement>("#webhookEnabled");
  const allowInsecure = document.querySelector<HTMLInputElement>("#webhookAllowInsecure");
  // Each id is its own option name, so the change handler needs no mapping.
  const eventControls = ["webhookOnStart", "webhookOnComplete", "webhookOnFailed"].map((name) =>
    document.querySelector<HTMLInputElement>(`#${name}`),
  );
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
    !allowInsecure ||
    eventControls.some((control) => !control) ||
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
  // What the endpoint list currently means. The checkbox is the only thing that
  // decides it, so every read of the list goes through here rather than
  // remembering an answer that the next click changes.
  const policy = () => ({ allowInsecure: allowInsecure.checked });

  const PREVIEW_ENDPOINT_PLACEHOLDER = "https://hooks.example.com/save";
  const renderPreview = () => {
    const body = JSON.stringify(
      createSaveWebhookPayload(
        {
          // A stand-in id: the real one is the browser's, and no download has
          // started when the preview is drawn.
          id: 1,
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
    // The first endpoint the list would actually be sent to, so the preview
    // names a real target rather than an example the user never typed. The
    // method and content type come from postWebhook so this cannot describe a
    // request nobody makes. A request line is wire format, not prose: it is
    // left untranslated for the same reason the JSON body below it is.
    const target = parseWebhookEndpoints(endpoint.value, policy()).entries[0]?.value;
    const requestLine = `${WEBHOOK_REQUEST_METHOD} ${target ?? PREVIEW_ENDPOINT_PLACEHOLDER}`;
    preview.textContent = `${requestLine}\nContent-Type: ${WEBHOOK_CONTENT_TYPE}\n\n${body}`;
  };
  // One endpoint per line. The field is usable when every line it names is one
  // the extension will send to: a line it would not send to is reported where
  // it was written rather than quietly ignored, so the list never claims more
  // than it delivers. Reading the field is separate from reporting on it — the
  // blur handler validates and then saves, and a save must not erase the
  // message the blur just showed.
  const readEndpoints = () => {
    const parsed = parseWebhookEndpoints(endpoint.value, policy());
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
  // The checkbox changes what the lines already in the editor mean, so the
  // editor has to be told before anything reads them again: a line that just
  // stopped being an endpoint should be marked as one the moment it does.
  const syncEndpointGrammar = () => {
    setSyntaxEditorAnalysisOptions(endpoint, { webhookAllowInsecure: allowInsecure.checked });
    endpointValidation(false);
    renderPreview();
  };

  // Which events a save reports. None of them changes the data the payloads
  // carry, so unlike the fields below they ask for no further consent.
  eventControls.forEach((control) => {
    control?.addEventListener("change", async () => {
      const next = control.checked;
      control.disabled = true;
      try {
        await dependencies.apply({ [control.id]: next });
        setStatus(dependencies.message("webhookFieldsSaved", "Webhook data updated."));
      } catch {
        control.checked = !next;
        setStatus(
          dependencies.message("webhookSaveFailed", "Could not save the webhook setting."),
          true,
        );
      } finally {
        control.disabled = false;
      }
    });
  });

  allowInsecure.addEventListener("change", async () => {
    const next = allowInsecure.checked;
    syncEndpointGrammar();
    allowInsecure.disabled = true;
    try {
      const validation = readEndpoints();
      // Allowing http:// and the list it makes valid go in one write: the write
      // boundary reads the flag from the config it is handed, so a list refused
      // a moment ago is accepted here rather than waiting for the next keypress.
      // Turning it off writes only the flag — the lines stay for the user to fix
      // and stop being sent to either way.
      await dependencies.apply({
        webhookAllowInsecure: next,
        ...(next && validation.ok ? { webhookUrl: endpoint.value.trim() } : {}),
      });
    } catch {
      allowInsecure.checked = !next;
      syncEndpointGrammar();
      setStatus(
        dependencies.message("webhookSaveFailed", "Could not save the webhook setting."),
        true,
      );
    } finally {
      allowInsecure.disabled = false;
    }
  });

  endpoint.addEventListener("input", () => {
    endpointValidation(false);
    // The preview names the endpoint it would post to, so it follows the list
    // as it is typed rather than only when a checkbox moves.
    renderPreview();
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
          dependencies.post(url, policy()).then(
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
    // Restore has just put the stored flag in the checkbox, so the grammar the
    // editor reports against is settled from the same values.
    syncEndpointGrammar();
    showPermissionState();
    renderEnabledState();
  });
  syncEndpointGrammar();
  renderEnabledState();
  void refreshPermissionSupport();
};

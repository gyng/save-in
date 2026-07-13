import type { SaveInOptions } from "../config/option-schema.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";
import {
  createSaveWebhookPayload,
  getWebhookDataTypes,
  postWebhook,
  validateWebhookUrl,
  type WebhookDataType,
  type WebhookFieldSelection,
} from "../shared/webhook.ts";
import type { DownloadPlan } from "./download-types.ts";

type DataCollectionPermissions = {
  data_collection?: string[] | undefined;
};

type DataCollectionPermissionsApi = {
  getAll(): Promise<DataCollectionPermissions>;
};

const fieldSelection = (configuration: SaveInOptions): WebhookFieldSelection => ({
  includePageUrl: configuration.webhookIncludePageUrl,
  includePageTitle: configuration.webhookIncludePageTitle,
  includeSelectionText: configuration.webhookIncludeSelectionText,
});

const selectedUrl = (plan: DownloadPlan): string | undefined => {
  const info = plan.state.info;
  if (info.selectedUrl) return info.selectedUrl;
  if (info.url && !/^(?:blob|data):/i.test(info.url)) return info.url;
  return info.sourceUrl || info.pageUrl;
};

const hasDataCollectionConsent = async (types: WebhookDataType[]): Promise<boolean> => {
  const permissions = webExtensionApi.permissions as unknown as
    | DataCollectionPermissionsApi
    | undefined;
  if (!permissions?.getAll) return true;
  try {
    const granted = await permissions.getAll();
    // Chrome and Firefox before 140 do not expose built-in data permissions;
    // the in-product webhook switch is their consent/control boundary.
    if (!Array.isArray(granted.data_collection)) return true;
    return types.every((type) => granted.data_collection?.includes(type));
  } catch {
    return false;
  }
};

type WebhookDeliveryLog = {
  add(message: string, data?: unknown): unknown;
};

export const deliverSaveWebhook = async (
  configuration: SaveInOptions,
  plan: DownloadPlan,
  log: WebhookDeliveryLog,
): Promise<void> => {
  if (
    !configuration.webhookEnabled ||
    plan.state.info.webhookEligible !== true ||
    plan.state.info.currentTab?.incognito === true
  )
    return;
  const endpoint = validateWebhookUrl(configuration.webhookUrl);
  const url = selectedUrl(plan);
  if (!endpoint.ok || !url) return;

  const fields = fieldSelection(configuration);
  if (!(await hasDataCollectionConsent(getWebhookDataTypes(fields)))) {
    log.add("webhook skipped: data permission not granted");
    return;
  }

  const payload = createSaveWebhookPayload(
    {
      selectedUrl: url,
      pageUrl: plan.state.info.pageUrl,
      pageTitle: plan.state.info.currentTab?.title,
      selectionText: plan.state.info.selectionText,
    },
    fields,
  );

  try {
    const response = await postWebhook(endpoint.url, payload);
    if (!response.ok) log.add("webhook rejected", { status: response.status });
  } catch {
    // Fetch errors can include the endpoint, including query-string secrets.
    log.add("webhook delivery failed");
  }
};

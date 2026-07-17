import type { SaveInOptions } from "../config/option-schema.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";
import { isStringKeyedRecord } from "../shared/util.ts";
import {
  createSaveWebhookPayload,
  getWebhookDataTypes,
  parseWebhookEndpoints,
  postWebhook,
  type WebhookDataType,
  type WebhookFieldSelection,
} from "../shared/webhook.ts";
import type { DownloadPlan } from "./download-types.ts";

const fieldSelection = (configuration: SaveInOptions): WebhookFieldSelection => ({
  includePageUrl: configuration.webhookIncludePageUrl,
  includePageTitle: configuration.webhookIncludePageTitle,
  includeSelectionText: configuration.webhookIncludeSelectionText,
});

const OPAQUE_URL_REGEX = /^(?:blob|data):/i;

// Every webhook-eligible caller sets selectedUrl (menus, tab menus, and the
// same-extension DOWNLOAD handler), so testing one field for an opaque scheme
// never rejected anything: the filter has to apply wherever the candidate came
// from. A data: URL is its own payload — reporting one verbatim POSTs the whole
// inline image to the endpoint — and a blob: URL names nothing outside the page
// that made it.
const selectedUrl = (plan: DownloadPlan): string | undefined => {
  const info = plan.state.info;
  return [info.selectedUrl, info.url, info.sourceUrl, info.pageUrl].find(
    (value): value is string =>
      typeof value === "string" && value !== "" && !OPAQUE_URL_REGEX.test(value),
  );
};

const hasDataCollectionConsent = async (types: WebhookDataType[]): Promise<boolean> => {
  const permissions: unknown = webExtensionApi.permissions;
  if (!isStringKeyedRecord(permissions)) return true;
  const getAll = permissions.getAll;
  if (typeof getAll !== "function") return true;
  try {
    const granted: unknown = await Reflect.apply(getAll, permissions, []);
    // Chrome and Firefox before 140 do not expose built-in data permissions;
    // the in-product webhook switch is their consent/control boundary.
    if (!isStringKeyedRecord(granted)) return false;
    const dataCollection = granted.data_collection;
    if (typeof dataCollection === "undefined") return true;
    if (
      !Array.isArray(dataCollection) ||
      !dataCollection.every((value): value is string => typeof value === "string")
    ) {
      return false;
    }
    return types.every((type) => dataCollection.includes(type));
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
  // A line the parser rejected is reported to the editor and never sent to.
  // The policy is read per delivery rather than at save time, so turning
  // http:// back off stops the plaintext endpoints a stored list still names:
  // they parse as issues, and only entries are sent.
  const policy = { allowInsecure: configuration.webhookAllowInsecure };
  const endpoints = parseWebhookEndpoints(configuration.webhookUrl, policy).entries;
  const url = selectedUrl(plan);
  if (endpoints.length === 0 || !url) return;

  const fields = fieldSelection(configuration);
  // The fields are one selection for every endpoint, so this is one consent
  // question however many endpoints it is answered for.
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

  // Each endpoint is delivered and reported independently: one that refuses or
  // never answers must not cost the others their request, and postWebhook
  // bounds each one's wait on its own. An endpoint is identified by the line it
  // was written on — the URL itself can carry a query-string secret, which is
  // why the failure paths have never named it.
  await Promise.all(
    endpoints.map(async ({ value: endpoint, line }) => {
      try {
        const response = await postWebhook(endpoint, payload, { policy });
        if (!response.ok) log.add("webhook rejected", { line, status: response.status });
      } catch {
        log.add("webhook delivery failed", { line });
      }
    }),
  );
};

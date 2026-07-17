import type { SaveInOptions } from "../config/option-schema.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";
import { isStringKeyedRecord } from "../shared/util.ts";
import {
  createCompleteWebhookPayload,
  createFailedWebhookPayload,
  createSaveWebhookPayload,
  getWebhookDataTypes,
  parseWebhookEndpoints,
  postWebhook,
  type WebhookDataType,
  type WebhookEndpointPolicy,
  type WebhookFieldSelection,
  type WebhookPayload,
} from "../shared/webhook.ts";
import type { DownloadRecord } from "./download-state.ts";
import type { DownloadPlan } from "./download-types.ts";

// An outcome event carries no page context at all, so it never asks for the
// website-content permission the save event may need.
const NO_PAGE_FIELDS: WebhookFieldSelection = {
  includePageUrl: false,
  includePageTitle: false,
  includeSelectionText: false,
};

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
  downloadId: number,
  log: WebhookDeliveryLog,
): Promise<void> => {
  if (
    !configuration.webhookEnabled ||
    !configuration.webhookOnStart ||
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
      id: downloadId,
      selectedUrl: url,
      pageUrl: plan.state.info.pageUrl,
      pageTitle: plan.state.info.currentTab?.title,
      selectionText: plan.state.info.selectionText,
    },
    fields,
  );

  await postToEndpoints(endpoints, payload, policy, log);
};

// Each endpoint is delivered and reported independently: one that refuses or
// never answers must not cost the others their request, and postWebhook bounds
// each one's wait on its own. An endpoint is identified by the line it was
// written on — the URL itself can carry a query-string secret, which is why the
// failure paths have never named it.
const postToEndpoints = async (
  endpoints: readonly { value: string; line: number }[],
  payload: WebhookPayload,
  policy: WebhookEndpointPolicy,
  log: WebhookDeliveryLog,
): Promise<void> => {
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

export type DownloadOutcome =
  | { status: "complete"; path: string }
  | { status: "failed"; reason: string };

// The outcome of a download that has already ended. Its eligibility was decided
// when it started: this path has no tab and no save command to consult, and the
// record it does have cannot say whether the download was private, so it trusts
// the answer the start path wrote down and sends nothing without one.
export const deliverDownloadOutcomeWebhook = async (
  configuration: SaveInOptions,
  record: DownloadRecord,
  downloadId: number,
  outcome: DownloadOutcome,
  log: WebhookDeliveryLog,
): Promise<void> => {
  const wanted =
    outcome.status === "complete" ? configuration.webhookOnComplete : configuration.webhookOnFailed;
  if (!configuration.webhookEnabled || !wanted || record.webhookEligible !== true) return;

  const url = record.url;
  if (!url || OPAQUE_URL_REGEX.test(url)) return;

  const policy = { allowInsecure: configuration.webhookAllowInsecure };
  const endpoints = parseWebhookEndpoints(configuration.webhookUrl, policy).entries;
  if (endpoints.length === 0) return;

  // The outcome carries no page data, so it asks for no page-data consent: the
  // browsing/website activity the save event already answered for is the same
  // activity, and this reports only what became of it.
  if (!(await hasDataCollectionConsent(getWebhookDataTypes(NO_PAGE_FIELDS)))) {
    log.add("webhook skipped: data permission not granted");
    return;
  }

  const payload =
    outcome.status === "complete"
      ? createCompleteWebhookPayload({ id: downloadId, url, path: outcome.path })
      : createFailedWebhookPayload({ id: downloadId, url, reason: outcome.reason });

  await postToEndpoints(endpoints, payload, policy, log);
};

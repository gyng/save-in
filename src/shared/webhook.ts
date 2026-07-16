// Deliberately shared, not feature-owned: config/option-schema.ts validates
// stored webhook settings, downloads/webhook-delivery.ts performs the fetch,
// and options/integrations/webhook-panel.ts renders the UI. config/ may only
// reach shared/platform (scripts/check-import-cycles.js), so this cannot move
// into downloads/ or options/ without breaking that boundary; it stays here
// as a cross-context contract plus pure helper (docs/CODE-ORGANIZATION.md
// Phase 3.1).
export const WEBHOOK_DATA_TYPES = {
  BROWSING_ACTIVITY: "browsingActivity",
  WEBSITE_ACTIVITY: "websiteActivity",
  WEBSITE_CONTENT: "websiteContent",
} as const;

export type WebhookDataType = (typeof WEBHOOK_DATA_TYPES)[keyof typeof WEBHOOK_DATA_TYPES];

export type WebhookFieldSelection = {
  includePageUrl: boolean;
  includePageTitle: boolean;
  includeSelectionText: boolean;
};

export type SaveWebhookSource = {
  selectedUrl: string;
  pageUrl?: string | undefined;
  pageTitle?: string | undefined;
  selectionText?: string | undefined;
};

export type SaveWebhookPayload = {
  version: 1;
  event: "save";
  timestamp: string;
  url: string;
  pageUrl?: string | undefined;
  pageTitle?: string | undefined;
  selectionText?: string | undefined;
};

export type TestWebhookPayload = {
  version: 1;
  event: "test";
  timestamp: string;
};

export type WebhookPayload = SaveWebhookPayload | TestWebhookPayload;

export type WebhookUrlValidation = { ok: true; url: string } | { ok: false; message: string };

export const validateWebhookUrl = (value: string): WebhookUrlValidation => {
  const candidate = value.trim();
  if (!candidate) return { ok: false, message: "Enter an HTTPS webhook URL" };

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, message: "Enter a valid HTTPS webhook URL" };
  }
  if (url.protocol !== "https:") return { ok: false, message: "Use an HTTPS webhook URL" };
  if (url.username || url.password) {
    return { ok: false, message: "Put authentication in the query string" };
  }
  if (url.hash) return { ok: false, message: "Remove the URL fragment" };
  return { ok: true, url: candidate };
};

export const getWebhookDataTypes = (fields: WebhookFieldSelection): WebhookDataType[] => [
  WEBHOOK_DATA_TYPES.BROWSING_ACTIVITY,
  WEBHOOK_DATA_TYPES.WEBSITE_ACTIVITY,
  ...(fields.includePageTitle || fields.includeSelectionText
    ? [WEBHOOK_DATA_TYPES.WEBSITE_CONTENT]
    : []),
];

export const createSaveWebhookPayload = (
  source: SaveWebhookSource,
  fields: WebhookFieldSelection,
  now = new Date(),
): SaveWebhookPayload => ({
  version: 1,
  event: "save",
  timestamp: now.toISOString(),
  url: source.selectedUrl,
  ...(fields.includePageUrl && source.pageUrl ? { pageUrl: source.pageUrl } : {}),
  ...(fields.includePageTitle && source.pageTitle ? { pageTitle: source.pageTitle } : {}),
  ...(fields.includeSelectionText && source.selectionText
    ? { selectionText: source.selectionText }
    : {}),
});

export const createTestWebhookPayload = (now = new Date()): TestWebhookPayload => ({
  version: 1,
  event: "test",
  timestamp: now.toISOString(),
});

type WebhookResponse = Pick<Response, "ok" | "status">;
type WebhookFetch = (input: string, init: RequestInit) => Promise<WebhookResponse>;

export const postWebhook = async (
  endpoint: string,
  payload: WebhookPayload,
  dependencies: { fetcher?: WebhookFetch; timeoutMs?: number } = {},
): Promise<WebhookResponse> => {
  const validation = validateWebhookUrl(endpoint);
  if (!validation.ok) throw new Error(validation.message);

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), dependencies.timeoutMs ?? 8000);
  try {
    const response = await (dependencies.fetcher ?? globalThis.fetch)(validation.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    return { ok: response.ok, status: response.status };
  } finally {
    globalThis.clearTimeout(timeout);
  }
};

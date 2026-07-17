// Deliberately shared, not feature-owned: config/option-schema.ts validates
// stored webhook settings, downloads/webhook-delivery.ts performs the fetch,
// and options/integrations/webhook-panel.ts renders the UI. config/ may only
// reach shared/platform (scripts/check-import-cycles.js), so this cannot move
// into downloads/ or options/ without breaking that boundary; it stays here
// as a cross-context contract plus pure helper (docs/CODE-ORGANIZATION.md
// Phase 3.1).
import { parsePatternList, type PatternListResult } from "./pattern-list.ts";

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

// Each rejection names its reason so the editor can translate it. The reason is
// the i18n key: validateWebhookUrl's English `message` is the fallback for
// callers with nowhere to render a translated one (postWebhook throws it).
export const WEBHOOK_ENDPOINT_REASONS = {
  EMPTY: "webhookEndpointEmpty",
  MALFORMED: "webhookEndpointMalformed",
  NOT_HTTPS: "webhookEndpointNotHttps",
  CREDENTIALS: "webhookEndpointCredentials",
  FRAGMENT: "webhookEndpointFragment",
  OVER_LIMIT: "webhookEndpointOverLimit",
} as const;

export type WebhookEndpointReason =
  (typeof WEBHOOK_ENDPOINT_REASONS)[keyof typeof WEBHOOK_ENDPOINT_REASONS];

// PatternListIssue carries a bare Error, which the match-pattern and regular
// expression dialects are content with: they have one reason each. Webhook
// endpoints have several, so the reason rides on the error rather than widening
// PatternListIssue for the one consumer that needs it.
class WebhookEndpointError extends Error {
  readonly reason: WebhookEndpointReason;

  constructor(reason: WebhookEndpointReason, message: string) {
    super(message);
    this.name = "WebhookEndpointError";
    this.reason = reason;
  }
}

export const webhookEndpointReason = (error: Error): WebhookEndpointReason =>
  error instanceof WebhookEndpointError ? error.reason : WEBHOOK_ENDPOINT_REASONS.MALFORMED;

export type WebhookUrlValidation =
  | { ok: true; url: string }
  | { ok: false; reason: WebhookEndpointReason; message: string };

export const validateWebhookUrl = (value: string): WebhookUrlValidation => {
  const candidate = value.trim();
  if (!candidate) {
    return {
      ok: false,
      reason: WEBHOOK_ENDPOINT_REASONS.EMPTY,
      message: "Enter an HTTPS webhook URL",
    };
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return {
      ok: false,
      reason: WEBHOOK_ENDPOINT_REASONS.MALFORMED,
      message: "Enter a valid HTTPS webhook URL",
    };
  }
  if (url.protocol !== "https:") {
    return {
      ok: false,
      reason: WEBHOOK_ENDPOINT_REASONS.NOT_HTTPS,
      message: "Use an HTTPS webhook URL",
    };
  }
  if (url.username || url.password) {
    return {
      ok: false,
      reason: WEBHOOK_ENDPOINT_REASONS.CREDENTIALS,
      message: "Put authentication in the query string",
    };
  }
  if (url.hash) {
    return {
      ok: false,
      reason: WEBHOOK_ENDPOINT_REASONS.FRAGMENT,
      message: "Remove the URL fragment",
    };
  }
  return { ok: true, url: candidate };
};

// Endpoints are stored the way the other list-shaped options are: newline
// delimited text, parsed through parsePatternList so the editor can report a
// bad line where the user wrote it. A profile saved when this held one URL
// parses as a one-entry list, so it keeps working with no migration.
//
// The list is bounded because it comes from configuration, which is untrusted:
// an imported profile naming an endpoint per line would otherwise turn one save
// into a fan-out to all of them. Lines past the limit are reported rather than
// dropped silently, so the list never claims to send more than it sends.
export const WEBHOOK_TARGET_LIMIT = 10;

export const parseWebhookEndpoints = (
  value: string | null | undefined,
): PatternListResult<string> => {
  // Pinned: WebhookEndpointError is an Error subtype, so an inferred Value
  // would widen to string | WebhookEndpointError instead of the error branch.
  const parsed = parsePatternList<string>(value, (line) => {
    const validation = validateWebhookUrl(line);
    return validation.ok
      ? validation.url
      : new WebhookEndpointError(validation.reason, validation.message);
  });
  if (parsed.entries.length <= WEBHOOK_TARGET_LIMIT) return parsed;

  // Only usable endpoints count against the limit: a rejected line is already
  // an issue and was never going to be sent to.
  const overflow = parsed.entries
    .slice(WEBHOOK_TARGET_LIMIT)
    .map(({ value: _endpoint, ...rest }) => ({
      ...rest,
      error: new WebhookEndpointError(
        WEBHOOK_ENDPOINT_REASONS.OVER_LIMIT,
        `Only the first ${WEBHOOK_TARGET_LIMIT} endpoints are sent`,
      ),
    }));
  return {
    entries: parsed.entries.slice(0, WEBHOOK_TARGET_LIMIT),
    issues: [...parsed.issues, ...overflow].sort((a, b) => a.start - b.start),
  };
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

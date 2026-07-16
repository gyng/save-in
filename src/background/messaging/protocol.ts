import { splitLines, withUrl } from "../../shared/util.ts";
import { options } from "../../config/options-data.ts";
import type { CurrentTab } from "../../platform/current-tab.ts";
import type { InternalMessage, ResponseFor } from "../../shared/message-protocol.ts";
import type { SendResponse } from "../message-dispatch.ts";

export type MessageSender = { id?: string | undefined; tab?: CurrentTab | undefined };
export type ProtocolSendResponse<Request extends InternalMessage> = SendResponse<
  ResponseFor<Request>
>;

// ─── External DOWNLOAD API (issue #110) ────────────────────────────────
// Versioned, supported contract for other extensions to push a URL into
// save-in's routing/rename pipeline. Callers should PING first to discover
// the version and capabilities. Documented in docs/INTEGRATIONS.md.
export const API_VERSION = 1;
export const API_CAPABILITIES = [
  "download", // { type: "DOWNLOAD", body: { url, info?, comment?, version? } }
  "active_tab", // body.target:"activeTab" resolves the originating or active browser tab
  "ping", // { type: "PING" } -> { version, capabilities }
  "routing", // the URL runs through the user's rename/route rules
  "comment", // body.comment is targetable in routing rules
  "info", // body.info fields: pageUrl, srcUrl, selectionText, menuIndex, ...
  "schema", // { type: "GET_SCHEMA" } -> the option schema (read-only)
  "vocabulary", // GET_KEYWORDS includes routing and automatic-routing vocabulary
  "grammar", // GET_GRAMMARS returns the supported EBNF and semantic constraints
  "validate", // VALIDATE dry-runs both editable grammars (read-only)
  "automatic_routing_validation", // routing rules can include an automatic-source trace
  "sender_allowlist", // DOWNLOAD requires the browser-authenticated sender.id to be allowed
  // apply_config (mutating) is intentionally NOT advertised: it is reachable
  // only from same-extension callers, not onMessageExternal
];
export const API_ERRORS = {
  BAD_REQUEST: "BAD_REQUEST", // malformed message (e.g. missing url)
  INVALID_URL: "INVALID_URL", // url is not a fetchable http(s)/ftp/data URL
  RATE_LIMITED: "RATE_LIMITED", // caller exceeded the bounded validation burst rate
  UNAUTHORIZED: "UNAUTHORIZED", // caller is not in the user's external-download allowlist
  UNKNOWN_TYPE: "UNKNOWN_TYPE", // unrecognised message type
};

// The manifest stays open so users can choose integrations dynamically;
// sender.id is browser-authenticated and enforces that choice at runtime.
export const isExternalDownloadAllowed = (sender: MessageSender): boolean =>
  typeof sender.id === "string" &&
  splitLines(options.externalDownloadAllowlist).some((id) => id === sender.id);

// Only schemes the downloads pipeline can actually fetch are accepted from
// external callers — this keeps javascript:/file:/extension: URLs from being
// turned into downloads by another extension.
export const isValidDownloadUrl = (url: unknown): boolean => {
  if (!url || typeof url !== "string") {
    return false;
  }
  // blob: is included because the extension downloads fetched content via
  // blob URLs on Firefox (data: URLs are rejected there by downloads.download)
  return withUrl(
    url,
    (u) => ["http:", "https:", "ftp:", "data:", "blob:"].includes(u.protocol),
    false,
  );
};

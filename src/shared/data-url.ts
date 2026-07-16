import { Sha256 } from "./sha256.ts";

// `data:` URL support for the automatic scan (phase C). A `data:` URL is
// self-contained — its bytes are the string — so it rides a runtime message and
// is keyed in the once-per-visit dedup set and stored in history. Those places
// must not hold megabyte strings, so the cap, hash-dedup threshold, and display
// truncation below bound what the string costs at each boundary.

// The whole `data:` string is the payload. Cap its length (UTF-16 code units)
// so a page cannot push an unbounded string through the automatic-save message.
export const DATA_URL_MAX_LENGTH = 2 * 1024 * 1024; // 2 MB

// Above this the dedup set keys on a hash instead of the raw string, so the
// `seen` set never holds a megabyte value. Short `data:` URLs keep using the
// string, matching how http(s) URLs are keyed.
export const DATA_URL_DEDUP_THRESHOLD = 1024; // 1 KB

// History stores this many leading characters plus an ellipsis: enough to
// recognize the media type without persisting the payload.
export const DATA_URL_DISPLAY_LENGTH = 100;

export const isDataUrl = (value: string): boolean => /^data:/i.test(value);

// Length is the payload budget: enforced identically before the content scan
// sends a candidate and again at the background backstop.
export const isDataUrlWithinCap = (value: string): boolean => value.length <= DATA_URL_MAX_LENGTH;

// Parse the mediatype from a `data:[<mediatype>][;base64],<data>` header. A
// header with no `type/subtype` (empty, `;base64` only, or malformed with no
// comma) has no parseable mediatype and takes application/octet-stream
// semantics, so mime-based matching and :mimeext: naming still resolve.
export const parseDataUrlMediaType = (value: string): string => {
  const comma = value.indexOf(",");
  if (comma === -1) return "application/octet-stream";
  const header = value.slice("data:".length, comma);
  /* v8 ignore next -- String.prototype.split always yields at least one element; the fallback only satisfies noUncheckedIndexedAccess. */
  const mediatype = (header.split(";")[0] ?? "").trim();
  return mediatype.includes("/") ? mediatype : "application/octet-stream";
};

// The dedup key for the once-per-visit `seen` set. http(s) and short `data:`
// URLs key on the string; long `data:` URLs key on a SHA-256 so the set never
// holds a megabyte value. Deterministic, so a later delete recomputes the same
// key without tracking it on the candidate.
export const automaticSeenKey = (url: string): string =>
  isDataUrl(url) && url.length > DATA_URL_DEDUP_THRESHOLD
    ? `sha256:${new Sha256().update(new TextEncoder().encode(url)).hex()}`
    : url;

// A history-safe display form for a `data:` URL: the leading characters plus an
// ellipsis. Short `data:` URLs (and every http(s) URL) round-trip unchanged.
export const truncateDataUrlForDisplay = (value: string): string =>
  value.length <= DATA_URL_DISPLAY_LENGTH ? value : `${value.slice(0, DATA_URL_DISPLAY_LENGTH)}…`;

// Wrap a stored history URL/source field so a `data:` payload is truncated but
// every other value is left exactly as-is.
export const historyDisplayUrl = (value: string | undefined): string | undefined =>
  value && isDataUrl(value) ? truncateDataUrlForDisplay(value) : value;

import { Sha256 } from "./sha256.ts";

// `data:` URL support for the automatic scan (phase C). A `data:` URL is
// self-contained — its bytes are the string — so it rides a runtime message and
// is keyed in the once-per-visit dedup set. Automatic-save history stores only a
// display form. Those places must not hold megabyte strings, so the cap,
// hash-dedup threshold, and display truncation below bound each boundary.

// The whole `data:` string is the payload. Cap its length (UTF-16 code units)
// so a page cannot push an unbounded string through the automatic-save message.
export const DATA_URL_MAX_LENGTH = 2 * 1024 * 1024; // 2 MB

// Above this the dedup set keys on a hash instead of the raw string, so the
// `seen` set never holds a megabyte value. Short `data:` URLs keep using the
// string, matching how http(s) URLs are keyed.
export const DATA_URL_DEDUP_THRESHOLD = 1024; // 1 KB
const DATA_URL_MEDIA_TYPE_MAX_LENGTH = 127;
const MEDIA_TYPE_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

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
  const start = "data:".length;
  const semicolon = value.indexOf(";", start);
  const end = semicolon >= 0 && semicolon < comma ? semicolon : comma;
  if (end - start > DATA_URL_MEDIA_TYPE_MAX_LENGTH) return "application/octet-stream";
  const mediatype = value.slice(start, end).trim();
  return mediatype.length <= DATA_URL_MEDIA_TYPE_MAX_LENGTH && MEDIA_TYPE_PATTERN.test(mediatype)
    ? mediatype.toLowerCase()
    : "application/octet-stream";
};

// The dedup key for the once-per-visit `seen` set. http(s) and short `data:`
// URLs key on the string; long `data:` URLs key on a SHA-256 so the set never
// holds a megabyte value. Deterministic, so a later delete recomputes the same
// key without tracking it on the candidate.
export const automaticSeenKey = (url: string): string =>
  isDataUrl(url) && url.length > DATA_URL_DEDUP_THRESHOLD
    ? `sha256:${new Sha256().update(new TextEncoder().encode(url)).hex()}`
    : url;

// A payload-free display form for a data: URL. Parameters other than the
// standardized base64 marker are omitted too: arbitrary header parameters are
// page-controlled and are not needed to identify the source type.
export const truncateDataUrlForDisplay = (value: string): string => {
  if (!isDataUrl(value)) return value;
  const comma = value.indexOf(",");
  if (comma < 0) return "data:…";
  const mediaType = parseDataUrlMediaType(value);
  // Display metadata is best-effort. Inspect only a bounded header prefix so
  // a semicolon-heavy 2 MiB header cannot allocate a million-element array.
  const headerPrefix = value.slice("data:".length, Math.min(comma, "data:".length + 512));
  const base64 = /(?:^|;)\s*base64\s*(?:;|$)/i.test(headerPrefix);
  return `data:${mediaType}${base64 ? ";base64" : ""},…`;
};

// Wrap a stored history URL/source field so a `data:` payload is truncated but
// every other value is left exactly as-is.
export const historyDisplayUrl = (value: string | undefined): string | undefined =>
  value && isDataUrl(value) ? truncateDataUrlForDisplay(value) : value;

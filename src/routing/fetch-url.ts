import { SPECIAL_DIRS } from "../shared/constants.ts";
import { withUrl } from "../shared/util.ts";
import { FETCH_URL_BANNED_VARIABLES } from "./path-variables.ts";
import type { RoutingDownloadInfo } from "./rule-types.ts";
import { ensureTransformerInfo, transformers } from "./variable.ts";

// Longest-first so ":sha256full:" is never consumed as ":sha256:" + "full:".
const FETCH_VARIABLE_PATTERN = new RegExp(
  `(${Object.values(SPECIAL_DIRS)
    .filter((value) => value !== SPECIAL_DIRS.SEPARATOR)
    .sort((a, b) => b.length - a.length)
    .join("|")})`,
);

// Expands routing variables inside a fetch: URL template. This deliberately
// never goes through Path: a URL's slashes and query must stay literal, and
// filename sanitization would corrupt them. Values are substituted verbatim —
// captures come from URLs and are typically already percent-encoded, and
// encoding here would break intentional multi-component insertions.
export const expandFetchUrl = async (
  template: string,
  info: RoutingDownloadInfo,
): Promise<string> => {
  ensureTransformerInfo(info);
  const tokens = template.split(FETCH_VARIABLE_PATTERN).filter(Boolean);
  const resolved = await Promise.all(
    tokens.map(async (token) => {
      // The parser rejects these; skipping here keeps a stale stored rule
      // from triggering a metadata fetch of the URL being replaced.
      if (FETCH_URL_BANNED_VARIABLES.has(token)) return token;
      const transformer = transformers[token];
      if (!transformer) return token;
      return String(await transformer(info));
    }),
  );
  return resolved.join("");
};

// Characters the WHATWG URL parser rewrites the authority boundary around for
// special (http/https) schemes, any of which can promote a path segment to the
// host when a substituted value contains them: tab/CR/LF are stripped and C0
// controls trimmed anywhere in the string, and "\" is treated as "/". Reject
// every one so the string we validate is the string the parser parses. A
// legitimate backslash in a path is percent-encoded (%5C) and still passes; a
// space cannot survive in an authority (parsing fails) and is fine in a path.
// eslint-disable-next-line no-control-regex -- rejecting the control range is the point
const RESTRUCTURES_AUTHORITY = /[\x00-\x1f\x7f\\]/;

// An expanded template is only usable when its authority is literally
// present and the string carries nothing the parser would restructure. An
// empty substitution can collapse "https:///path" into a URL whose HOST
// becomes the first path segment even though the WHATWG parser accepts it.
export const isUsableFetchRewrite = (value: string): boolean =>
  /^https?:\/\/[^/?#]/i.test(value) &&
  !RESTRUCTURES_AUTHORITY.test(value) &&
  withUrl(value, (url) => url.protocol === "https:" || url.protocol === "http:", false);

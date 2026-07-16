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

// The WHATWG parser strips tab/CR/LF anywhere in the string before parsing,
// so "https://\t/x" would reparse with host "x"; every C0 control in an
// expanded URL is substitution garbage that must fail closed rather than
// restructure the request. Space stays allowed: it cannot survive in an
// authority (parsing fails) and is legitimate, percent-encoded, in paths.
const hasControlCharacter = (value: string): boolean =>
  [...value].some((char) => {
    const code = char.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });

// An expanded template is only usable when its authority is literally
// present and the string contains nothing the parser would restructure. An
// empty substitution can collapse "https:///path" into a URL whose HOST
// becomes the first path segment even though the WHATWG parser accepts it.
export const isUsableFetchRewrite = (value: string): boolean =>
  /^https?:\/\/[^/?#]/i.test(value) &&
  !hasControlCharacter(value) &&
  withUrl(value, (url) => url.protocol === "https:" || url.protocol === "http:", false);

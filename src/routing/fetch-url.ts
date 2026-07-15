import { SPECIAL_DIRS } from "../shared/constants.ts";
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

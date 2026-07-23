import { withUrl } from "../shared/util.ts";
import { FETCH_URL_BANNED_VARIABLES } from "./path-variables.ts";
import type { RoutingDownloadInfo } from "./rule-types.ts";
import { expandVariableTemplate } from "./variable.ts";

// Expands routing variables inside a fetch: URL template. Values are
// substituted verbatim — captures come from URLs and are typically already
// percent-encoded, and encoding here would break intentional multi-component
// insertions. The parser rejects the banned variables; skipping them here
// keeps a stale stored rule from triggering a metadata fetch of the URL
// being replaced.
export const expandFetchUrl = (template: string, info: RoutingDownloadInfo): Promise<string> =>
  expandVariableTemplate(template, info, FETCH_URL_BANNED_VARIABLES);

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

// Chrome reports downloadItem.url in WHATWG-canonical form, and the filename
// listener correlates pending saves by exact string. Handing the parsed href
// forward (spaces percent-encoded, host lowercased, default port dropped)
// keeps the key the pipeline stores identical to the one the browser echoes;
// a verbatim expansion with a space would otherwise never settle its save.
export const canonicalFetchRewrite = (value: string): string | null =>
  isUsableFetchRewrite(value) ? withUrl(value, (url) => url.href, null) : null;

// Validate the parts that are knowable before captures and variables expand.
// A numeric placeholder remains valid in a host, port, path, query, or fragment.
export const isUsableFetchTemplate = (value: string): boolean =>
  isUsableFetchRewrite(
    value.replace(/:[A-Za-z$][A-Za-z0-9_$]*:/g, (token, offset: number) => {
      const insideBracketedHost = value.lastIndexOf("[", offset) > value.lastIndexOf("]", offset);
      return insideBracketedHost && !token.startsWith(":$") ? token : "80";
    }),
  );

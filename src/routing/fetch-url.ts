import { withUrl } from "../shared/util.ts";
import { FETCH_URL_BANNED_VARIABLES } from "./path-variables.ts";
import type { RoutingDownloadInfo } from "./rule-types.ts";
import { expandVariableTemplateParts } from "./variable.ts";
import { deriveUrlFilenames } from "./filename.ts";

// The download plan and its offline trace must retain the same request context
// and discard the same resource-derived values when fetch: changes the URL.
// Resource owners release any fetched content before replacing their info.
export const retargetDownloadInfo = <Info extends RoutingDownloadInfo>(info: Info, url: string) => {
  /* eslint-disable no-unused-vars -- Destructuring deliberately omits resource-derived fields. */
  const {
    headPromise,
    resolvedHead,
    contentPromise,
    loadContent,
    sha256,
    mime,
    mimeExtension,
    resolvedFilename,
    protectedFetchReferer,
    contentFetchDisabled,
    ...context
  } = info;
  /* eslint-enable no-unused-vars */
  const { naiveFilename, initialFilename } = deriveUrlFilenames(url, context.suggestedFilename);
  return { ...context, url, naiveFilename, filename: initialFilename, initialFilename };
};

// A fetch: template pins the host the request goes to. A capture or variable
// written inside the template's authority (everything from "://" to the first
// literal "/", "?" or "#") may therefore only contribute host characters, and
// optionally a trailing port: a loose capture or page text of "evil.example/"
// in "https://:$1:.cdn.example/full/x" would otherwise end the authority early
// and send the request, with the extension's cookie and Referer handling, to a
// host the page chose. The alphabet is ASCII on purpose: "@", "\", "%2F", a
// fullwidth solidus and an ideographic full stop are all things some parser
// folds into a separator. A port that is not followed by the end of the
// authority leaves a URL the parser rejects, so it cannot move the host either.
const AUTHORITY_VALUE = /^[A-Za-z0-9.-]*(?::[0-9]{1,5})?$/;

// Where the template's authority ends. A template that does not literally
// begin with its scheme has no position that is safely outside the authority.
const fetchAuthorityEnd = (template: string): number =>
  /^https?:\/\/[^/?#]*/i.exec(template)?.[0].length ?? Infinity;

// What a refused expansion becomes. It is not a URL and holds no variable, so
// every later step treats it as it treats any other unusable expansion: the
// save fails closed and says so in the log, and never falls back to the
// address the rule was written to replace.
const REFUSED_FETCH_EXPANSION = "refused: a value placed in the host is not a host name";

// Substitutes a rule's captures into its fetch: template. Captures are page-
// and server-controlled text, so one placed in the authority is held to
// AUTHORITY_VALUE; anywhere else it is substituted verbatim, as before.
export const substituteFetchCaptures = (
  template: string,
  captured: (string | undefined)[] | null,
): string => {
  if (!captured) return template;
  const authorityEnd = fetchAuthorityEnd(template);
  let refused = false;
  const substituted = template.replace(/:\$(\d+):/g, (_token, index: string, offset: number) => {
    const value = captured[Number(index)] ?? "";
    if (offset < authorityEnd && !AUTHORITY_VALUE.test(value)) refused = true;
    return value;
  });
  return refused ? REFUSED_FETCH_EXPANSION : substituted;
};

// Expands routing variables inside a fetch: URL template. Values are
// substituted verbatim — captures come from URLs and are typically already
// percent-encoded, and encoding here would break intentional multi-component
// insertions. The parser rejects the banned variables; skipping them here
// keeps a stale stored rule from triggering a metadata fetch of the URL
// being replaced. A variable inside the authority is held to the same rule as
// a capture there. Captures were substituted, and checked, before this runs,
// so the authority still ends where the rule's author wrote its end.
export const expandFetchUrl = async (
  template: string,
  info: RoutingDownloadInfo,
): Promise<string> => {
  const authorityEnd = fetchAuthorityEnd(template);
  const parts = await expandVariableTemplateParts(template, info, FETCH_URL_BANNED_VARIABLES);
  let offset = 0;
  let refused = false;
  const expanded = parts.map(({ source, value, variable }) => {
    if (variable && offset < authorityEnd && !AUTHORITY_VALUE.test(value)) refused = true;
    offset += source.length;
    return value;
  });
  return refused ? REFUSED_FETCH_EXPANSION : expanded.join("");
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

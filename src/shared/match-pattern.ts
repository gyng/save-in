import { parsePatternList, type PatternListResult } from "./pattern-list.ts";

export type ParsedMatchPattern = {
  readonly source: string;
  readonly scheme: string;
  readonly host: string;
  readonly path: string;
  readonly regexp: RegExp;
};

export const parseMatchPattern = (pattern: string): ParsedMatchPattern | Error => {
  const parts = pattern.match(/^(\*|https?|file|ftp):\/\/([^/]*)(\/.*)$/);
  if (!parts) return new Error("Invalid WebExtension match pattern");
  const [, rawScheme, host, path] = parts;
  /* v8 ignore next -- A successful fixed-capture match always supplies all three groups. */
  if (rawScheme === undefined || host === undefined || path === undefined) {
    return new Error("Invalid WebExtension match pattern");
  }
  if (rawScheme !== "file" && host.length === 0) {
    return new Error("Network match patterns require a host");
  }
  const escapeRegExp = (value: string): string => value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const scheme = rawScheme === "*" ? "https?" : rawScheme;
  // Hosts are case-insensitive per the match-pattern spec, and the URL parser
  // lowercases them, so compile the host lowercased to match. The path stays
  // case-sensitive, and `host` is returned unchanged for the editor's offsets.
  const matchHost = host.toLowerCase();
  const hostPattern =
    matchHost === "*"
      ? "[^/]+"
      : matchHost.startsWith("*.")
        ? `([^/]+\\.)?${escapeRegExp(matchHost.slice(2))}`
        : escapeRegExp(matchHost);
  const pathPattern = path.split("*").map(escapeRegExp).join(".*");
  const port = rawScheme === "file" ? "" : "(?::\\d+)?";
  return {
    source: pattern,
    scheme: rawScheme,
    host,
    path,
    regexp: new RegExp(`^${scheme}://${hostPattern}${port}${pathPattern}$`),
  };
};

export const matchPatternToRegExp = (pattern: string): RegExp | null => {
  const parsed = parseMatchPattern(pattern);
  return parsed instanceof Error ? null : parsed.regexp;
};

export const parseMatchPatternList = (
  patterns: string | null | undefined,
): PatternListResult<ParsedMatchPattern> => parsePatternList(patterns, parseMatchPattern);

// WebExtension match patterns are specified to ignore the URL fragment
// (https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Match_patterns),
// but the compiled regexps are $-anchored, so a trailing #fragment would defeat
// them. Strip it here so a page URL carrying a fragment cannot bypass the
// per-site disable list. Used for values the parser rejects.
const withoutFragment = (url: string): string => {
  const hash = url.indexOf("#");
  return hash === -1 ? url : url.slice(0, hash);
};

// Patterns compare the scheme and host case-insensitively and ignore userinfo,
// but the compiled pattern is a case-sensitive textual regexp anchored on the
// host. Canonicalize through the parser — which lowercases scheme+host, drops
// embedded credentials, and strips the default port and fragment — so a
// "https://user@host/" URL cannot present a different apparent host than the
// browser would act on, and a lowercase page host still meets the pattern. The
// path stays case-sensitive per the spec. A value the parser rejects falls back
// to the raw (fragment-stripped) string so nothing that matched before stops.
const canonicalForMatch = (url: string): string => {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
  } catch {
    return withoutFragment(url);
  }
};

export const matchesAnyPattern = (url: string, patterns: string): boolean => {
  const candidate = canonicalForMatch(url);
  return parseMatchPatternList(patterns).entries.some(({ value }) => value.regexp.test(candidate));
};

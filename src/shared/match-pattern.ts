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
  const hostPattern =
    host === "*"
      ? "[^/]+"
      : host.startsWith("*.")
        ? `([^/]+\\.)?${escapeRegExp(host.slice(2))}`
        : escapeRegExp(host);
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
// them. Strip it here — the one place every consumer shares — so a page URL
// carrying a fragment cannot bypass the per-site disable list. Network URLs the
// Referer/ordinary-download filter passes are already fragment-free, so this is
// behavior-preserving there.
const withoutFragment = (url: string): string => {
  const hash = url.indexOf("#");
  return hash === -1 ? url : url.slice(0, hash);
};

export const matchesAnyPattern = (url: string, patterns: string): boolean => {
  const withoutHash = withoutFragment(url);
  return parseMatchPatternList(patterns).entries.some(({ value }) =>
    value.regexp.test(withoutHash),
  );
};

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

export const matchesAnyPattern = (url: string, patterns: string): boolean =>
  parseMatchPatternList(patterns).entries.some(({ value }) => value.regexp.test(url));

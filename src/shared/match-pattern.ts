import { splitLines } from "./util.ts";

export const matchPatternToRegExp = (pattern: string): RegExp | null => {
  const escapeRegExp = (value: string): string => value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const parts = pattern.match(/^(\*|https?|file|ftp):\/\/([^/]*)(\/.*)$/);
  if (!parts) return null;
  const rawScheme = parts[1]!;
  const rawHost = parts[2]!;
  const rawPath = parts[3]!;
  const scheme = rawScheme === "*" ? "https?" : rawScheme;
  const host =
    rawHost === "*"
      ? "[^/]+"
      : rawHost.startsWith("*.")
        ? `([^/]+\\.)?${escapeRegExp(rawHost.slice(2))}`
        : escapeRegExp(rawHost);
  const path = rawPath.split("*").map(escapeRegExp).join(".*");
  const port = rawScheme === "file" ? "" : "(?::\\d+)?";
  return new RegExp(`^${scheme}://${host}${port}${path}$`);
};

export const matchesAnyPattern = (url: string, patterns: string): boolean =>
  splitLines(patterns).some((pattern) => matchPatternToRegExp(pattern)?.test(url) === true);

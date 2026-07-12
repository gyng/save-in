import { splitLines } from "./util.ts";

export const matchPatternToRegExp = (pattern: string): RegExp | null => {
  const escapeRegExp = (value: string): string => value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const parts = pattern.match(/^(\*|https?|file|ftp):\/\/([^/]*)(\/.*)$/);
  if (!parts) return null;
  const scheme = parts[1] === "*" ? "https?" : parts[1];
  const host =
    parts[2] === "*"
      ? "[^/]+"
      : parts[2].startsWith("*.")
        ? `([^/]+\\.)?${escapeRegExp(parts[2].slice(2))}`
        : escapeRegExp(parts[2]);
  const path = parts[3].split("*").map(escapeRegExp).join(".*");
  const port = parts[1] === "file" ? "" : "(?::\\d+)?";
  return new RegExp(`^${scheme}://${host}${port}${path}$`);
};

export const matchesAnyPattern = (url: string, patterns: string): boolean =>
  splitLines(patterns).some((pattern) => {
    try {
      return matchPatternToRegExp(pattern)?.test(url) === true;
    } catch {
      return false;
    }
  });

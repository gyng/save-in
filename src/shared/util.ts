// Parse `str` as a URL and return `cb(url)`; on a parse failure return
// `fallback`. Callers choose the fallback because their failure values differ.
export const withUrl = <T, F = null>(
  str: string,
  cb: (url: URL) => T,
  fallback: F = null as F,
): T | F => {
  try {
    return cb(new URL(str));
  } catch {
    return fallback;
  }
};

// Empty lines must disappear before callers turn the result into regular
// expressions; otherwise an empty pattern matches every URL.
export const splitLines = (raw: string | null | undefined): string[] =>
  (raw || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

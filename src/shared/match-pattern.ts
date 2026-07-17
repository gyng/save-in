import { parsePatternList, type PatternListResult } from "./pattern-list.ts";

export type ParsedMatchPattern = {
  readonly source: string;
  readonly scheme: string;
  readonly host: string;
  readonly path: string;
  readonly regexp: RegExp;
};

// Punycode a pattern host the way the URL parser canonicalises a page host.
// A host the parser rejects is left as written: it simply will not match, which
// is what it did before.
const toAsciiHost = (value: string): string => {
  if (!value) return value;
  // Only text that really was a bare host may canonicalise. The parser resolves
  // userinfo, so `i.pximg.net@evil.com` would compile to `evil.com` — an entry
  // scoping somewhere other than where it reads. It also drops a port matching
  // the scheme borrowed below, which would widen the entry to every port the
  // host answers on. Neither is part of the pattern grammar, so read them off
  // the raw text and leave it as written, matching nothing as it did before.
  const hostEnd = value.startsWith("[") ? value.indexOf("]") + 1 : 0;
  if (value.includes("@") || value.includes(":", hostEnd)) return value;
  try {
    const url = new URL(`https://${value}`);
    // Anything the borrowed scheme let the parser absorb — a query or fragment
    // the host regexp allowed through — means the text was never a bare host.
    if (url.href !== `https://${url.host}/`) return value;
    return url.host;
  } catch {
    return value;
  }
};

const parseMatchPattern = (pattern: string): ParsedMatchPattern | Error => {
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
  // The spec allows `*` in a host only as the entire host or as a leading `*.`
  // label, and both browsers reject anything else. Accepting it here would be
  // worse than useless: escapeRegExp deliberately leaves `*` alone so the path
  // can split on it, so an embedded `*` reaches the regexp as a quantifier on
  // the character before it. `foo*.example.com` compiles to
  // /foo*\.example\.com/, which matches fo.example.com — a host the user never
  // wrote — and misses every host they meant.
  const hostLiteral = matchHost === "*" ? "" : matchHost.replace(/^\*\./, "");
  if (hostLiteral.includes("*")) {
    return new Error("Host wildcards are only allowed as '*' or a leading '*.'");
  }
  // canonicalForMatch compares against a URL-parsed host, which is punycode, so
  // compile the pattern's host through the same parser. A user writes the host
  // the way their address bar shows it ("例え.jp"); left as the raw unicode it
  // could never meet "xn--r8jz45g.jp" and the entry silently never fired. ASCII
  // hosts round-trip unchanged, so existing patterns compile identically.
  const asciiLiteral = toAsciiHost(hostLiteral);
  const hostPattern =
    matchHost === "*"
      ? "[^/]+"
      : matchHost.startsWith("*.")
        ? `([^/]+\\.)?${escapeRegExp(asciiLiteral)}`
        : escapeRegExp(asciiLiteral);
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

// A list that decides what to LEAVE ALONE cannot read a rejected pattern as
// "no match": that answer silently drops the exclusion and acts on exactly the
// URL the line was written to protect. A caller whose non-match means "act"
// asks for this instead, so an unreadable list withholds the action until the
// user fixes it. matchesAnyPattern stays correct for allowlists, where a
// rejected pattern already fails closed by matching nothing.
export const matchesAnyPatternOrUnreadable = (url: string, patterns: string): boolean => {
  const { entries, issues } = parseMatchPatternList(patterns);
  if (issues.length > 0) return true;
  const candidate = canonicalForMatch(url);
  return entries.some(({ value }) => value.regexp.test(candidate));
};

import { options } from "../config/options-data.ts";
import { WEB_EXTENSION_CAPABILITIES } from "../platform/chrome-detector.ts";
import { matchesAnyPattern } from "../shared/match-pattern.ts";
import { canUseRefererRules } from "./referer-rules.ts";
import type { DownloadInfo } from "./download-types.ts";

type RefererState = { info?: Pick<DownloadInfo, "url" | "pageUrl"> } | null | undefined;
type DownloadHeader = { name: string; value: string };

const getHttpReferer = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    url.username = "";
    url.password = "";
    url.hash = "";
    return url.href;
  } catch {
    return undefined;
  }
};

// The same match-pattern syntax as the per-site disable list, so it goes
// through the same matcher: compiling the patterns here separately meant the
// filter tested the raw URL while the list tested the canonical one, and an
// allowlist entry a user wrote once meant two different things. An empty list
// still allows nothing — the filter is an allowlist for a header the user only
// wants sent where they said.
export const matchesRefererFilter = (url: string): boolean =>
  matchesAnyPattern(url, options.setRefererHeaderFilter);

export const getReferer = (state: RefererState): string | undefined => {
  if (!options.setRefererHeader) return undefined;
  const pageUrl = getHttpReferer(state?.info?.pageUrl);
  const url = state?.info?.url;
  if (!pageUrl || !url || !matchesRefererFilter(url)) return undefined;
  return pageUrl;
};

export const getDownloadHeaders = (state: RefererState): DownloadHeader[] | undefined => {
  if (!WEB_EXTENSION_CAPABILITIES.downloadRequestHeaders) return undefined;
  const referer = getReferer(state);
  return referer ? [{ name: "Referer", value: referer }] : undefined;
};

// DNR protects exact extension-owned metadata/content requests. Firefox
// still attaches Referer natively when the final download remains direct.
export const getFetchReferer = (state: RefererState): string | undefined =>
  canUseRefererRules() ? getReferer(state) : undefined;

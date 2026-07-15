import { options } from "../config/options-data.ts";
import { WEB_EXTENSION_CAPABILITIES } from "../platform/chrome-detector.ts";
import { matchPatternToRegExp } from "../shared/match-pattern.ts";
import { parsePatternList } from "../shared/pattern-list.ts";
import { RefererRules } from "./referer-rules.ts";
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

export const matchesRefererFilter = (url: string): boolean =>
  parsePatternList(options.setRefererHeaderFilter, (pattern) => {
    try {
      return matchPatternToRegExp(pattern) ?? new Error("Invalid WebExtension match pattern");
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }).entries.some(({ value }) => value.test(url));

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
  RefererRules.canUse() ? getReferer(state) : undefined;

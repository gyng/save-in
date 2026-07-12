import { options } from "../config/options-data.ts";
import { WEB_EXTENSION_CAPABILITIES } from "../platform/chrome-detector.ts";
import { matchPatternToRegExp } from "../shared/match-pattern.ts";
import { splitLines } from "../shared/util.ts";
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

export const RequestHeaders = {
  matchPatternToRegExp,

  matchesRefererFilter: (url: string): boolean =>
    splitLines(options.setRefererHeaderFilter).some((pattern) => {
      try {
        return RequestHeaders.matchPatternToRegExp(pattern)?.test(url) === true;
      } catch {
        return false;
      }
    }),

  getDownloadHeaders: (state: RefererState): DownloadHeader[] | undefined => {
    if (!WEB_EXTENSION_CAPABILITIES.downloadRequestHeaders || !options.setRefererHeader) {
      return undefined;
    }
    const pageUrl = getHttpReferer(state?.info?.pageUrl);
    const url = state?.info?.url;
    if (!pageUrl || !url || !RequestHeaders.matchesRefererFilter(url)) return undefined;
    return [{ name: "Referer", value: pageUrl }];
  },
};

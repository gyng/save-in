import { BROWSERS, CURRENT_BROWSER } from "../platform/chrome-detector.ts";
import type { CurrentTab } from "../platform/current-tab.ts";

export type FirefoxDownloadContext = {
  incognito?: boolean | undefined;
};

export const resolveFirefoxDownloadContext = async (
  tab: CurrentTab | null | undefined,
): Promise<FirefoxDownloadContext> => {
  if (CURRENT_BROWSER !== BROWSERS.FIREFOX) return {};
  return tab?.incognito === true ? { incognito: true } : {};
};

import { BROWSERS, CURRENT_BROWSER } from "../platform/chrome-detector.ts";
import type { CurrentTab } from "../platform/current-tab.ts";

export type FirefoxDownloadContext = {
  incognito?: boolean | undefined;
};

export const resolveFirefoxDownloadContext = async (
  tab: CurrentTab | null | undefined,
): Promise<FirefoxDownloadContext> => {
  // Chrome exposes no Incognito selector in downloads.download(). With the
  // shared spanning manifest, Save In deliberately allows the save in Chrome's
  // regular download context; it may appear in the regular download manager
  // and Incognito-only authentication is not guaranteed. Save In still keeps
  // its own private activity out of persistent state. See PRIVACY.md.
  if (CURRENT_BROWSER !== BROWSERS.FIREFOX) return {};
  return tab?.incognito === true ? { incognito: true } : {};
};

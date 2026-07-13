import { BROWSERS, CURRENT_BROWSER } from "../platform/chrome-detector.ts";
import type { CurrentTab } from "../platform/current-tab.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";

export type DirectDownloadContext = {
  incognito?: boolean;
  cookieStoreId?: string;
};

const isHttpUrl = (url: string): boolean => {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
};

const hasCookiesPermission = async (): Promise<boolean> => {
  try {
    return (await webExtensionApi.permissions?.contains?.({ permissions: ["cookies"] })) === true;
  } catch {
    return false;
  }
};

export const resolveDirectDownloadContext = async (
  tab: CurrentTab | null | undefined,
  url: string,
): Promise<DirectDownloadContext> => {
  if (CURRENT_BROWSER !== BROWSERS.FIREFOX) return {};

  const context: DirectDownloadContext = {};
  if (tab?.incognito === true) {
    context.incognito = true;
    // Firefox rejects a private cookieStoreId from the non-private background
    // context. `incognito` selects the private jar and download manager.
    return context;
  }
  // cookieStoreId only changes the HTTP(S) request cookie jar. `incognito`
  // also controls where Firefox records any download, including data/blob URLs.
  if (!isHttpUrl(url)) return context;
  if (typeof tab?.cookieStoreId === "string" && (await hasCookiesPermission())) {
    context.cookieStoreId = tab.cookieStoreId;
  }
  return context;
};

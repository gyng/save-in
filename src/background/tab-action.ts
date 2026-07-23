import { webExtensionApi } from "../platform/web-extension-api.ts";
import type { CurrentTab } from "../platform/current-tab.ts";

// A tab id survives navigation. Routing actions name the source page, so do
// not close unrelated content that replaced it while a save was preparing.
export const closeRoutingSourceTab = async (
  sourceTab: CurrentTab,
  tabId: number,
): Promise<boolean> => {
  if (typeof sourceTab.url === "string") {
    const current = await webExtensionApi.tabs.get(tabId);
    if (current.url !== sourceTab.url) return false;
  }
  await webExtensionApi.tabs.remove(tabId);
  return true;
};

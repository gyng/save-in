import { webExtensionApi } from "../platform/web-extension-api.ts";
import type { CurrentTab } from "../platform/current-tab.ts";
import { isBrowserTabId } from "../shared/message-protocol.ts";

// One bounded question to a tab's top-frame content script. Restricted pages,
// content scripts from an older version, navigation races, and a script that
// never answers all read as "no answer": every caller has a fallback, and none
// may hold the background awake waiting on a page.
export const requestTopFrame = async (
  tab: CurrentTab | null | undefined,
  message: { type: string; body?: unknown },
  timeoutMs: number,
): Promise<unknown> => {
  if (!isBrowserTabId(tab?.id)) return null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      webExtensionApi.tabs.sendMessage(tab.id, message, { frameId: 0 }),
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
};

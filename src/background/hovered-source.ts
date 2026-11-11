import { webExtensionApi } from "../platform/web-extension-api.ts";
import type { CurrentTab } from "../platform/current-tab.ts";
import {
  HOVERED_SOURCE_REQUEST,
  parseHoveredSource,
  type HoveredSource,
} from "../shared/hovered-source.ts";
import { isBrowserTabId } from "../shared/message-protocol.ts";
import type { ClickInfo } from "./menu-target.ts";

const HOVERED_SOURCE_TIMEOUT_MS = 500;

// A keyboard command or an external request names no element. The top-frame
// content script reports what the pointer is over; only that frame runs it.
export const readHoveredSource = async (
  tab: CurrentTab | null | undefined,
): Promise<HoveredSource | null> => {
  if (!isBrowserTabId(tab?.id)) return null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      webExtensionApi.tabs.sendMessage(tab.id, { type: HOVERED_SOURCE_REQUEST }, { frameId: 0 }),
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), HOVERED_SOURCE_TIMEOUT_MS);
      }),
    ]);
    return parseHoveredSource(response);
  } catch {
    // Restricted pages, content scripts from an older version, and navigation
    // races leave the request as a save of the page itself.
    return null;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
};

// The fields a browser menu click would carry for the same element, so the
// click handler's own link and "prefer links" rules choose what is saved.
export const hoveredClickInfo = (
  hovered: HoveredSource | null,
): Pick<ClickInfo, "srcUrl" | "mediaType" | "linkUrl"> => ({
  ...(hovered?.media ? { srcUrl: hovered.media.url, mediaType: hovered.media.kind } : {}),
  ...(hovered?.linkUrl ? { linkUrl: hovered.linkUrl } : {}),
});

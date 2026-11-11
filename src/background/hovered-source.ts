import type { CurrentTab } from "../platform/current-tab.ts";
import {
  HOVERED_SOURCE_REQUEST,
  parseHoveredSource,
  type HoveredSource,
} from "../shared/hovered-source.ts";
import type { ClickInfo } from "./menu-target.ts";
import { requestTopFrame } from "./tab-request.ts";

const HOVERED_SOURCE_TIMEOUT_MS = 500;

// A keyboard command or an external request names no element. The top-frame
// content script reports what the pointer is over; only that frame runs it.
// No usable answer leaves the request as a save of the page itself.
export const readHoveredSource = async (
  tab: CurrentTab | null | undefined,
): Promise<HoveredSource | null> =>
  parseHoveredSource(
    await requestTopFrame(tab, { type: HOVERED_SOURCE_REQUEST }, HOVERED_SOURCE_TIMEOUT_MS),
  );

// The fields a browser menu click would carry for the same element, so the
// click handler's own link and "prefer links" rules choose what is saved.
export const hoveredClickInfo = (
  hovered: HoveredSource | null,
): Pick<ClickInfo, "srcUrl" | "mediaType" | "linkUrl" | "altText"> => ({
  ...(hovered?.media ? { srcUrl: hovered.media.url, mediaType: hovered.media.kind } : {}),
  ...(hovered?.media?.alt ? { altText: hovered.media.alt } : {}),
  ...(hovered?.linkUrl ? { linkUrl: hovered.linkUrl } : {}),
});

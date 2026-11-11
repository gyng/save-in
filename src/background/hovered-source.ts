import type { CurrentTab } from "../platform/current-tab.ts";
import {
  HOVERED_SOURCE_REQUEST,
  parseHoveredSource,
  type HoveredSource,
} from "../shared/hovered-source.ts";
import type { ClickInfo } from "./menu-target.ts";
import { isStringKeyedRecord } from "../shared/util.ts";
import { requestTopFrame } from "./tab-request.ts";

const HOVERED_SOURCE_TIMEOUT_MS = 500;

// A keyboard command or an external request names no element. The top-frame
// content script reports what the pointer is over; only that frame runs it.
//
// `null` is its answer that nothing saveable is hovered. `undefined` is no
// answer at all: a restricted page, a tab loaded before Save In was installed
// or updated, or a script that has not started yet. The two must stay apart,
// because "no answer" on an ordinary page says nothing about the pointer.
export const readHoveredSource = async (
  tab: CurrentTab | null | undefined,
): Promise<HoveredSource | null | undefined> => {
  const response = await requestTopFrame(
    tab,
    { type: HOVERED_SOURCE_REQUEST },
    HOVERED_SOURCE_TIMEOUT_MS,
  );
  return isStringKeyedRecord(response) && Object.hasOwn(response, "hovered")
    ? parseHoveredSource(response.hovered)
    : undefined;
};

// The fields a browser menu click would carry for the same element, so the
// click handler's own link and "prefer links" rules choose what is saved.
export const hoveredClickInfo = (
  hovered: HoveredSource | null,
): Pick<ClickInfo, "srcUrl" | "mediaType" | "linkUrl" | "altText"> => ({
  ...(hovered?.media ? { srcUrl: hovered.media.url, mediaType: hovered.media.kind } : {}),
  ...(hovered?.media?.alt ? { altText: hovered.media.alt } : {}),
  ...(hovered?.linkUrl ? { linkUrl: hovered.linkUrl } : {}),
});

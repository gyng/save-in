import type { CurrentTab } from "../platform/current-tab.ts";
import { truncateIfLongerThan } from "../routing/path.ts";
import { DOWNLOAD_TYPES, isMediaType } from "../shared/constants.ts";
import { parseRegularExpressionList } from "../shared/pattern-list.ts";

export type ClickInfo = {
  frameId?: number | undefined;
  frameUrl?: string | undefined;
  mediaType?: string | undefined;
  srcUrl?: string | undefined;
  linkUrl?: string | undefined;
  pageUrl?: string | undefined;
  selectionText?: string | undefined;
  linkText?: string | undefined;
  modifiers?: string[] | undefined;
};

type ClickOptions = {
  links?: boolean;
  selection?: boolean;
  page?: boolean;
  truncateLength: number;
  preferLinks?: boolean;
  preferLinksFilterEnabled?: boolean;
  preferLinksFilter?: string;
};

type ClickTarget = {
  downloadType: string;
  url: string | undefined;
  suggestedFilename: string | null;
  selectionText: string | null;
  notifyLinkPreferred: boolean;
  badPatternError: Error | null;
};

export const resolveClickTarget = (
  info: ClickInfo,
  clickOptions: ClickOptions,
  clickTab: CurrentTab | null | undefined,
): ClickTarget | null => {
  const hasLink = clickOptions.links && info.linkUrl;
  const result: ClickTarget = {
    downloadType: DOWNLOAD_TYPES.UNKNOWN,
    url: undefined,
    suggestedFilename: null,
    selectionText: null,
    notifyLinkPreferred: false,
    badPatternError: null,
  };

  if (isMediaType(info.mediaType)) {
    result.downloadType = DOWNLOAD_TYPES.MEDIA;
    result.url = info.srcUrl;

    if (hasLink) {
      if (clickOptions.preferLinks) {
        result.downloadType = DOWNLOAD_TYPES.LINK;
        result.url = info.linkUrl;
        result.notifyLinkPreferred = true;
      }

      if (clickOptions.preferLinksFilterEnabled && clickOptions.preferLinksFilter) {
        const parsed = parseRegularExpressionList(clickOptions.preferLinksFilter);
        const overrideUrls =
          parsed.issues.length === 0 &&
          parsed.entries.some(({ value }) => info.pageUrl?.match(value) != null);
        result.badPatternError = parsed.issues[0]?.error ?? null;

        if (overrideUrls) {
          result.downloadType = DOWNLOAD_TYPES.LINK;
          result.url = info.linkUrl;
          result.notifyLinkPreferred = true;
        }
      }
    }
  } else if (hasLink) {
    result.downloadType = DOWNLOAD_TYPES.LINK;
    result.url = info.linkUrl;
  } else if (clickOptions.selection && info.selectionText) {
    result.downloadType = DOWNLOAD_TYPES.SELECTION;
    result.selectionText = info.selectionText;
    result.suggestedFilename = `${truncateIfLongerThan(
      (clickTab && clickTab.title) || info.selectionText,
      clickOptions.truncateLength - 14,
    )}.selection.txt`;
  } else if (clickOptions.page && info.pageUrl) {
    result.downloadType = DOWNLOAD_TYPES.PAGE;
    result.url = info.pageUrl;
    result.suggestedFilename = (clickTab && clickTab.title) || info.pageUrl;
  } else {
    return null;
  }

  return result;
};

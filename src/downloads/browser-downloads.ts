import { Path } from "../routing/path.ts";
import { applyVariables, normalizeMimeType } from "../routing/variable.ts";
import { BROWSER_DOWNLOAD_CONTEXT } from "../shared/constants.ts";
import { matchesAnyPattern } from "../shared/match-pattern.ts";
import type { DownloadPipelineState } from "./download-types.ts";
import { releaseUnusedContent } from "./download-pipeline-state.ts";

export type BrowserDownloadItem = {
  url: string;
  filename: string;
  finalUrl?: string | undefined;
  mime?: string | undefined;
  referrer?: string | undefined;
  byExtensionId?: string | undefined;
};

type BrowserDownloadRouter = {
  getRoutingMatches(state: DownloadPipelineState): string | null | undefined;
  resolveRenameTransform(state: DownloadPipelineState): Promise<void>;
  finalizeFullPath(state: DownloadPipelineState): string;
};

export const BrowserDownloadRouting: {
  route: (item: BrowserDownloadItem) => Promise<string | null>;
} = { route: async () => null };

export const isReroutableBrowserDownload = (item: BrowserDownloadItem): boolean => {
  try {
    const protocol = new URL(item.finalUrl || item.url).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
};

// Shared with undo-download.ts's identity check: both need the last real path
// segment regardless of platform separators or a trailing separator.
export const proposedFilename = (filename: string): string =>
  filename.split(/[\\/]/).filter(Boolean).at(-1) || filename;

export const isOrdinaryBrowserDownload = (
  item: Pick<BrowserDownloadItem, "byExtensionId">,
  runtimeId?: string,
): boolean => {
  void runtimeId;
  return !item.byExtensionId;
};

export const matchesBrowserDownloadFilter = (
  url: string,
  filter?: string,
  excludeFilter?: string,
  enabled = true,
): boolean =>
  !enabled ||
  ((!filter || filter.trim() === "" || matchesAnyPattern(url, filter)) &&
    (!excludeFilter || excludeFilter.trim() === "" || !matchesAnyPattern(url, excludeFilter)));

export const createBrowserDownloadState = (item: BrowserDownloadItem): DownloadPipelineState => {
  const filename = proposedFilename(item.filename || item.url);
  const sourceUrl = item.finalUrl || item.url;
  const mime = normalizeMimeType(item.mime);
  return {
    path: new Path("."),
    scratch: {},
    info: {
      currentTab: null,
      url: sourceUrl,
      sourceUrl,
      ...(mime ? { mime } : {}),
      ...(item.referrer ? { referrerUrl: item.referrer } : {}),
      filename,
      resolvedFilename: filename,
      naiveFilename: filename,
      suggestedFilename: filename,
      initialFilename: filename,
      context: BROWSER_DOWNLOAD_CONTEXT,
      now: new Date(),
    },
  };
};

export const routeBrowserDownload = async (
  Download: BrowserDownloadRouter,
  item: BrowserDownloadItem,
): Promise<string | null> => {
  const state = createBrowserDownloadState(item);
  try {
    const route = Download.getRoutingMatches(state);
    if (!route) return null;
    state.routeIsFolder = /\/\s*$/.test(route);
    state.route = await applyVariables(new Path(route), state.info);
    // Ordinary browser downloads can only be renamed, and rename: is exactly a
    // rename — the matched rule's transform applies to the suggested name too.
    await Download.resolveRenameTransform(state);
    return Download.finalizeFullPath(state);
  } finally {
    // No ordinary-routing variable currently retains fetched content, but keep
    // this boundary symmetric with the normal plan so a future lazy-content
    // variable cannot strand a blob/offscreen request.
    await releaseUnusedContent(state);
  }
};

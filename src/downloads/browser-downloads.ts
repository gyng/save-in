import { Path } from "../routing/path.ts";
import { applyVariables } from "../routing/variable.ts";
import { matchesAnyPattern } from "../shared/match-pattern.ts";
import type { DownloadPipelineState } from "./download-types.ts";

export type BrowserDownloadItem = {
  url: string;
  filename: string;
  finalUrl?: string | undefined;
  byExtensionId?: string | undefined;
};

type BrowserDownloadRouter = {
  getRoutingMatches(state: DownloadPipelineState): string | null | undefined;
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

const proposedFilename = (filename: string): string =>
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
): boolean =>
  (!filter || filter.trim() === "" || matchesAnyPattern(url, filter)) &&
  (!excludeFilter || excludeFilter.trim() === "" || !matchesAnyPattern(url, excludeFilter));

export const createBrowserDownloadState = (item: BrowserDownloadItem): DownloadPipelineState => {
  const filename = proposedFilename(item.filename || item.url);
  return {
    path: new Path("."),
    scratch: {},
    info: {
      currentTab: null,
      url: item.finalUrl || item.url,
      filename,
      naiveFilename: filename,
      suggestedFilename: filename,
      initialFilename: filename,
      context: "browser",
      now: new Date(),
    },
  };
};

export const routeBrowserDownload = async (
  Download: BrowserDownloadRouter,
  item: BrowserDownloadItem,
): Promise<string | null> => {
  const state = createBrowserDownloadState(item);
  const route = Download.getRoutingMatches(state);
  if (!route) return null;
  state.routeIsFolder = /\/\s*$/.test(route);
  state.route = await applyVariables(new Path(route), state.info);
  return Download.finalizeFullPath(state);
};

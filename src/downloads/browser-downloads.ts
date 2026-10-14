import { Path, ROUTES_TO_FOLDER_REGEX } from "../routing/path.ts";
import { applyVariables, normalizeMimeType } from "../routing/variable.ts";
import { BROWSER_DOWNLOAD_CONTEXT } from "../shared/constants.ts";
import { matchesAnyPattern, matchesAnyPatternOrUnreadable } from "../shared/match-pattern.ts";
import { options } from "../config/options-data.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";
import type { DownloadPipelineState } from "./download-types.ts";
import { releaseUnusedContent } from "./download-pipeline-state.ts";

export type BrowserDownloadItem = {
  url: string;
  filename: string;
  finalUrl?: string | undefined;
  mime?: string | undefined;
  referrer?: string | undefined;
  byExtensionId?: string | undefined;
  incognito?: boolean | undefined;
};

// The page an ordinary browser download came from, inferred from its referrer.
export type BrowserDownloadPage = { url: string; title: string };

export type BrowserDownloadPageTab = {
  url?: string | undefined;
  title?: string | undefined;
  incognito?: boolean | undefined;
};

type BrowserDownloadRouter = {
  getRoutingMatches(state: DownloadPipelineState): string | null | undefined;
  resolveRenameTransform(state: DownloadPipelineState): Promise<void>;
  finalizeFullPath(state: DownloadPipelineState): string;
};

export const BrowserDownloadRouting: {
  route: (item: BrowserDownloadItem) => Promise<string | null>;
} = { route: async () => null };

// data: links stay out (#152), measured on Firefox 140 and 158. The download
// is local, so it is already complete when this handler reaches cancel() ("is
// already complete"), even for an 18-byte payload. Rerouting it would mean
// deleting a file the browser has already finished, and possibly opened.
// downloads.download also refuses a data: URL ("Access denied"); only an
// object URL would work.
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

// Absence of an extension id is the only tell a browser-started download has,
// and on Chrome it is not a reliable one: onCreated omits the key for our own
// downloads too (measured on 150), so this answers true for them as well. What
// separates them there is siPendingDownloads, which the caller checks first —
// not this. See the note on the private residual in notification-events.ts.
export const isOrdinaryBrowserDownload = (
  item: Pick<BrowserDownloadItem, "byExtensionId">,
  runtimeId?: string,
): boolean => {
  void runtimeId;
  return !item.byExtensionId;
};

// The two filters fail closed in opposite directions because they are read from
// opposite sides: an unreadable include matches nothing and so tracks nothing,
// and an unreadable exclude must likewise withhold tracking rather than report
// the download as un-excluded. Both leave an ordinary browser download alone
// until the pattern is fixed, which the field's inline diagnostic asks for.
export const matchesBrowserDownloadFilter = (
  url: string,
  filter?: string,
  excludeFilter?: string,
  enabled = true,
): boolean =>
  !enabled ||
  ((!filter || filter.trim() === "" || matchesAnyPattern(url, filter)) &&
    (!excludeFilter ||
      excludeFilter.trim() === "" ||
      !matchesAnyPatternOrUnreadable(url, excludeFilter)));

// Neither browser says which tab started a download; the referrer is the only
// evidence, so every doubt yields no page rather than a guessed one. A
// referrer that is only an origin may be one a referrer policy cut down from
// a deeper page (the cross-origin default), so it cannot name the tab showing
// the site's root. A fragment never reaches a referrer, so it is ignored on
// the tab side. Two tabs on the same address are indistinguishable, and a
// private tab is never page context, so either withholds the page.
export const inferBrowserDownloadPage = (
  referrer: string | undefined,
  tabs: readonly BrowserDownloadPageTab[],
): BrowserDownloadPage | null => {
  if (!referrer) return null;
  let parsed: URL;
  try {
    parsed = new URL(referrer);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (referrer === `${parsed.origin}/`) return null;
  const [tab, ...others] = tabs.flatMap((candidate) =>
    typeof candidate.url === "string" && candidate.url.split("#", 1)[0] === referrer
      ? [{ url: candidate.url, title: candidate.title ?? "", incognito: candidate.incognito }]
      : [],
  );
  if (!tab || others.length > 0 || tab.incognito !== false) return null;
  return { url: tab.url, title: tab.title };
};

// Chrome's onDeterminingFilename holds the download until suggest(), so a tab
// query that never settles must cost a bounded delay, not the download.
export const BROWSER_DOWNLOAD_PAGE_TIMEOUT_MS = 1000;

export const findBrowserDownloadPage = async (
  item: Pick<BrowserDownloadItem, "referrer" | "incognito">,
  queryTabs: () => Promise<readonly BrowserDownloadPageTab[]>,
): Promise<BrowserDownloadPage | null> => {
  if (item.incognito === true || !item.referrer) return null;
  const { referrer } = item;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const tabs = await Promise.race([
      queryTabs(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), BROWSER_DOWNLOAD_PAGE_TIMEOUT_MS);
      }),
    ]);
    return tabs ? inferBrowserDownloadPage(referrer, tabs) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

export const createBrowserDownloadState = (
  item: BrowserDownloadItem,
  page: BrowserDownloadPage | null = null,
): DownloadPipelineState => {
  const filename = proposedFilename(item.filename || item.url);
  const sourceUrl = item.finalUrl || item.url;
  const mime = normalizeMimeType(item.mime);
  return {
    path: new Path("."),
    scratch: {},
    info: {
      // A synthetic tab carries only what the page matchers read: with no id,
      // no tab action can reach the inferred tab.
      currentTab: page ? { title: page.title, url: page.url, incognito: false } : null,
      ...(page ? { pageUrl: page.url } : {}),
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
  // Opt-in: no page matcher could match a browser download before this, so a
  // default-on inference would silently move files for any profile with a
  // page rule above its browser-download rule.
  const page = options.browserDownloadPageDetails
    ? await findBrowserDownloadPage(item, () => webExtensionApi.tabs.query({}))
    : null;
  const state = createBrowserDownloadState(item, page);
  try {
    const route = Download.getRoutingMatches(state);
    if (!route) return null;
    state.routeIsFolder = ROUTES_TO_FOLDER_REGEX.test(route);
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

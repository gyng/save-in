import type { HistoryEntryInput } from "../shared/history-types.ts";
import type { DownloadPipelineState } from "./download-types.ts";
import { DOWNLOAD_TYPES } from "../shared/constants.ts";
import { downloadPorts } from "./ports.ts";
import { isPrivateDownloadState, isSourceSidecar } from "./download-pipeline-state.ts";
import { historyDisplayUrl, isDataUrl } from "../shared/data-url.ts";

const historyPort = downloadPorts.history;

// A data: download's URL is its multi-kilobyte payload. The automatic scan is
// the new page-controlled, potentially high-volume path; it caps those sources
// and stores only a display form in history — never the full payload. History has no
// fetch-by-URL action (undo/show-in-folder gate on downloadId, not URL), so a
// truncated, non-fetchable data: string is safe to round-trip. Manual
// context-menu saves are left byte-for-byte as before: pre-4.2 they stored the
// full data: URL, and silently truncating them would reinterpret an existing
// history/export contract. http(s) URLs are always stored unchanged.
const historyEntry = (state: DownloadPipelineState, finalFullPath: string): HistoryEntryInput => {
  const automaticDataSource =
    state.info.context === DOWNLOAD_TYPES.AUTO &&
    [state.info.url, state.info.sourceUrl, state.info.selectedUrl].some(
      (value) => typeof value === "string" && isDataUrl(value),
    );
  const displayUrl = (value: string | null | undefined): string | undefined =>
    typeof value === "string"
      ? automaticDataSource
        ? historyDisplayUrl(value)
        : value
      : undefined;
  return {
    timestamp: new Date().toISOString(),
    initiatedAt: state.info.now?.toISOString(),
    ...(isPrivateDownloadState(state) ? { private: true } : {}),
    url: displayUrl(state.info.url),
    finalFullPath,
    routed: Boolean(state.route),
    info: {
      sourceUrl: displayUrl(state.info.sourceUrl || state.info.selectedUrl),
      pageUrl: state.info.pageUrl,
      context: state.info.context,
    },
    menu: {
      id: state.info.menuItemId,
      title: state.info.menuItemTitle,
      path: state.info.menuItemPath,
    },
    variables: Object.fromEntries(
      Object.entries({
        filename: displayUrl(state.info.filename),
        initialfilename: displayUrl(state.info.initialFilename),
        suggestedfilename: displayUrl(state.info.suggestedFilename),
        pagetitle: state.info.currentTab?.title,
        pageurl: state.info.pageUrl,
        sourceurl: displayUrl(state.info.sourceUrl),
        frameurl: state.info.frameUrl,
        referrerurl: state.info.referrerUrl,
        linktext: state.info.linkText,
        linktitle: state.info.linkTitle,
        linkdownload: state.info.linkDownload,
        selection: state.info.selectionText,
        mediatype: state.info.mediaType,
        sourcekind: state.info.sourceKind,
        mime: state.info.mime || state.info.resolvedHead?.contentType,
        context: state.info.context,
        gesture: state.info.gesture,
        comment: state.info.comment,
        menuindex: state.info.menuIndex,
        counter: state.info.counter,
        sha256: state.info.sha256,
      })
        .filter(
          (entry): entry is [string, string | number] =>
            typeof entry[1] === "string" || typeof entry[1] === "number",
        )
        .map(([key, value]) => [key, String(value)]),
    ),
  };
};

// Shared by download-plan.ts (plan resolution) and download-execution.ts (the
// cancellable-preparation row a content fetch triggers): both need to create
// the entry once and patch the same id afterward.
export const ensureHistoryEntry = (state: DownloadPipelineState, finalFullPath: string) => {
  if (isSourceSidecar(state)) return null;
  const fields = historyEntry(state, finalFullPath);
  if (typeof state.scratch.historyEntryId !== "undefined") {
    void historyPort.patch(state.scratch.historyEntryId, fields);
    return state.scratch.historyEntryId;
  }
  const id = historyPort.add(fields, { privateContext: isPrivateDownloadState(state) });
  state.scratch.historyEntryId = id;
  return id;
};

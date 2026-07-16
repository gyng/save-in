import type { HistoryEntryInput } from "../shared/history-types.ts";
import type { DownloadPipelineState } from "./download-types.ts";
import { downloadPorts } from "./ports.ts";
import { isPrivateDownloadState, isSourceSidecar } from "./download-pipeline-state.ts";

const historyPort = downloadPorts.history;

const historyEntry = (state: DownloadPipelineState, finalFullPath: string): HistoryEntryInput => ({
  timestamp: new Date().toISOString(),
  initiatedAt: state.info.now?.toISOString(),
  url: state.info.url,
  finalFullPath,
  routed: Boolean(state.route),
  info: {
    sourceUrl: state.info.sourceUrl || state.info.selectedUrl,
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
      filename: state.info.filename,
      initialfilename: state.info.initialFilename,
      suggestedfilename: state.info.suggestedFilename,
      pagetitle: state.info.currentTab?.title,
      pageurl: state.info.pageUrl,
      sourceurl: state.info.sourceUrl,
      linktext: state.info.linkText,
      selection: state.info.selectionText,
      context: state.info.context,
      comment: state.info.comment,
      menuindex: state.info.menuIndex,
      counter: state.info.counter,
    })
      .filter(
        (entry): entry is [string, string | number] =>
          typeof entry[1] === "string" || typeof entry[1] === "number",
      )
      .map(([key, value]) => [key, String(value)]),
  ),
});

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

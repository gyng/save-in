// Compatibility facade for older internal/test imports. New consumers use the
// execution-context-neutral contract in shared/history-types.ts.
export type {
  DownloadProgress,
  HistoryColumn,
  HistoryEntry,
  HistoryEntryInput,
  HistoryInfo,
  HistoryPageOptions,
  HistoryRow,
  HistorySort,
} from "../shared/history-types.ts";

export type HistoryInfo = {
  sourceUrl?: string;
  pageUrl?: string;
  context?: string;
};

export type HistoryEntryInput = {
  timestamp?: string;
  url?: string;
  finalFullPath?: string;
  routed?: boolean;
  info?: HistoryInfo;
  state?: { info?: HistoryInfo };
  [key: string]: unknown;
};

export type HistoryEntry = HistoryEntryInput & {
  id?: string;
  status?: string;
  downloadId?: number;
  fileSize?: number;
};

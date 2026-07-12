export type HistoryInfo = {
  sourceUrl?: string;
  pageUrl?: string;
  context?: string;
};

export type HistoryEntryInput = {
  timestamp?: string;
  initiatedAt?: string;
  url?: string;
  finalFullPath?: string;
  routed?: boolean;
  info?: HistoryInfo;
  state?: { info?: HistoryInfo };
  observedBrowserDownload?: boolean;
  menu?: { id?: string; title?: string; path?: string };
  variables?: Record<string, string>;
  [key: string]: unknown;
};

export type HistoryEntry = HistoryEntryInput & {
  id?: string;
  status?: string;
  downloadId?: number;
  fileSize?: number;
};

export type HistoryRow = {
  time: string;
  status: string;
  routed: string;
  type: string;
  file: string;
  folder: string;
  fullPath: string;
  source: string;
  url: string;
  downloadId: number | null;
  size: number | null;
  menuItem: string;
  variables: string;
};

export type HistorySort = {
  key: keyof HistoryRow;
  dir: "asc" | "desc";
};

export type HistoryColumn = {
  key: keyof HistoryRow;
  label: string;
  sortable: boolean;
  width: string;
};

export type HistoryPageOptions = {
  filter?: string;
  sourceFilter?: string;
  statusFilter?: string;
  typeFilter?: string;
  sort?: HistorySort;
  page?: number;
  pageSize?: number;
};

export type DownloadProgress = {
  id?: number;
  state?: string;
  bytesReceived?: number;
  totalBytes?: number;
};

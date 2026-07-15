export type HistoryInfo = {
  sourceUrl?: string | undefined;
  pageUrl?: string | undefined;
  context?: string | undefined;
};

export type HistoryEntryInput = {
  timestamp?: string | undefined;
  initiatedAt?: string | undefined;
  url?: string | undefined;
  finalFullPath?: string | undefined;
  routed?: boolean | undefined;
  info?: HistoryInfo | undefined;
  state?: { info?: HistoryInfo | undefined } | undefined;
  observedBrowserDownload?: boolean | undefined;
  mechanism?:
    | "downloads-api"
    | "fetch-downloads-api"
    | "browser-download"
    | "firefox-replacement"
    | undefined;
  menu?: {
    id?: string | undefined;
    title?: string | undefined;
    path?: string | undefined;
  };
  variables?: Record<string, string> | undefined;
  relatedHistoryId?: string | undefined;
};

export type HistoryEntry = HistoryEntryInput & {
  id?: string | undefined;
  status?: string | undefined;
  downloadId?: number | undefined;
  fileSize?: number | undefined;
};

export type HistoryRow = {
  historyId: string | null;
  time: string;
  status: string;
  routed: string;
  type: string;
  file: string;
  folder: string;
  fullPath: string;
  source: string;
  mechanism: string;
  url: string;
  downloadId: number | null;
  size: number | null;
  menuItem: string;
  variables: string;
  variableEntries: Array<[string, string]>;
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
  dateFrom?: string;
  dateTo?: string;
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

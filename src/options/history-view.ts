// Pure, DOM-free history-table logic extracted from options.js so it can be
// unit-tested (options.js runs top-level against the real options.html DOM and
// is covered only by the e2e). options.js keeps the mutable view state and the
// DOM rendering; everything here is data-in/data-out.

import type {
  DownloadProgress,
  HistoryEntry,
  HistoryInfo,
  HistoryPageOptions,
  HistoryRow,
} from "../shared/history-types.ts";

export const historyFilename = (fullPath?: string): string => {
  if (!fullPath) {
    return "(unnamed)";
  }
  const parts = String(fullPath).split("/");
  return parts[parts.length - 1] || fullPath;
};

export const historyFolder = (fullPath?: string): string => {
  if (!fullPath) {
    return "";
  }
  const idx = String(fullPath).lastIndexOf("/");
  return idx === -1 ? "." : fullPath.slice(0, idx);
};

export const formatHistoryTime = (iso?: string): string => {
  if (!iso) {
    return "";
  }
  try {
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) {
      return iso;
    }
    const pad = (value: number, length = 2): string => String(value).padStart(length, "0");
    const offsetMinutes = -date.getTimezoneOffset();
    const offsetSign = offsetMinutes >= 0 ? "+" : "-";
    const offset = Math.abs(offsetMinutes);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}${offsetSign}${pad(Math.floor(offset / 60))}:${pad(offset % 60)}`;
  } catch (e) {
    return iso || "";
  }
};

export const relativeHistoryTime = (iso?: string, now = Date.now()): string => {
  if (!iso) return "";
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const seconds = Math.round((timestamp - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
};

const localDateValue = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;

export const localHistoryDate = (iso?: string): string => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return iso!;
  const date = new Date(iso || "");
  return Number.isNaN(date.getTime()) ? "" : localDateValue(date);
};

export const historyDateRange = (preset: string, now = Date.now()) => {
  if (!new Set(["today", "7-days", "30-days"]).has(preset)) return { from: "", to: "" };
  const end = new Date(now);
  const start = new Date(end);
  if (preset === "7-days") start.setDate(start.getDate() - 6);
  if (preset === "30-days") start.setDate(start.getDate() - 29);
  return { from: localDateValue(start), to: localDateValue(end) };
};

// info.context holds a DOWNLOAD_TYPES value; older entries kept the whole
// state, so fall back to state.info
export const historyInfo = (entry: HistoryEntry): HistoryInfo =>
  entry.info || (entry.state && entry.state.info) || {};

export const historyType = (entry: HistoryEntry): string => {
  const context = historyInfo(entry).context;
  if (!context) {
    return "";
  }
  const c = String(context).toLowerCase();
  return c === "media" ? "image" : c;
};

// Older entries predate status tracking; treat them as complete
export const historyStatus = (entry: HistoryEntry): string => entry.status || "complete";

const HISTORY_MECHANISMS: Record<string, string> = {
  "downloads-api": "Downloads API",
  "fetch-downloads-api": "Fetch + downloads API",
  "browser-download": "Browser download",
  "firefox-replacement": "Firefox replacement",
};

export const statusLabel = (status: string): string => {
  if (status === "complete") {
    return "Saved";
  }
  if (status === "pending") {
    return "Saving…";
  }
  if (status === "failed") {
    return "Failed";
  }
  // a browser error name (SERVER_FORBIDDEN, NETWORK_FAILED) shown lowercased
  return status.toLowerCase().replace(/_/g, " ");
};

export const statusClass = (status: string): string => {
  if (status === "complete") {
    return "status-ok";
  }
  if (status === "pending") {
    return "status-pending";
  }
  return "status-fail";
};

// Flatten an entry into the fields the table shows and sorts/filters on
export const historyRow = (entry: HistoryEntry): HistoryRow => {
  const info = historyInfo(entry);
  const variableEntries = Object.entries(entry.variables || {}).filter(([, value]) => value !== "");
  return {
    time: entry.initiatedAt || entry.timestamp || "",
    status: historyStatus(entry),
    routed: entry.routed ? "routed" : "",
    type: historyType(entry),
    file: historyFilename(entry.finalFullPath),
    folder: historyFolder(entry.finalFullPath),
    fullPath: entry.finalFullPath || "",
    source: entry.observedBrowserDownload || info.context === "browser" ? "Browser" : "Save In",
    mechanism:
      HISTORY_MECHANISMS[entry.mechanism || ""] ||
      (entry.observedBrowserDownload || info.context === "browser"
        ? "Browser download"
        : "Downloads API"),
    url: info.sourceUrl || entry.url || info.pageUrl || "",
    downloadId: typeof entry.downloadId === "number" ? entry.downloadId : null,
    size: typeof entry.fileSize === "number" ? entry.fileSize : null,
    menuItem: entry.menu?.title || entry.menu?.path || entry.menu?.id || "",
    variables: variableEntries.map(([key, value]) => `${key}=${value}`).join(" · "),
    variableEntries,
  };
};

// In-progress download cell from a downloads.search item: a percentage when
// the total size is known, otherwise the running byte count. `title` shows
// received / total when known.
export const progressCell = (item: DownloadProgress | null | undefined) => {
  const received = (item && item.bytesReceived) || 0;
  const total = (item && item.totalBytes) || 0;
  return {
    label: total > 0 ? `${Math.floor((received / total) * 100)}%` : formatBytes(received),
    title: total > 0 ? `${formatBytes(received)} / ${formatBytes(total)}` : "",
  };
};

// Human-readable byte count (SI units, matching the download notification)
export const formatBytes = (n: number | null | undefined): string => {
  if (n == null || n < 0) {
    return "";
  }
  if (n < 1000) {
    return `${n} B`;
  }
  if (n < 1000 * 1000) {
    return `${(n / 1000).toFixed(1)} KB`;
  }
  if (n < 1000 * 1000 * 1000) {
    return `${(n / 1000 / 1000).toFixed(1)} MB`;
  }
  return `${(n / 1000 / 1000 / 1000).toFixed(2)} GB`;
};

// width is a percentage weight (table-layout: fixed)
type HistoryDisplayColumn = {
  key: keyof HistoryRow | "index";
  label: string;
  sortable: boolean;
  width: string;
  defaultVisible: boolean;
};

export const HISTORY_COLUMNS: HistoryDisplayColumn[] = [
  { key: "index", label: "#", sortable: false, width: "4%", defaultVisible: true },
  { key: "time", label: "Initiated", sortable: true, width: "12%", defaultVisible: true },
  { key: "source", label: "Source", sortable: true, width: "8%", defaultVisible: false },
  {
    key: "mechanism",
    label: "Method",
    sortable: true,
    width: "12%",
    defaultVisible: true,
  },
  { key: "status", label: "Status", sortable: true, width: "9%", defaultVisible: true },
  { key: "size", label: "Size", sortable: true, width: "8%", defaultVisible: true },
  { key: "type", label: "Type", sortable: true, width: "6%", defaultVisible: true },
  { key: "routed", label: "Rule", sortable: true, width: "7%", defaultVisible: true },
  { key: "file", label: "File", sortable: true, width: "16%", defaultVisible: true },
  { key: "folder", label: "Folder", sortable: true, width: "15%", defaultVisible: true },
  { key: "url", label: "URL", sortable: false, width: "19%", defaultVisible: true },
  { key: "fullPath", label: "Full path", sortable: true, width: "20%", defaultVisible: false },
  { key: "downloadId", label: "Download ID", sortable: true, width: "6rem", defaultVisible: false },
  { key: "menuItem", label: "Menu item", sortable: true, width: "12%", defaultVisible: false },
  { key: "variables", label: "Variables", sortable: false, width: "24%", defaultVisible: false },
];

const SPREADSHEET_FORMULA_PREFIX = /^[=+\-@\t\r\n\uFF1D\uFF0B\uFF0D\uFF20]/;

const spreadsheetSafeText = (value: unknown): string => {
  const text = String(value ?? "");
  // CSV quoting protects delimiters, but spreadsheet programs still execute
  // quoted formula-leading cells. The apostrophe forces a text cell on import.
  return SPREADSHEET_FORMULA_PREFIX.test(text) ? `'${text}` : text;
};

const csvCell = (value: unknown): string => `"${spreadsheetSafeText(value).replaceAll('"', '""')}"`;

export const historyCsv = (entries: HistoryEntry[]): string => {
  const columns = HISTORY_COLUMNS.filter(({ key }) => key !== "index");
  const rows = entries.map(historyRow);
  return [
    columns.map(({ label }) => csvCell(label)).join(","),
    ...rows.map((row) => columns.map(({ key }) => csvCell(row[key as keyof HistoryRow])).join(",")),
  ].join("\n");
};

export const historyTsv = (entries: HistoryEntry[]): string => {
  const columns = HISTORY_COLUMNS.filter(({ key }) => key !== "index");
  const rows = entries.map(historyRow);
  const cell = (value: unknown) =>
    spreadsheetSafeText(String(value ?? "").replaceAll(/[\t\r\n]/g, " "));
  return [
    columns.map(({ label }) => cell(label)).join("\t"),
    ...rows.map((row) => columns.map(({ key }) => cell(row[key as keyof HistoryRow])).join("\t")),
  ].join("\n");
};

// Filter + sort + paginate the newest-first entries. Returns the requested
// page (page is clamped into range) plus the counts the UI shows.
export const paginateHistory = (
  entries: HistoryEntry[],
  {
    filter = "",
    sort = { key: "time", dir: "desc" },
    page = 0,
    pageSize = 50,
    sourceFilter = "",
    statusFilter = "",
    typeFilter = "",
    dateFrom = "",
    dateTo = "",
  }: HistoryPageOptions = {},
) => {
  const query = String(filter || "")
    .trim()
    .toLowerCase();
  let rows = entries.map(historyRow);
  const total = rows.length;

  if (query) {
    rows = rows.filter((r) =>
      [r.status, r.type, r.file, r.folder, r.source, r.url, r.menuItem, r.variables].some((v) =>
        String(v).toLowerCase().includes(query),
      ),
    );
  }

  if (sourceFilter) {
    rows = rows.filter((r) => r.source.toLowerCase().replaceAll(" ", "-") === sourceFilter);
  }
  if (statusFilter) {
    rows = rows.filter((r) =>
      statusFilter === "failed"
        ? r.status !== "complete" && r.status !== "pending"
        : r.status === statusFilter,
    );
  }
  if (typeFilter) rows = rows.filter((r) => r.type === typeFilter);
  if (dateFrom) rows = rows.filter((r) => localHistoryDate(r.time) >= dateFrom);
  if (dateTo) rows = rows.filter((r) => localHistoryDate(r.time) <= dateTo);

  rows.sort((a, b) => {
    // String() so numeric columns (size) don't blow up localeCompare
    const av = String(a[sort.key]);
    const bv = String(b[sort.key]);
    const cmp =
      sort.key === "time"
        ? av.localeCompare(bv)
        : av.localeCompare(bv, undefined, { numeric: true });
    return sort.dir === "asc" ? cmp : -cmp;
  });

  const matchCount = rows.length;
  const pageCount = Math.max(1, Math.ceil(matchCount / pageSize));
  const clampedPage = Math.min(Math.max(0, page), pageCount - 1);
  const pageRows = rows.slice(clampedPage * pageSize, (clampedPage + 1) * pageSize);

  return { pageRows, matchCount, total, pageCount, page: clampedPage };
};

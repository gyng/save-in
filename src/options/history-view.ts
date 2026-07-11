// Pure, DOM-free history-table logic extracted from options.js so it can be
// unit-tested (options.js runs top-level against the real options.html DOM and
// is covered only by the e2e). options.js keeps the mutable view state and the
// DOM rendering; everything here is data-in/data-out.

import type {
  DownloadProgress,
  HistoryColumn,
  HistoryEntry,
  HistoryInfo,
  HistoryPageOptions,
  HistoryRow,
} from "../history-types.ts";

export const HistoryView = {
  filename: (fullPath?: string): string => {
    if (!fullPath) {
      return "(unnamed)";
    }
    const parts = String(fullPath).split("/");
    return parts[parts.length - 1] || fullPath;
  },

  folder: (fullPath?: string): string => {
    if (!fullPath) {
      return "";
    }
    const idx = String(fullPath).lastIndexOf("/");
    return idx === -1 ? "." : fullPath.slice(0, idx);
  },

  time: (iso?: string): string => {
    try {
      return new Date(iso).toLocaleString();
    } catch (e) {
      return iso || "";
    }
  },

  // info.context holds a DOWNLOAD_TYPES value; older entries kept the whole
  // state, so fall back to state.info
  info: (entry: HistoryEntry): HistoryInfo => entry.info || (entry.state && entry.state.info) || {},

  type: (entry: HistoryEntry): string => {
    const context = HistoryView.info(entry).context;
    if (!context) {
      return "";
    }
    const c = String(context).toLowerCase();
    return c === "media" ? "image" : c;
  },

  // Older entries predate status tracking; treat them as complete
  status: (entry: HistoryEntry): string => entry.status || "complete",

  statusLabel: (status: string): string => {
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
  },

  statusClass: (status: string): string => {
    if (status === "complete") {
      return "status-ok";
    }
    if (status === "pending") {
      return "status-pending";
    }
    return "status-fail";
  },

  // Flatten an entry into the fields the table shows and sorts/filters on
  row: (entry: HistoryEntry): HistoryRow => {
    const info = HistoryView.info(entry);
    return {
      time: entry.timestamp || "",
      status: HistoryView.status(entry),
      routed: entry.routed ? "routed" : "",
      type: HistoryView.type(entry),
      file: HistoryView.filename(entry.finalFullPath),
      folder: HistoryView.folder(entry.finalFullPath),
      fullPath: entry.finalFullPath || "",
      source: info.sourceUrl || entry.url || info.pageUrl || "",
      downloadId: typeof entry.downloadId === "number" ? entry.downloadId : null,
      size: typeof entry.fileSize === "number" ? entry.fileSize : null,
    };
  },

  // In-progress download cell from a downloads.search item: a percentage when
  // the total size is known, otherwise the running byte count. `title` shows
  // received / total when known.
  progressCell: (item: DownloadProgress) => {
    const received = (item && item.bytesReceived) || 0;
    const total = (item && item.totalBytes) || 0;
    return {
      label:
        total > 0 ? `${Math.floor((received / total) * 100)}%` : HistoryView.formatBytes(received),
      title:
        total > 0 ? `${HistoryView.formatBytes(received)} / ${HistoryView.formatBytes(total)}` : "",
    };
  },

  // Human-readable byte count (SI units, matching the download notification)
  formatBytes: (n: number | null | undefined): string => {
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
  },

  // width is a percentage weight (table-layout: fixed)
  COLUMNS: [
    { key: "time", label: "Saved", sortable: true, width: "14%" },
    { key: "status", label: "Status", sortable: true, width: "10%" },
    { key: "size", label: "Size", sortable: true, width: "9%" },
    { key: "type", label: "Type", sortable: true, width: "6%" },
    { key: "routed", label: "Rule", sortable: true, width: "7%" },
    { key: "file", label: "File", sortable: true, width: "18%" },
    { key: "folder", label: "Folder", sortable: true, width: "16%" },
    { key: "source", label: "Source", sortable: false, width: "20%" },
  ] as HistoryColumn[],

  // Filter + sort + paginate the newest-first entries. Returns the requested
  // page (page is clamped into range) plus the counts the UI shows.
  paginate: (
    entries: HistoryEntry[],
    {
      filter = "",
      sort = { key: "time", dir: "desc" },
      page = 0,
      pageSize = 50,
    }: HistoryPageOptions = {},
  ) => {
    const query = String(filter || "")
      .trim()
      .toLowerCase();
    let rows = entries.map(HistoryView.row);
    const total = rows.length;

    if (query) {
      rows = rows.filter((r) =>
        [r.status, r.type, r.file, r.folder, r.source].some((v) =>
          String(v).toLowerCase().includes(query),
        ),
      );
    }

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
  },
};

import { webExtensionApi } from "../platform/web-extension-api.ts";
import type {
  DownloadProgress,
  HistoryEntry,
  HistoryRow,
  HistorySort,
} from "../shared/history-types.ts";

// History panel controller for the options page. Owns the history table's
// view state (sort/filter/page) and its DOM rendering + live download-progress
// polling; the pure, data-in/data-out logic (row flattening, sort/filter/
// paginate, byte + progress formatting) lives in history-view.ts.
// A classic script sharing the options page's global scope, like the other
// options/*.js files. Loaded after history-view.js.

import {
  formatBytes,
  formatHistoryTime,
  HISTORY_COLUMNS,
  historyCsv,
  paginateHistory,
  progressCell,
  statusClass,
  statusLabel,
} from "./history-view.ts";
import { renderHistoryFeedback } from "./history-feedback.ts";

const HISTORY_KEY = "save-in-history";

// Newest-first cache of the stored entries, and the current sort/filter/
// page state; the table re-renders from these without touching storage
let historyEntries: HistoryEntry[] = [];
let historySort: HistorySort = { key: "time", dir: "desc" };
let historyFilter = "";
let historySourceFilter = "";
let historyStatusFilter = "";
let historyTypeFilter = "";
let historyPage = 0;
const HISTORY_COLUMNS_KEY = "si-history-columns";
const defaultHistoryColumns = HISTORY_COLUMNS.filter(({ defaultVisible }) => defaultVisible).map(
  ({ key }) => key,
);
let visibleHistoryColumns = new Set<string>(defaultHistoryColumns);
try {
  const storedColumns = JSON.parse(localStorage.getItem(HISTORY_COLUMNS_KEY) || "null");
  const valid = new Set(HISTORY_COLUMNS.map(({ key }) => key));
  if (Array.isArray(storedColumns)) {
    const selected = storedColumns.filter((key): key is string => valid.has(key));
    if (selected.length) visibleHistoryColumns = new Set(selected);
  }
} catch {}
const HISTORY_PAGE_SIZE = 50;

const folderIcon = () => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M3 6h7l2 2h9v10H3z");
  svg.appendChild(path);
  return svg;
};

// Opens the containing folder for a completed download (best-effort; the
// browser may have forgotten the download)
const historyFeedback = () => document.querySelector<HTMLElement>("#history-feedback");

const showInFolder = async (downloadId: number | null) => {
  if (downloadId == null || !webExtensionApi.downloads || !webExtensionApi.downloads.show) {
    renderHistoryFeedback(historyFeedback(), {
      message: "Could not open the folder. This browser no longer knows the download.",
      error: true,
    });
    return;
  }
  try {
    await webExtensionApi.downloads.show(downloadId);
    renderHistoryFeedback(historyFeedback());
  } catch {
    renderHistoryFeedback(historyFeedback(), {
      message: "Could not open the folder. The file may have moved or been removed.",
      error: true,
    });
  }
};

// Live progress for still-downloading history rows. Each pending row with a
// download id renders a `.history-progress[data-download-id]` cell; while any
// exist, poll the browser and fill in the percentage / bytes. When one finishes
// we re-render so it picks up the stored final status and size.
let historyProgressTimer: ReturnType<typeof setInterval> | null = null;

const stopHistoryProgress = () => {
  if (historyProgressTimer) {
    clearInterval(historyProgressTimer);
    historyProgressTimer = null;
  }
};

const pollHistoryProgress = () => {
  const cells = document.querySelectorAll(".history-progress[data-download-id]");
  if (cells.length === 0 || !webExtensionApi.downloads || !webExtensionApi.downloads.search) {
    stopHistoryProgress();
    return;
  }
  webExtensionApi.downloads
    .search({})
    .then((items) => {
      const byId: Record<number, DownloadProgress> = {};
      items.forEach((it: DownloadProgress) => {
        if (it.id != null) {
          byId[it.id] = it;
        }
      });
      let anyInProgress = false;
      let anyFinished = false;
      cells.forEach((cell) => {
        const item = byId[Number(cell.getAttribute("data-download-id"))];
        if (item && item.state === "in_progress") {
          anyInProgress = true;
          const { label, title } = progressCell(item);
          cell.textContent = label;
          cell.setAttribute("title", title);
        } else if (item) {
          // completed/interrupted -> re-render to pick up the stored status+size
          anyFinished = true;
        } else {
          // the browser no longer knows this download: stop polling this cell
          cell.textContent = "—";
          cell.removeAttribute("data-download-id");
        }
      });
      if (anyFinished) {
        renderHistoryTable();
      } else if (!anyInProgress) {
        stopHistoryProgress();
      }
    })
    .catch(() => {});
};

const startHistoryProgress = () => {
  stopHistoryProgress();
  if (document.querySelector(".history-progress[data-download-id]")) {
    historyProgressTimer = setInterval(pollHistoryProgress, 1000);
    pollHistoryProgress();
  }
};

const renderHistoryTable = () => {
  const container = document.querySelector("#history-list");
  const countEl = document.querySelector("#history-count");
  if (!container) {
    return;
  }

  const query = historyFilter.trim().toLowerCase();
  const { pageRows, matchCount, total, pageCount, page } = paginateHistory(historyEntries, {
    filter: historyFilter,
    sort: historySort,
    page: historyPage,
    pageSize: HISTORY_PAGE_SIZE,
    sourceFilter: historySourceFilter,
    statusFilter: historyStatusFilter,
    typeFilter: historyTypeFilter,
  });
  historyPage = page; // paginate clamped it into range

  if (countEl) {
    countEl.textContent = query ? `${matchCount} of ${total}` : total ? `${total} saved` : "";
  }

  container.textContent = "";

  if (total === 0) {
    const empty = document.createElement("p");
    empty.className = "caption";
    empty.textContent = "No downloads saved yet.";
    container.appendChild(empty);
    return;
  }

  const table = document.createElement("table");
  table.className = "history-table";

  const head = document.createElement("tr");
  HISTORY_COLUMNS.filter(({ key }) => visibleHistoryColumns.has(key)).forEach((col) => {
    const th = document.createElement("th");
    th.textContent = col.label;
    if (col.width) {
      th.style.width = col.width;
    }
    if (col.sortable) {
      th.classList.add("sortable");
      if (historySort.key === col.key) {
        th.classList.add("sorted");
        th.textContent = `${col.label} ${historySort.dir === "asc" ? "▲" : "▼"}`;
      }
      th.addEventListener("click", () => {
        if (historySort.key === col.key) {
          historySort.dir = historySort.dir === "asc" ? "desc" : "asc";
        } else {
          historySort = {
            key: col.key as keyof HistoryRow,
            dir: col.key === "time" ? "desc" : "asc",
          };
        }
        historyPage = 0;
        renderHistoryTable();
      });
    }
    head.appendChild(th);
  });
  table.appendChild(head);

  pageRows.forEach((r, rowIndex) => {
    const tr = document.createElement("tr");
    const appendCell = (key: string, cell: HTMLTableCellElement) => {
      cell.dataset.column = key;
      tr.appendChild(cell);
    };

    const index = document.createElement("td");
    index.className = "history-index";
    index.textContent = String(historyPage * HISTORY_PAGE_SIZE + rowIndex + 1);
    if (visibleHistoryColumns.has("index")) appendCell("index", index);

    const time = document.createElement("td");
    time.className = "history-time";
    time.textContent = formatHistoryTime(r.time);
    if (visibleHistoryColumns.has("time")) appendCell("time", time);

    const source = document.createElement("td");
    source.className = "history-origin";
    source.textContent = r.source;
    if (visibleHistoryColumns.has("source")) appendCell("source", source);

    const status = document.createElement("td");
    status.className = "history-status";
    const badge = document.createElement("span");
    badge.className = `status-badge ${statusClass(r.status)}`;
    badge.textContent = statusLabel(r.status);
    badge.title = r.status;
    status.appendChild(badge);
    // Open the file's folder for completed downloads the browser still knows
    if (r.status === "complete" && r.downloadId != null) {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "history-open";
      open.title = "Show in folder";
      open.setAttribute("aria-label", "Show in folder");
      open.appendChild(folderIcon());
      open.addEventListener("click", () => void showInFolder(r.downloadId));
      status.appendChild(open);
    }
    if (visibleHistoryColumns.has("status")) appendCell("status", status);

    const size = document.createElement("td");
    size.className = "history-size";
    if (r.status === "pending" && r.downloadId != null) {
      // filled and updated live by the progress poller below
      size.classList.add("history-progress");
      size.setAttribute("data-download-id", String(r.downloadId));
      size.textContent = "…";
    } else if (r.size != null) {
      size.textContent = formatBytes(r.size);
    }
    if (visibleHistoryColumns.has("size")) appendCell("size", size);

    const type = document.createElement("td");
    type.className = "history-type";
    type.textContent = r.type;
    if (visibleHistoryColumns.has("type")) appendCell("type", type);

    const routed = document.createElement("td");
    routed.className = "history-routed";
    if (r.routed) {
      const chip = document.createElement("span");
      chip.className = "routed-chip";
      chip.textContent = "renamed";
      chip.title = "A routing/rename rule was applied";
      routed.appendChild(chip);
    }
    if (visibleHistoryColumns.has("routed")) appendCell("routed", routed);

    const file = document.createElement("td");
    file.className = "history-file";
    file.textContent = r.file;
    file.title = r.fullPath;
    if (visibleHistoryColumns.has("file")) appendCell("file", file);

    const folder = document.createElement("td");
    folder.className = "history-folder";
    folder.textContent = r.folder;
    folder.title = r.folder;
    if (visibleHistoryColumns.has("folder")) appendCell("folder", folder);

    const url = document.createElement("td");
    url.className = "history-url";
    if (r.url) {
      const link = document.createElement("a");
      link.href = r.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = r.url;
      link.title = r.url;
      url.appendChild(link);
    }
    if (visibleHistoryColumns.has("url")) appendCell("url", url);

    if (visibleHistoryColumns.has("fullPath")) {
      const fullPath = document.createElement("td");
      fullPath.className = "history-full-path";
      fullPath.textContent = r.fullPath;
      appendCell("fullPath", fullPath);
    }
    if (visibleHistoryColumns.has("downloadId")) {
      const downloadId = document.createElement("td");
      downloadId.className = "history-download-id";
      downloadId.textContent = r.downloadId == null ? "" : String(r.downloadId);
      appendCell("downloadId", downloadId);
    }
    if (visibleHistoryColumns.has("menuItem")) {
      const menuItem = document.createElement("td");
      menuItem.className = "history-menu-item";
      menuItem.textContent = r.menuItem;
      appendCell("menuItem", menuItem);
    }
    if (visibleHistoryColumns.has("variables")) {
      const variables = document.createElement("td");
      variables.className = "history-variables";
      variables.textContent = r.variables;
      variables.title = r.variables;
      appendCell("variables", variables);
    }

    table.appendChild(tr);
  });

  container.appendChild(table);

  // Pagination (only when there is more than one page)
  if (pageCount > 1) {
    const pager = document.createElement("div");
    pager.className = "history-pager";

    const prev = document.createElement("button");
    prev.type = "button";
    prev.textContent = "‹ Newer";
    prev.disabled = historyPage === 0;
    prev.addEventListener("click", () => {
      historyPage -= 1;
      renderHistoryTable();
    });

    const label = document.createElement("span");
    label.className = "caption history-pager-label";
    label.textContent = `Page ${historyPage + 1} of ${pageCount}`;

    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "Older ›";
    next.disabled = historyPage >= pageCount - 1;
    next.addEventListener("click", () => {
      historyPage += 1;
      renderHistoryTable();
    });

    pager.appendChild(prev);
    pager.appendChild(label);
    pager.appendChild(next);
    container.appendChild(pager);
  }

  // Start/refresh live progress polling for any in-flight downloads on the page
  startHistoryProgress();
};

export const renderHistory = async () => {
  try {
    const stored = (await webExtensionApi.storage.local.get(HISTORY_KEY)) ?? {};
    historyEntries = ((stored[HISTORY_KEY] || []) as HistoryEntry[]).toReversed(); // newest first
    renderHistoryFeedback(historyFeedback());
    renderHistoryTable();
  } catch {
    renderHistoryFeedback(historyFeedback(), {
      message: "Could not load history.",
      error: true,
      actionLabel: "Retry",
      onAction: () => void renderHistory(),
    });
  }
};
document.addEventListener("DOMContentLoaded", renderHistory);

const historyFilterInput = document.querySelector("#history-filter") as HTMLInputElement;
historyFilterInput?.addEventListener("input", () => {
  historyFilter = historyFilterInput.value;
  historyPage = 0;
  renderHistoryTable();
});

const bindHistoryFacet = (id: string, update: (value: string) => void) => {
  document.querySelector<HTMLSelectElement>(id)?.addEventListener("change", (event) => {
    update((event.currentTarget as HTMLSelectElement).value);
    historyPage = 0;
    renderHistoryTable();
  });
};

bindHistoryFacet("#history-source-filter", (value) => (historySourceFilter = value));
bindHistoryFacet("#history-status-filter", (value) => (historyStatusFilter = value));
bindHistoryFacet("#history-type-filter", (value) => (historyTypeFilter = value));

const columnOptions = document.querySelector("#history-column-options");
HISTORY_COLUMNS.forEach(({ key, label }) => {
  if (!columnOptions) return;
  const option = document.createElement("label");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = visibleHistoryColumns.has(key);
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) visibleHistoryColumns.add(key);
    else if (visibleHistoryColumns.size > 1) visibleHistoryColumns.delete(key);
    else checkbox.checked = true;
    localStorage.setItem(HISTORY_COLUMNS_KEY, JSON.stringify([...visibleHistoryColumns]));
    renderHistoryTable();
  });
  option.append(checkbox, label);
  columnOptions.appendChild(option);
});

const downloadHistoryExport = (format: "json" | "csv") => {
  const content =
    format === "json" ? JSON.stringify(historyEntries, null, 2) : historyCsv(historyEntries);
  const url = URL.createObjectURL(
    new Blob([content], { type: format === "json" ? "application/json" : "text/csv" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `save-in-history.${format}`;
  link.click();
  URL.revokeObjectURL(url);
};
document
  .querySelector("#history-export-json")
  ?.addEventListener("click", () => downloadHistoryExport("json"));
document
  .querySelector("#history-export-csv")
  ?.addEventListener("click", () => downloadHistoryExport("csv"));

const removeHistory = async () => {
  const clearButton = document.querySelector<HTMLButtonElement>("#history-clear");
  if (clearButton) clearButton.disabled = true;
  renderHistoryFeedback(historyFeedback(), { message: "Clearing history…" });
  try {
    await webExtensionApi.storage.local.remove(HISTORY_KEY);
    await renderHistory();
  } catch {
    renderHistoryFeedback(historyFeedback(), {
      message: "Could not clear history.",
      error: true,
      actionLabel: "Retry",
      onAction: () => void removeHistory(),
    });
  } finally {
    if (clearButton) clearButton.disabled = false;
  }
};
const clearHistory = () => {
  // eslint-disable-next-line no-alert
  if (window.confirm("Clear all saved history? This cannot be undone.")) void removeHistory();
};
document.querySelector("#history-clear")?.addEventListener("click", clearHistory);

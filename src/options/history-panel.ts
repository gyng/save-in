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
  historyDateRange,
  historyCsv,
  historyTsv,
  localizeHistoryColumns,
  paginateHistory,
  progressCell,
  relativeHistoryTime,
  statusClass,
  statusLabel,
} from "./history-view.ts";
import { renderHistoryFeedback } from "./history-feedback.ts";
import { MESSAGE_TYPES } from "../shared/constants.ts";
import { sendInternalMessage } from "../shared/message-protocol.ts";

export type HistoryPanelState = {
  entries: HistoryEntry[];
  sort: HistorySort;
  filter: string;
  sourceFilter: string;
  statusFilter: string;
  typeFilter: string;
  datePreset: string;
  dateFrom: string;
  dateTo: string;
  page: number;
};

export const createHistoryPanelState = (): HistoryPanelState => ({
  entries: [],
  sort: { key: "time", dir: "desc" },
  filter: "",
  sourceFilter: "",
  statusFilter: "",
  typeFilter: "",
  datePreset: "any",
  dateFrom: "",
  dateTo: "",
  page: 0,
});

// Newest-first cache and view state have one explicit owner. Rendering and
// event callbacks mutate this record instead of coordinating loose globals.
const historyState = createHistoryPanelState();
const HISTORY_COLUMNS_KEY = "si-history-columns";
const defaultHistoryColumns = HISTORY_COLUMNS.filter(({ defaultVisible }) => defaultVisible).map(
  ({ key }) => key,
);
let localize: (key: string) => string = () => "";
export const setHistoryLocalizer = (getLocalizedMessage: (key: string) => string): void => {
  localize = getLocalizedMessage;
};
const historyColumns = () => localizeHistoryColumns(localize);
const historyColumnOptionLabels = new Map<string, Text>();
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

const historyDateIsValid = () =>
  !historyState.dateFrom || !historyState.dateTo || historyState.dateFrom <= historyState.dateTo;

const selectedLabel = (id: string) =>
  document.querySelector<HTMLSelectElement>(id)?.selectedOptions[0]?.textContent?.trim() || "";

const updateHistoryFilterUi = () => {
  const active: string[] = [];
  if (historyState.filter.trim()) active.push(`Search: “${historyState.filter.trim()}”`);
  if (historyState.sourceFilter) active.push(selectedLabel("#history-source-filter"));
  if (historyState.statusFilter) active.push(selectedLabel("#history-status-filter"));
  if (historyState.typeFilter) active.push(selectedLabel("#history-type-filter"));
  if (historyState.datePreset !== "any") {
    active.push(
      historyState.datePreset === "custom"
        ? historyState.dateFrom && historyState.dateTo
          ? `${historyState.dateFrom} – ${historyState.dateTo}`
          : historyState.dateFrom
            ? `Since ${historyState.dateFrom}`
            : historyState.dateTo
              ? `Through ${historyState.dateTo}`
              : "Custom date range"
        : selectedLabel("#history-date-preset"),
    );
  }

  const clear = document.querySelector<HTMLButtonElement>("#history-clear-filters");
  if (clear) {
    const inactive = active.length === 0;
    clear.classList.toggle("history-clear-filters-inactive", inactive);
    clear.disabled = inactive;
    clear.setAttribute("aria-hidden", String(inactive));
  }
  const summary = document.querySelector<HTMLElement>("#history-active-filters");
  if (summary) summary.textContent = active.length ? `Filtered by ${active.join(" · ")}` : "";

  const custom = document.querySelector<HTMLElement>("#history-custom-date-range");
  if (custom) custom.hidden = historyState.datePreset === "any";
  const from = document.querySelector<HTMLInputElement>("#history-date-from");
  const to = document.querySelector<HTMLInputElement>("#history-date-to");
  if (from) from.max = to?.value || "";
  if (to) to.min = from?.value || "";
  const valid = historyDateIsValid();
  const message = valid ? "" : "Start date must be before end date.";
  from?.setCustomValidity(message);
  to?.setCustomValidity(message);
  const error = document.querySelector<HTMLElement>("#history-date-error");
  if (error) {
    error.hidden = valid;
    error.textContent = message;
  }
};

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

  const query = historyState.filter.trim().toLowerCase();
  const validDateRange = historyDateIsValid();
  const { pageRows, matchCount, total, pageCount, page } = paginateHistory(historyState.entries, {
    filter: historyState.filter,
    sort: historyState.sort,
    page: historyState.page,
    pageSize: HISTORY_PAGE_SIZE,
    sourceFilter: historyState.sourceFilter,
    statusFilter: historyState.statusFilter,
    typeFilter: historyState.typeFilter,
    dateFrom: validDateRange ? historyState.dateFrom : "",
    dateTo: validDateRange ? historyState.dateTo : "",
  });
  historyState.page = page; // paginate clamped it into range
  updateHistoryFilterUi();

  if (countEl) {
    const filtered = Boolean(
      query ||
      historyState.sourceFilter ||
      historyState.statusFilter ||
      historyState.typeFilter ||
      historyState.datePreset !== "any",
    );
    countEl.textContent = filtered
      ? `${matchCount} of ${total} results`
      : `${total} ${total === 1 ? "result" : "results"}`;
    countEl.setAttribute("title", "History is stored locally, up to 10,000 entries");
  }

  container.textContent = "";

  const table = document.createElement("table");
  table.className = "history-table";

  const head = document.createElement("tr");
  const localizedColumns = historyColumns();
  localizedColumns
    .filter(({ key }) => visibleHistoryColumns.has(key))
    .forEach((col) => {
      const th = document.createElement("th");
      th.classList.add(`history-${col.key}-heading`);
      th.textContent = col.label;
      if (col.width) {
        th.style.width = col.width;
      }
      if (col.sortable) {
        th.classList.add("sortable");
        if (historyState.sort.key === col.key) {
          th.classList.add("sorted");
          th.textContent = `${col.label} ${historyState.sort.dir === "asc" ? "▲" : "▼"}`;
        }
        th.addEventListener("click", () => {
          if (historyState.sort.key === col.key) {
            historyState.sort.dir = historyState.sort.dir === "asc" ? "desc" : "asc";
          } else {
            historyState.sort = {
              key: col.key as keyof HistoryRow,
              dir: col.key === "time" ? "desc" : "asc",
            };
          }
          historyState.page = 0;
          renderHistoryTable();
        });
      }
      head.appendChild(th);
    });
  table.appendChild(head);

  if (pageRows.length === 0) {
    const emptyRow = document.createElement("tr");
    emptyRow.className = "history-empty-row";
    const empty = document.createElement("td");
    empty.colSpan = visibleHistoryColumns.size;
    empty.textContent =
      total === 0
        ? localize("historyEmptyNoDownloads") || "No downloads saved yet."
        : localize("historyEmptyNoMatches") || "No history matches these filters.";
    emptyRow.appendChild(empty);
    table.appendChild(emptyRow);
  }

  pageRows.forEach((r, rowIndex) => {
    const tr = document.createElement("tr");
    const appendCell = (key: string, cell: HTMLTableCellElement) => {
      cell.dataset.column = key;
      tr.appendChild(cell);
    };

    const index = document.createElement("td");
    index.className = "history-index";
    index.textContent = String(historyState.page * HISTORY_PAGE_SIZE + rowIndex + 1);
    if (visibleHistoryColumns.has("index")) appendCell("index", index);

    const time = document.createElement("td");
    time.className = "history-time";
    time.textContent = formatHistoryTime(r.time);
    time.title = relativeHistoryTime(r.time);
    if (visibleHistoryColumns.has("time")) appendCell("time", time);

    const source = document.createElement("td");
    source.className = "history-origin";
    source.textContent = r.source;
    if (visibleHistoryColumns.has("source")) appendCell("source", source);

    const mechanism = document.createElement("td");
    mechanism.className = "history-mechanism";
    mechanism.textContent = r.mechanism;
    if (visibleHistoryColumns.has("mechanism")) appendCell("mechanism", mechanism);

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
    if (r.status === "pending" && r.historyId) {
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "history-cancel";
      cancel.textContent = "Cancel";
      cancel.title = "Cancel this download";
      cancel.setAttribute("aria-label", `Cancel ${r.file}`);
      cancel.addEventListener("click", async () => {
        cancel.disabled = true;
        cancel.textContent = "Canceling…";
        try {
          await sendInternalMessage(webExtensionApi.runtime, {
            type: MESSAGE_TYPES.HISTORY_CANCEL,
            body: {
              historyId: r.historyId!,
            },
          });
          await renderHistory();
        } catch {
          cancel.disabled = false;
          cancel.textContent = "Cancel";
        }
      });
      status.appendChild(cancel);
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
      variables.title = r.variables;
      if (r.variableEntries.length > 0) {
        const list = document.createElement("dl");
        list.className = "history-variable-list";
        r.variableEntries.forEach(([key, value]) => {
          const row = document.createElement("div");
          const term = document.createElement("dt");
          term.textContent = `:${key}:`;
          const description = document.createElement("dd");
          description.textContent = value;
          row.append(term, description);
          list.append(row);
        });
        variables.append(list);
      }
      appendCell("variables", variables);
    }

    table.appendChild(tr);
  });

  container.appendChild(table);

  localizedColumns.forEach(({ key, label }) => {
    const node = historyColumnOptionLabels.get(key);
    if (node) node.data = label;
  });

  // Keep location and disabled boundary controls visible even on one page.
  if (total > 0) {
    const pager = document.createElement("div");
    pager.className = "history-pager";

    const prev = document.createElement("button");
    prev.type = "button";
    prev.textContent = "‹ Newer";
    prev.disabled = historyState.page === 0;
    prev.addEventListener("click", () => {
      historyState.page -= 1;
      renderHistoryTable();
    });

    const label = document.createElement("span");
    label.className = "caption history-pager-label";
    label.textContent = `Page ${historyState.page + 1} of ${pageCount}`;

    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "Older ›";
    next.disabled = historyState.page >= pageCount - 1;
    next.addEventListener("click", () => {
      historyState.page += 1;
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
    const response = await sendInternalMessage(webExtensionApi.runtime, {
      type: MESSAGE_TYPES.HISTORY_GET,
    });
    const entries = "entries" in response.body ? response.body.entries : undefined;
    if (!Array.isArray(entries)) throw new Error("Invalid history response");
    historyState.entries = (entries as HistoryEntry[]).toReversed(); // newest first
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
const historyFilterInput = document.querySelector("#history-filter") as HTMLInputElement;
historyFilterInput?.addEventListener("input", () => {
  historyState.filter = historyFilterInput.value;
  historyState.page = 0;
  renderHistoryTable();
});

const bindHistoryFacet = (id: string, update: (value: string) => void) => {
  document
    .querySelector<HTMLInputElement | HTMLSelectElement>(id)
    ?.addEventListener("change", (event) => {
      update((event.currentTarget as HTMLInputElement | HTMLSelectElement).value);
      historyState.page = 0;
      renderHistoryTable();
    });
};

bindHistoryFacet("#history-source-filter", (value) => (historyState.sourceFilter = value));
bindHistoryFacet("#history-status-filter", (value) => (historyState.statusFilter = value));
bindHistoryFacet("#history-type-filter", (value) => (historyState.typeFilter = value));
bindHistoryFacet("#history-date-preset", (value) => {
  historyState.datePreset = value;
  const range = historyDateRange(value);
  historyState.dateFrom = range.from;
  historyState.dateTo = range.to;
  const from = document.querySelector<HTMLInputElement>("#history-date-from");
  const to = document.querySelector<HTMLInputElement>("#history-date-to");
  if (from) from.value = historyState.dateFrom;
  if (to) to.value = historyState.dateTo;
});
const selectCustomHistoryRange = () => {
  historyState.datePreset = "custom";
  const preset = document.querySelector<HTMLSelectElement>("#history-date-preset");
  if (preset) preset.value = "custom";
};
bindHistoryFacet("#history-date-from", (value) => {
  historyState.dateFrom = value;
  selectCustomHistoryRange();
});
bindHistoryFacet("#history-date-to", (value) => {
  historyState.dateTo = value;
  selectCustomHistoryRange();
});

document.querySelector("#history-clear-filters")?.addEventListener("click", () => {
  historyState.filter = "";
  historyState.sourceFilter = "";
  historyState.statusFilter = "";
  historyState.typeFilter = "";
  historyState.datePreset = "any";
  historyState.dateFrom = "";
  historyState.dateTo = "";
  historyState.page = 0;
  const values: Record<string, string> = {
    "history-filter": "",
    "history-source-filter": "",
    "history-status-filter": "",
    "history-type-filter": "",
    "history-date-preset": "any",
    "history-date-from": "",
    "history-date-to": "",
  };
  Object.entries(values).forEach(([id, value]) => {
    const control = document.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`);
    if (control) control.value = value;
  });
  renderHistoryTable();
});

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
  const labelNode = document.createTextNode(label);
  historyColumnOptionLabels.set(key, labelNode);
  option.append(checkbox, labelNode);
  columnOptions.appendChild(option);
});

const downloadHistoryExport = (format: "json" | "csv" | "tsv") => {
  const content =
    format === "json"
      ? JSON.stringify(historyState.entries, null, 2)
      : format === "tsv"
        ? historyTsv(historyState.entries, historyColumns())
        : historyCsv(historyState.entries, historyColumns());
  const url = URL.createObjectURL(
    new Blob([content], {
      type:
        format === "json"
          ? "application/json"
          : format === "tsv"
            ? "text/tab-separated-values"
            : "text/csv",
    }),
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
document
  .querySelector("#history-export-tsv")
  ?.addEventListener("click", () => downloadHistoryExport("tsv"));

const removeHistory = async () => {
  const clearButton = document.querySelector<HTMLButtonElement>("#history-clear");
  if (clearButton) clearButton.disabled = true;
  renderHistoryFeedback(historyFeedback(), { message: "Clearing history…" });
  try {
    const response = await sendInternalMessage(webExtensionApi.runtime, {
      type: MESSAGE_TYPES.HISTORY_CLEAR,
    });
    if (response?.type !== MESSAGE_TYPES.OK) throw new Error("History clear failed");
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
  if (window.confirm("Delete all saved history? This cannot be undone.")) void removeHistory();
};
document.querySelector("#history-clear")?.addEventListener("click", clearHistory);

import { webExtensionApi } from "../../platform/web-extension-api.ts";
import { getMessage } from "../../platform/localization.ts";
import type { DownloadProgress, HistoryEntry, HistorySort } from "../../shared/history-types.ts";

// History panel controller for the options page. Owns the history table's
// view state (sort/filter/page) and its DOM rendering + live download-progress
// polling; the pure, data-in/data-out logic (row flattening, sort/filter/
// paginate, byte + progress formatting) lives in history-view.ts.
// A classic script sharing the options page's global scope, like the other
// options/*.js files. Loaded after history-view.js.

import {
  formatBytes,
  formatHistoryDisplayTime,
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
import { MESSAGE_TYPES } from "../../shared/constants.ts";
import { sendInternalMessage } from "../../shared/message-protocol.ts";
import { normalizeHistory } from "../../shared/history-normalization.ts";
import { closeDetailsAndRestoreFocus } from "../ui/dismissible-details.ts";

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
type HistorySubstitutions = string | number | Array<string | number>;
type HistoryLocalize = (key: string, substitutions?: HistorySubstitutions) => string;
let localize: HistoryLocalize = getMessage;
export const setHistoryLocalizer = (getLocalizedMessage: HistoryLocalize): void => {
  localize = getLocalizedMessage;
};
const historyMessage = (
  key: string,
  fallback: string,
  substitutions?: HistorySubstitutions,
): string => localize(key, substitutions) || fallback;
const historyColumns = () => localizeHistoryColumns(localize);
const historyColumnOptionLabels = new Map<string, Text>();
const loadVisibleHistoryColumns = (): Set<string> => {
  try {
    const storedColumns = JSON.parse(localStorage.getItem(HISTORY_COLUMNS_KEY) || "null");
    const valid = new Set(HISTORY_COLUMNS.map(({ key }) => key));
    if (Array.isArray(storedColumns)) {
      const selected = storedColumns.filter((key): key is string => valid.has(key));
      if (selected.length) return new Set(selected);
    }
  } catch {}
  return new Set(defaultHistoryColumns);
};
let visibleHistoryColumns = loadVisibleHistoryColumns();
const HISTORY_PAGE_SIZE = 50;

const historyDateIsValid = () =>
  !historyState.dateFrom || !historyState.dateTo || historyState.dateFrom <= historyState.dateTo;

const selectedLabel = (id: string) =>
  document.querySelector<HTMLSelectElement>(id)?.selectedOptions[0]?.textContent?.trim() || "";

const historyTypeLabel = (type: string): string => {
  const labels: Record<string, [string, string]> = {
    image: ["html_image", "Image"],
    link: ["html_link", "Link"],
    page: ["contextMenuContextPage", "Page"],
    selection: ["html_selection", "Selection"],
    click: ["html_click", "Click"],
    tab: ["html_tab", "Tab"],
    sidecar: ["html_link", "Link"],
  };
  const label = labels[type];
  return label ? historyMessage(label[0], label[1]) : type;
};

const updateHistoryFilterUi = () => {
  const active: string[] = [];
  if (historyState.filter.trim()) {
    active.push(
      historyMessage("historyFilterSearch", `Search: “${historyState.filter.trim()}”`, [
        historyState.filter.trim(),
      ]),
    );
  }
  if (historyState.sourceFilter) active.push(selectedLabel("#history-source-filter"));
  if (historyState.statusFilter) active.push(selectedLabel("#history-status-filter"));
  if (historyState.typeFilter) active.push(selectedLabel("#history-type-filter"));
  if (historyState.datePreset !== "any") {
    active.push(
      historyState.datePreset === "custom"
        ? historyState.dateFrom && historyState.dateTo
          ? `${historyState.dateFrom} – ${historyState.dateTo}`
          : historyState.dateFrom
            ? historyMessage("historyFilterSince", `Since ${historyState.dateFrom}`, [
                historyState.dateFrom,
              ])
            : historyState.dateTo
              ? historyMessage("historyFilterThrough", `Through ${historyState.dateTo}`, [
                  historyState.dateTo,
                ])
              : historyMessage("o_lHistoryCustomRange", "Custom date range")
        : selectedLabel("#history-date-preset"),
    );
  }

  const clear = document.querySelector<HTMLButtonElement>("#history-clear-filters");
  if (clear) {
    const inactive = active.length === 0;
    clear.classList.toggle("history-clear-filters-inactive", inactive);
    clear.disabled = inactive;
    clear.hidden = inactive;
    clear.setAttribute("aria-hidden", String(inactive));
  }
  const summary = document.querySelector<HTMLElement>("#history-active-filters");
  if (summary) {
    summary.replaceChildren(
      ...active.map((text) => {
        const chip = document.createElement("span");
        chip.className = "history-active-filter";
        chip.textContent = text;
        return chip;
      }),
    );
    summary.hidden = active.length === 0;
  }

  const custom = document.querySelector<HTMLElement>("#history-custom-date-range");
  if (custom) custom.hidden = historyState.datePreset === "any";
  const from = document.querySelector<HTMLInputElement>("#history-date-from");
  const to = document.querySelector<HTMLInputElement>("#history-date-to");
  if (from) from.max = to?.value || "";
  if (to) to.min = from?.value || "";
  const valid = historyDateIsValid();
  const message = valid
    ? ""
    : historyMessage("historyDateRangeInvalid", "Start date must be on or before the end date.");
  from?.setCustomValidity(message);
  to?.setCustomValidity(message);
  for (const input of [from, to]) {
    if (!input) continue;
    if (valid) input.removeAttribute("aria-invalid");
    else input.setAttribute("aria-invalid", "true");
  }
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

const historyActionIcon = (kind: "copy" | "link") => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const paths =
    kind === "copy"
      ? ["M8 8h11v11H8z", "M5 16H3V3h13v2"]
      : [
          "M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1",
          "M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1",
        ];
  paths.forEach((data) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", data);
    svg.append(path);
  });
  return svg;
};

// Opens the containing folder for a completed download (best-effort; the
// browser may have forgotten the download)
const historyFeedback = () => document.querySelector<HTMLElement>("#history-feedback");

const showInFolder = async (downloadId: number | null) => {
  if (downloadId == null || !webExtensionApi.downloads || !webExtensionApi.downloads.show) {
    renderHistoryFeedback(historyFeedback(), {
      message: historyMessage(
        "historyShowFolderUnavailable",
        "Could not open the folder. This browser no longer knows the download.",
      ),
      error: true,
    });
    return;
  }
  try {
    await webExtensionApi.downloads.show(downloadId);
    renderHistoryFeedback(historyFeedback());
  } catch {
    renderHistoryFeedback(historyFeedback(), {
      message: historyMessage(
        "historyShowFolderFailed",
        "Could not open the folder. The file may have moved or been removed.",
      ),
      error: true,
    });
  }
};

const copyHistoryValue = async (value: string, successMessage: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(value);
    renderHistoryFeedback(historyFeedback(), { message: successMessage });
  } catch {
    renderHistoryFeedback(historyFeedback(), {
      message: historyMessage("historyCopyFailed", "Could not copy to the clipboard."),
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
  if (cells.length === 0) {
    if (document.querySelector(".history-cancel")) void renderHistory();
    else stopHistoryProgress();
    return;
  }
  if (!webExtensionApi.downloads || !webExtensionApi.downloads.search) {
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
        void renderHistory();
      } else if (!anyInProgress) {
        stopHistoryProgress();
      }
    })
    .catch(() => {});
};

const startHistoryProgress = () => {
  stopHistoryProgress();
  const hasNativeProgress = document.querySelector(".history-progress[data-download-id]");
  if (hasNativeProgress || document.querySelector(".history-cancel")) {
    historyProgressTimer = setInterval(pollHistoryProgress, 1000);
    if (hasNativeProgress) pollHistoryProgress();
  }
};

const updateHistoryActionAvailability = (hasEntries: boolean): void => {
  document.querySelectorAll<HTMLElement>("[data-history-requires-entries]").forEach((control) => {
    if (control instanceof HTMLButtonElement) control.disabled = !hasEntries;
    else control.inert = !hasEntries;
    if (hasEntries) control.removeAttribute("aria-disabled");
    else control.setAttribute("aria-disabled", "true");
  });
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
  updateHistoryActionAvailability(total > 0);

  if (countEl) {
    const filtered = Boolean(
      query ||
      historyState.sourceFilter ||
      historyState.statusFilter ||
      historyState.typeFilter ||
      historyState.datePreset !== "any",
    );
    countEl.textContent = filtered
      ? historyMessage("historyFilteredResultsCount", `${matchCount} of ${total} results`, [
          matchCount,
          total,
        ])
      : total === 1
        ? historyMessage("historyResultCountOne", "1 result", total)
        : historyMessage("historyResultCount", `${total} results`, total);
    countEl.setAttribute(
      "title",
      historyMessage("historyStorageLimit", "History stays on this device, up to 10,000 entries."),
    );
  }

  container.textContent = "";

  const table = document.createElement("table");
  table.className = "history-table";
  const caption = document.createElement("caption");
  caption.className = "visually-hidden";
  caption.textContent = historyMessage("historyTableCaption", "Saved download history");
  table.append(caption);

  const thead = document.createElement("thead");
  const head = document.createElement("tr");
  const localizedColumns = historyColumns();
  const columnLabels = new Map<string, string>(
    localizedColumns.map(({ key, label }) => [key, label]),
  );
  localizedColumns
    .filter(({ key }) => visibleHistoryColumns.has(key))
    .forEach((col) => {
      const th = document.createElement("th");
      th.scope = "col";
      th.dataset.column = col.key;
      th.classList.add(`history-${col.key}-heading`);
      th.style.width = col.width;
      if (col.sortable && col.key !== "index") {
        const sortKey = col.key;
        th.classList.add("sortable");
        const sort = document.createElement("button");
        sort.type = "button";
        sort.className = "history-sort-button";
        const label = document.createElement("span");
        label.textContent = col.label;
        const indicator = document.createElement("span");
        indicator.className = "history-sort-indicator";
        indicator.setAttribute("aria-hidden", "true");
        if (historyState.sort.key === sortKey) {
          th.classList.add("sorted");
          th.setAttribute(
            "aria-sort",
            historyState.sort.dir === "asc" ? "ascending" : "descending",
          );
          indicator.textContent = historyState.sort.dir === "asc" ? "▲" : "▼";
        }
        sort.append(label, indicator);
        sort.addEventListener("click", () => {
          if (historyState.sort.key === sortKey) {
            historyState.sort.dir = historyState.sort.dir === "asc" ? "desc" : "asc";
          } else {
            historyState.sort = {
              key: sortKey,
              dir: sortKey === "time" ? "desc" : "asc",
            };
          }
          historyState.page = 0;
          renderHistoryTable();
        });
        th.append(sort);
      } else {
        th.textContent = col.label;
      }
      head.appendChild(th);
    });
  thead.append(head);
  table.append(thead);
  const tbody = document.createElement("tbody");

  if (pageRows.length === 0) {
    const emptyRow = document.createElement("tr");
    emptyRow.className = "history-empty-row";
    const empty = document.createElement("td");
    const message = document.createElement("strong");
    message.className = "history-empty-title";
    empty.colSpan = visibleHistoryColumns.size;
    message.textContent =
      total === 0
        ? localize("historyEmptyNoDownloads") || "No downloads saved yet."
        : localize("historyEmptyNoMatches") || "No history matches these filters.";
    empty.appendChild(message);
    emptyRow.appendChild(empty);
    tbody.appendChild(emptyRow);
  }

  pageRows.forEach((r, rowIndex) => {
    const tr = document.createElement("tr");
    const cells = new Map<string, HTMLTableCellElement>();
    const appendCell = (key: string, cell: HTMLTableCellElement) => {
      cell.dataset.column = key;
      /* v8 ignore next -- appendCell receives only the fixed history column keys. */
      cell.dataset.label = columnLabels.get(key) ?? key;
      cells.set(key, cell);
    };

    const index = document.createElement("td");
    index.className = "history-index";
    index.textContent = String(historyState.page * HISTORY_PAGE_SIZE + rowIndex + 1);
    if (visibleHistoryColumns.has("index")) appendCell("index", index);

    const time = document.createElement("td");
    time.className = "history-time";
    time.textContent = formatHistoryDisplayTime(r.time);
    time.title = [relativeHistoryTime(r.time), formatHistoryTime(r.time)]
      .filter(Boolean)
      .join(" · ");
    if (visibleHistoryColumns.has("time")) appendCell("time", time);

    const source = document.createElement("td");
    source.className = "history-origin";
    source.textContent =
      r.source === "Browser" ? historyMessage("o_lHistoryBrowser", "Browser") : r.source;
    if (visibleHistoryColumns.has("source")) appendCell("source", source);

    const mechanism = document.createElement("td");
    mechanism.className = "history-mechanism";
    mechanism.textContent = r.mechanism;
    if (visibleHistoryColumns.has("mechanism")) appendCell("mechanism", mechanism);

    const status = document.createElement("td");
    status.className = "history-status";
    const badge = document.createElement("span");
    badge.className = `status-pill status-badge ${statusClass(r.status)}`;
    badge.textContent = statusLabel(r.status, localize);
    badge.title = r.status;
    status.appendChild(badge);
    // Open the file's folder for completed downloads the browser still knows
    if (r.status === "complete" && r.downloadId != null) {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "history-open";
      const showInFolderLabel = historyMessage("historyShowInFolder", "Show in folder");
      open.title = showInFolderLabel;
      open.setAttribute("aria-label", showInFolderLabel);
      open.appendChild(folderIcon());
      open.addEventListener("click", () => void showInFolder(r.downloadId));
      status.appendChild(open);
    }
    if (r.fullPath) {
      const copyPath = document.createElement("button");
      copyPath.type = "button";
      copyPath.className = "history-open history-copy-path";
      const copyPathLabel = historyMessage("historyCopyPath", "Copy saved path");
      copyPath.title = copyPathLabel;
      copyPath.setAttribute("aria-label", copyPathLabel);
      copyPath.append(historyActionIcon("copy"));
      copyPath.addEventListener(
        "click",
        () =>
          void copyHistoryValue(
            r.fullPath,
            historyMessage("historyPathCopied", "Saved path copied."),
          ),
      );
      status.append(copyPath);
    }
    if (r.url) {
      const copySource = document.createElement("button");
      copySource.type = "button";
      copySource.className = "history-open history-copy-source";
      const copySourceLabel = historyMessage("historyCopySource", "Copy source URL");
      copySource.title = copySourceLabel;
      copySource.setAttribute("aria-label", copySourceLabel);
      copySource.append(historyActionIcon("link"));
      copySource.addEventListener(
        "click",
        () =>
          void copyHistoryValue(r.url, historyMessage("historySourceCopied", "Source URL copied.")),
      );
      status.append(copySource);
    }
    const historyId = r.historyId;
    if (r.status === "pending" && historyId) {
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "history-cancel";
      cancel.textContent = historyMessage("historyCancelDownload", "Cancel");
      cancel.title = historyMessage("historyCancelDownloadTitle", "Cancel this download");
      cancel.setAttribute(
        "aria-label",
        historyMessage("historyCancelDownloadNamed", `Cancel ${r.file}`, r.file),
      );
      cancel.addEventListener("click", async () => {
        cancel.disabled = true;
        cancel.textContent = historyMessage("historyCancelingDownload", "Canceling…");
        try {
          await sendInternalMessage(webExtensionApi.runtime, {
            type: MESSAGE_TYPES.HISTORY_CANCEL,
            body: {
              historyId,
            },
          });
          await renderHistory();
        } catch {
          cancel.disabled = false;
          cancel.textContent = historyMessage("historyCancelDownload", "Cancel");
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
    type.textContent = historyTypeLabel(r.type);
    if (visibleHistoryColumns.has("type")) appendCell("type", type);

    const routed = document.createElement("td");
    routed.className = "history-routed";
    if (r.routed) {
      const chip = document.createElement("span");
      chip.className = "status-pill routed-chip";
      chip.textContent = historyMessage("historyRoutingApplied", "Applied");
      chip.title = historyMessage(
        "historyRoutingAppliedTitle",
        "A routing or renaming rule was applied.",
      );
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

    for (const { key } of localizedColumns) {
      const cell = cells.get(key);
      if (cell) tr.append(cell);
    }
    tbody.appendChild(tr);
  });

  table.append(tbody);
  container.appendChild(table);

  localizedColumns.forEach(({ key, label }) => {
    const node = historyColumnOptionLabels.get(key);
    if (node) node.data = label;
  });

  if (total > 0 && pageCount > 1) {
    const pager = document.createElement("div");
    pager.className = "history-pager";

    const prev = document.createElement("button");
    prev.type = "button";
    prev.textContent = historyMessage("historyNewer", "‹ Newer");
    prev.disabled = historyState.page === 0;
    prev.addEventListener("click", () => {
      historyState.page -= 1;
      renderHistoryTable();
    });

    const label = document.createElement("span");
    label.className = "caption history-pager-label";
    label.textContent = historyMessage(
      "historyPageCount",
      `Page ${historyState.page + 1} of ${pageCount}`,
      [historyState.page + 1, pageCount],
    );

    const next = document.createElement("button");
    next.type = "button";
    next.textContent = historyMessage("historyOlder", "Older ›");
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
    historyState.entries = normalizeHistory(entries).toReversed(); // newest first
    renderHistoryFeedback(historyFeedback());
    renderHistoryTable();
  } catch {
    renderHistoryFeedback(historyFeedback(), {
      message: historyMessage("historyLoadFailed", "Could not load history."),
      error: true,
      actionLabel: historyMessage("historyRetry", "Retry"),
      onAction: () => void renderHistory(),
    });
  }
};
const bindHistoryFacet = (id: string, update: (value: string) => void) => {
  document
    .querySelector<HTMLInputElement | HTMLSelectElement>(id)
    ?.addEventListener("change", (event) => {
      /* v8 ignore next -- This listener is installed only on input and select elements. */
      if (
        !(
          event.currentTarget instanceof HTMLInputElement ||
          event.currentTarget instanceof HTMLSelectElement
        )
      )
        return;
      update(event.currentTarget.value);
      historyState.page = 0;
      renderHistoryTable();
    });
};
const selectCustomHistoryRange = () => {
  historyState.datePreset = "custom";
  const preset = document.querySelector<HTMLSelectElement>("#history-date-preset");
  if (preset) preset.value = "custom";
};

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

export const showClearHistoryDialog = (): Promise<boolean> =>
  new Promise((resolve) => {
    const opener =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null;
    const dialog = document.createElement("dialog");
    dialog.className = "app-dialog history-clear-dialog";
    dialog.setAttribute("aria-labelledby", "history-clear-dialog-title");
    dialog.setAttribute("aria-describedby", "history-clear-dialog-description");

    const title = document.createElement("h2");
    title.id = "history-clear-dialog-title";
    title.textContent = historyMessage("historyDeleteConfirmTitle", "Delete all history?");
    const description = document.createElement("p");
    description.id = "history-clear-dialog-description";
    description.textContent = historyMessage(
      "historyDeleteConfirmDescription",
      "This permanently deletes every saved history entry. This cannot be undone.",
    );
    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = historyMessage("historyKeepHistory", "Keep history");
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "button-danger danger-button";
    confirm.textContent = historyMessage("historyDeleteAll", "Delete all history");
    actions.append(cancel, confirm);
    dialog.append(title, description, actions);
    document.body.append(dialog);

    const finish = (confirmed: boolean): void => {
      dialog.remove();
      if (opener?.isConnected) opener.focus();
      resolve(confirmed);
    };
    cancel.addEventListener("click", () => finish(false));
    confirm.addEventListener("click", () => finish(true));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(false);
    });
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    cancel.focus();
  });

const removeHistory = async () => {
  const clearButton = document.querySelector<HTMLButtonElement>("#history-clear");
  if (clearButton) clearButton.disabled = true;
  renderHistoryFeedback(historyFeedback(), {
    message: historyMessage("historyClearing", "Deleting history…"),
  });
  try {
    const response = await sendInternalMessage(webExtensionApi.runtime, {
      type: MESSAGE_TYPES.HISTORY_CLEAR,
    });
    if (response?.type !== MESSAGE_TYPES.OK) throw new Error("History clear failed");
    await renderHistory();
  } catch {
    renderHistoryFeedback(historyFeedback(), {
      message: historyMessage("historyClearFailed", "Could not delete history."),
      error: true,
      actionLabel: historyMessage("historyRetry", "Retry"),
      onAction: () => void removeHistory(),
    });
  } finally {
    updateHistoryActionAvailability(historyState.entries.length > 0);
  }
};
const clearHistory = async (): Promise<void> => {
  if (await showClearHistoryDialog()) await removeHistory();
};

export const setupHistoryPanel = (): void => {
  stopHistoryProgress();
  Object.assign(historyState, createHistoryPanelState());
  visibleHistoryColumns = loadVisibleHistoryColumns();
  historyColumnOptionLabels.clear();
  updateHistoryActionAvailability(false);

  const historyFilterInput = document.querySelector<HTMLInputElement>("#history-filter");
  historyFilterInput?.addEventListener("input", () => {
    historyState.filter = historyFilterInput.value;
    historyState.page = 0;
    renderHistoryTable();
  });

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
    checkbox.name = "history-column";
    checkbox.value = key;
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

  (["json", "csv", "tsv"] as const).forEach((format) => {
    const button = document.querySelector<HTMLButtonElement>(`#history-export-${format}`);
    button?.addEventListener("click", () => {
      downloadHistoryExport(format);
      const menu = button.closest<HTMLDetailsElement>(".history-export-menu");
      if (menu) closeDetailsAndRestoreFocus(menu);
    });
  });
  document.querySelector("#history-clear")?.addEventListener("click", () => void clearHistory());
};

setupHistoryPanel();

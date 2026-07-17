// The history table: header, rows, empty state, and pager.
//
// renderHistoryTable is the repaint entry point — every control that changes
// sort, filter, page, or column visibility calls it. It reads the already
// fetched entries in historyState; reloading from the background is
// history-refresh.ts's job.

import type { HistoryDisplayColumn } from "./history-view.ts";
import { paginateHistory } from "./history-view.ts";
import { historyColumns, historyMessage } from "./history-messages.ts";
import { HISTORY_PAGE_SIZE, historyDateIsValid, historyState } from "./history-panel-state.ts";
import {
  isHistoryColumnVisible,
  syncHistoryColumnOptionLabels,
  visibleHistoryColumnCount,
} from "./history-columns.ts";
import { updateHistoryFilterUi } from "./history-filters.ts";
import { buildHistoryRow } from "./history-row.ts";
import { startHistoryProgress } from "./history-progress.ts";
import { updateHistoryActionAvailability } from "./history-toolbar.ts";

const sortHeading = (
  column: HistoryDisplayColumn,
  onSort: (() => void) | null,
): HTMLTableCellElement => {
  const th = document.createElement("th");
  th.scope = "col";
  th.dataset.column = column.key;
  th.classList.add(`history-${column.key}-heading`);
  th.style.width = column.width;

  if (!onSort) {
    th.textContent = column.label;
    return th;
  }

  th.classList.add("sortable");
  const sort = document.createElement("button");
  sort.type = "button";
  sort.className = "history-sort-button";
  const label = document.createElement("span");
  label.textContent = column.label;
  const indicator = document.createElement("span");
  indicator.className = "history-sort-indicator";
  indicator.setAttribute("aria-hidden", "true");
  if (historyState.sort.key === column.key) {
    th.classList.add("sorted");
    th.setAttribute("aria-sort", historyState.sort.dir === "asc" ? "ascending" : "descending");
    indicator.textContent = historyState.sort.dir === "asc" ? "▲" : "▼";
  }
  sort.append(label, indicator);
  sort.addEventListener("click", onSort);
  th.append(sort);
  return th;
};

const buildHead = (columns: HistoryDisplayColumn[]): HTMLTableSectionElement => {
  const thead = document.createElement("thead");
  const head = document.createElement("tr");
  for (const column of columns) {
    if (!isHistoryColumnVisible(column.key)) continue;
    const sortKey = column.key;
    // The index column is a row counter, not a value the rows can be ordered
    // by; excluding it here also narrows sortKey to a real HistoryRow key.
    const onSort =
      column.sortable && sortKey !== "index"
        ? () => {
            if (historyState.sort.key === sortKey) {
              historyState.sort.dir = historyState.sort.dir === "asc" ? "desc" : "asc";
            } else {
              historyState.sort = { key: sortKey, dir: sortKey === "time" ? "desc" : "asc" };
            }
            historyState.page = 0;
            renderHistoryTable();
          }
        : null;
    head.append(sortHeading(column, onSort));
  }
  thead.append(head);
  return thead;
};

const emptyRow = (total: number): HTMLTableRowElement => {
  const row = document.createElement("tr");
  row.className = "history-empty-row";
  const empty = document.createElement("td");
  empty.colSpan = visibleHistoryColumnCount();
  const message = document.createElement("strong");
  message.className = "history-empty-title";
  message.textContent =
    total === 0
      ? historyMessage("historyEmptyNoDownloads", "No downloads saved yet.")
      : historyMessage("historyEmptyNoMatches", "No history matches these filters.");
  empty.append(message);
  row.append(empty);
  return row;
};

const buildPager = (pageCount: number): HTMLDivElement => {
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

  pager.append(prev, label, next);
  return pager;
};

const renderCount = (countEl: Element, matchCount: number, total: number): void => {
  const filtered = Boolean(
    historyState.filter.trim() ||
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
};

export const renderHistoryTable = (): void => {
  const container = document.querySelector("#history-list");
  if (!container) return;

  // An invalid custom range must not hide everything: filter as if unbounded
  // and let the filter UI report the error.
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

  const countEl = document.querySelector("#history-count");
  if (countEl) renderCount(countEl, matchCount, total);

  container.textContent = "";

  const columns = historyColumns();
  const table = document.createElement("table");
  table.className = "history-table";
  const caption = document.createElement("caption");
  caption.className = "visually-hidden";
  caption.textContent = historyMessage("historyTableCaption", "Saved download history");
  table.append(caption, buildHead(columns));

  const tbody = document.createElement("tbody");
  if (pageRows.length === 0) tbody.append(emptyRow(total));
  pageRows.forEach((row, rowIndex) => tbody.append(buildHistoryRow(row, rowIndex, columns)));
  table.append(tbody);
  container.append(table);

  syncHistoryColumnOptionLabels();

  if (total > 0 && pageCount > 1) container.append(buildPager(pageCount));

  // Start/refresh live progress polling for any in-flight downloads on the page
  startHistoryProgress();
};

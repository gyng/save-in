// One history table row. Each column has a builder keyed by the column key, so
// a hidden column costs nothing and the row's cell order is exactly the
// declared column order.

import type { HistoryRow } from "../../shared/history-types.ts";
import type { HistoryDisplayColumn } from "./history-view.ts";
import {
  formatBytes,
  formatHistoryDisplayTime,
  formatHistoryTime,
  relativeHistoryTime,
} from "./history-view.ts";
import { historyMessage, historyTypeLabel } from "./history-messages.ts";
import { isHistoryColumnVisible } from "./history-columns.ts";
import { HISTORY_PAGE_SIZE, historyState } from "./history-panel-state.ts";
import { buildHistoryStatusCell } from "./history-row-actions.ts";

type CellBuilder = (row: HistoryRow, rowIndex: number) => HTMLTableCellElement;

const cell = (className: string, text = ""): HTMLTableCellElement => {
  const td = document.createElement("td");
  td.className = className;
  if (text) td.textContent = text;
  return td;
};

const textCell = (className: string, text: string, title?: string): HTMLTableCellElement => {
  const td = cell(className, text);
  if (title !== undefined) td.title = title;
  return td;
};

const sizeCell = (row: HistoryRow): HTMLTableCellElement => {
  const size = cell("history-size");
  if (row.status === "pending" && row.downloadId != null) {
    // filled and updated live by the progress poller
    size.classList.add("history-progress");
    size.setAttribute("data-download-id", String(row.downloadId));
    size.textContent = "…";
  } else if (row.size != null) {
    size.textContent = formatBytes(row.size);
  }
  return size;
};

const routedCell = (row: HistoryRow): HTMLTableCellElement => {
  const routed = cell("history-routed");
  if (row.routed) {
    const chip = document.createElement("span");
    chip.className = "status-pill routed-chip";
    chip.textContent = historyMessage("historyRoutingApplied", "Applied");
    chip.title = historyMessage(
      "historyRoutingAppliedTitle",
      "A routing or renaming rule was applied.",
    );
    routed.append(chip);
  }
  return routed;
};

const urlCell = (row: HistoryRow): HTMLTableCellElement => {
  const url = cell("history-url");
  if (row.url) {
    const link = document.createElement("a");
    link.href = row.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = row.url;
    link.title = row.url;
    url.append(link);
  }
  return url;
};

const variablesCell = (row: HistoryRow): HTMLTableCellElement => {
  const variables = cell("history-variables");
  variables.title = row.variables;
  if (row.variableEntries.length > 0) {
    const list = document.createElement("dl");
    list.className = "history-variable-list";
    for (const [key, value] of row.variableEntries) {
      const item = document.createElement("div");
      const term = document.createElement("dt");
      term.textContent = `:${key}:`;
      const description = document.createElement("dd");
      description.textContent = value;
      item.append(term, description);
      list.append(item);
    }
    variables.append(list);
  }
  return variables;
};

const CELL_BUILDERS: Partial<Record<HistoryDisplayColumn["key"], CellBuilder>> = {
  index: (_row, rowIndex) =>
    cell("history-index", String(historyState.page * HISTORY_PAGE_SIZE + rowIndex + 1)),
  time: (row) =>
    textCell(
      "history-time",
      formatHistoryDisplayTime(row.time),
      [relativeHistoryTime(row.time), formatHistoryTime(row.time)].filter(Boolean).join(" · "),
    ),
  source: (row) =>
    cell(
      "history-origin",
      row.source === "Browser" ? historyMessage("o_lHistoryBrowser", "Browser") : row.source,
    ),
  mechanism: (row) => cell("history-mechanism", row.mechanism),
  status: (row) => buildHistoryStatusCell(row),
  size: (row) => sizeCell(row),
  type: (row) => cell("history-type", historyTypeLabel(row.type)),
  routed: (row) => routedCell(row),
  file: (row) => textCell("history-file", row.file, row.fullPath),
  folder: (row) => textCell("history-folder", row.folder, row.folder),
  url: (row) => urlCell(row),
  fullPath: (row) => cell("history-full-path", row.fullPath),
  downloadId: (row) =>
    cell("history-download-id", row.downloadId == null ? "" : String(row.downloadId)),
  menuItem: (row) => cell("history-menu-item", row.menuItem),
  variables: (row) => variablesCell(row),
};

export const buildHistoryRow = (
  row: HistoryRow,
  rowIndex: number,
  columns: HistoryDisplayColumn[],
): HTMLTableRowElement => {
  const tr = document.createElement("tr");
  for (const { key, label } of columns) {
    if (!isHistoryColumnVisible(key)) continue;
    const build = CELL_BUILDERS[key];
    if (!build) continue;
    const td = build(row, rowIndex);
    td.dataset.column = key;
    td.dataset.label = label;
    tr.append(td);
  }
  return tr;
};

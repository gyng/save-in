// Which history columns are visible, and the checkbox list that changes them.
// The selection is a local view preference, not a synced setting, so it
// persists to localStorage rather than through the options schema.

import { HISTORY_COLUMNS } from "./history-model.ts";
import { historyColumns } from "./history-messages.ts";

const HISTORY_COLUMNS_KEY = "si-history-columns";

const defaultHistoryColumns = HISTORY_COLUMNS.filter(({ defaultVisible }) => defaultVisible).map(
  ({ key }) => key,
);

const loadVisibleHistoryColumns = (): Set<string> => {
  try {
    const storedColumns: unknown = JSON.parse(localStorage.getItem(HISTORY_COLUMNS_KEY) || "null");
    const valid = new Set<string>(HISTORY_COLUMNS.map(({ key }) => key));
    if (Array.isArray(storedColumns)) {
      const selected = storedColumns.filter((key): key is string => valid.has(key));
      if (selected.length) return new Set(selected);
    }
  } catch {}
  return new Set(defaultHistoryColumns);
};

let visibleHistoryColumns = loadVisibleHistoryColumns();

export const isHistoryColumnVisible = (key: string): boolean => visibleHistoryColumns.has(key);

export const visibleHistoryColumnCount = (): number => visibleHistoryColumns.size;

// A stored selection can go stale while the panel is open (another options tab
// writes it), so setup re-reads rather than trusting the module-load value.
export const reloadVisibleHistoryColumns = (): void => {
  visibleHistoryColumns = loadVisibleHistoryColumns();
};

// Live text nodes for the column checkboxes' labels: a locale change re-renders
// the table, and these labels must follow without rebuilding the checkboxes.
const historyColumnOptionLabels = new Map<string, Text>();

export const clearHistoryColumnOptionLabels = (): void => {
  historyColumnOptionLabels.clear();
};

export const syncHistoryColumnOptionLabels = (): void => {
  for (const { key, label } of historyColumns()) {
    const node = historyColumnOptionLabels.get(key);
    if (node) node.data = label;
  }
};

export const setupHistoryColumnOptions = (onChange: () => void): void => {
  const columnOptions = document.querySelector("#history-column-options");
  if (!columnOptions) return;
  for (const { key, label } of HISTORY_COLUMNS) {
    const option = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "history-column";
    checkbox.value = key;
    checkbox.checked = visibleHistoryColumns.has(key);
    checkbox.addEventListener("change", () => {
      // The table needs at least one column; refuse to uncheck the last one.
      if (checkbox.checked) visibleHistoryColumns.add(key);
      else if (visibleHistoryColumns.size > 1) visibleHistoryColumns.delete(key);
      else checkbox.checked = true;
      localStorage.setItem(HISTORY_COLUMNS_KEY, JSON.stringify([...visibleHistoryColumns]));
      onChange();
    });
    const labelNode = document.createTextNode(label);
    historyColumnOptionLabels.set(key, labelNode);
    option.append(checkbox, labelNode);
    columnOptions.append(option);
  }
};

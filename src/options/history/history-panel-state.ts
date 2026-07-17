// Pure view state for the history table: what is sorted, filtered, and paged.
// DOM-free by design (the -state.ts convention in AGENTS.md) — the controller
// modules read and mutate this record instead of coordinating loose globals.

import type { HistoryEntry, HistorySort } from "../../shared/history-types.ts";

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

export const HISTORY_PAGE_SIZE = 50;

// Newest-first cache and view state have one explicit owner.
export const historyState = createHistoryPanelState();

export const resetHistoryPanelState = (): void => {
  Object.assign(historyState, createHistoryPanelState());
};

// An inverted custom range filters nothing; the table falls back to an
// unbounded range and the filter UI reports the error instead.
export const historyDateIsValid = (): boolean =>
  !historyState.dateFrom || !historyState.dateTo || historyState.dateFrom <= historyState.dateTo;

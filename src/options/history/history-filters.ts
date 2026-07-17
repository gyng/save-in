// The history filter bar: the search box, the source/status/type/date facets,
// the active-filter chips, and the clear-filters button.
//
// setupHistoryFilters takes the repaint callback rather than importing
// history-table.ts, which imports updateHistoryFilterUi from here.

import { historyDateRange } from "./history-view.ts";
import { historyMessage } from "./history-messages.ts";
import { historyDateIsValid, historyState } from "./history-panel-state.ts";

const FILTER_CONTROL_DEFAULTS: Record<string, string> = {
  "history-filter": "",
  "history-source-filter": "",
  "history-status-filter": "",
  "history-type-filter": "",
  "history-date-preset": "any",
  "history-date-from": "",
  "history-date-to": "",
};

const selectedLabel = (id: string) =>
  document.querySelector<HTMLSelectElement>(id)?.selectedOptions[0]?.textContent?.trim() || "";

const customRangeLabel = (): string =>
  historyState.dateFrom && historyState.dateTo
    ? `${historyState.dateFrom} – ${historyState.dateTo}`
    : historyState.dateFrom
      ? historyMessage("historyFilterSince", `Since ${historyState.dateFrom}`, [
          historyState.dateFrom,
        ])
      : historyState.dateTo
        ? historyMessage("historyFilterThrough", `Through ${historyState.dateTo}`, [
            historyState.dateTo,
          ])
        : historyMessage("o_lHistoryCustomRange", "Custom date range");

const activeFilterLabels = (): string[] => {
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
        ? customRangeLabel()
        : selectedLabel("#history-date-preset"),
    );
  }
  return active;
};

const renderActiveFilterChips = (active: string[]): void => {
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
};

// The two date inputs bound each other and report an inverted range inline;
// the table separately falls back to an unbounded range while it is invalid.
const updateDateRangeValidity = (): void => {
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

export const updateHistoryFilterUi = (): void => {
  renderActiveFilterChips(activeFilterLabels());
  updateDateRangeValidity();
};

const bindHistoryFacet = (id: string, update: (value: string) => void, onChange: () => void) => {
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
      onChange();
    });
};

// Editing either date input implies a custom range, so the preset follows.
const selectCustomHistoryRange = () => {
  historyState.datePreset = "custom";
  const preset = document.querySelector<HTMLSelectElement>("#history-date-preset");
  if (preset) preset.value = "custom";
};

const resetFilterControls = (): void => {
  for (const [id, value] of Object.entries(FILTER_CONTROL_DEFAULTS)) {
    const control = document.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`);
    if (control) control.value = value;
  }
};

export const setupHistoryFilters = (onChange: () => void): void => {
  const historyFilterInput = document.querySelector<HTMLInputElement>("#history-filter");
  historyFilterInput?.addEventListener("input", () => {
    historyState.filter = historyFilterInput.value;
    historyState.page = 0;
    onChange();
  });

  bindHistoryFacet(
    "#history-source-filter",
    (value) => (historyState.sourceFilter = value),
    onChange,
  );
  bindHistoryFacet(
    "#history-status-filter",
    (value) => (historyState.statusFilter = value),
    onChange,
  );
  bindHistoryFacet("#history-type-filter", (value) => (historyState.typeFilter = value), onChange);
  bindHistoryFacet(
    "#history-date-preset",
    (value) => {
      historyState.datePreset = value;
      const range = historyDateRange(value);
      historyState.dateFrom = range.from;
      historyState.dateTo = range.to;
      const from = document.querySelector<HTMLInputElement>("#history-date-from");
      const to = document.querySelector<HTMLInputElement>("#history-date-to");
      if (from) from.value = historyState.dateFrom;
      if (to) to.value = historyState.dateTo;
    },
    onChange,
  );
  bindHistoryFacet(
    "#history-date-from",
    (value) => {
      historyState.dateFrom = value;
      selectCustomHistoryRange();
    },
    onChange,
  );
  bindHistoryFacet(
    "#history-date-to",
    (value) => {
      historyState.dateTo = value;
      selectCustomHistoryRange();
    },
    onChange,
  );

  document.querySelector("#history-clear-filters")?.addEventListener("click", () => {
    Object.assign(historyState, {
      filter: "",
      sourceFilter: "",
      statusFilter: "",
      typeFilter: "",
      datePreset: "any",
      dateFrom: "",
      dateTo: "",
      page: 0,
    });
    resetFilterControls();
    onChange();
  });
};

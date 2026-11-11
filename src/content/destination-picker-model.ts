import type { PickerModel } from "../shared/destination-picker.ts";

// Pure state for the in-page destination picker: the flattened menu, the
// type-to-filter result, and which destination the keyboard is on.

export type PickerRow =
  | {
      kind: "destination";
      id: string;
      // What the row shows. In a filtered list that is the full label, since
      // the headings that gave a nested title its meaning are gone.
      title: string;
      // The destination with its ancestors, for filtering and for a screen
      // reader that cannot see the indentation.
      label: string;
      depth: number;
      lastUsed: boolean;
    }
  | { kind: "heading"; title: string; depth: number }
  | { kind: "separator" };

export type PickerDestination = Extract<PickerRow, { kind: "destination" }>;

export type PickerState = {
  rows: PickerRow[];
  visible: PickerRow[];
  query: string;
  activeId: string | null;
};

const LABEL_SEPARATOR = " / ";

const isDestination = (row: PickerRow): row is PickerDestination => row.kind === "destination";

const pushSeparator = (rows: PickerRow[]): void => {
  const previous = rows[rows.length - 1];
  if (previous && previous.kind !== "separator") rows.push({ kind: "separator" });
};

// Menu order, with nesting turned into depth. An item that has children is a
// submenu in the browser menu and cannot be picked there, so it is a heading
// here too.
export const flattenPickerModel = ({ lastUsed, items }: PickerModel): PickerRow[] => {
  const rows: PickerRow[] = [];
  if (lastUsed) {
    rows.push({
      kind: "destination",
      id: lastUsed.id,
      title: lastUsed.title,
      label: lastUsed.title,
      depth: 0,
      lastUsed: true,
    });
    pushSeparator(rows);
  }
  const parents = new Set(items.flatMap((item) => (item.kind === "path" ? [item.parentId] : [])));
  const placed = new Map<string, { depth: number; label: string }>();
  for (const item of items) {
    if (item.kind === "separator") {
      pushSeparator(rows);
      continue;
    }
    const parent = item.parentId === null ? undefined : placed.get(item.parentId);
    const depth = parent ? parent.depth + 1 : 0;
    const label = parent ? `${parent.label}${LABEL_SEPARATOR}${item.title}` : item.title;
    placed.set(item.id, { depth, label });
    rows.push(
      parents.has(item.id)
        ? { kind: "heading", title: item.title, depth }
        : { kind: "destination", id: item.id, title: item.title, label, depth, lastUsed: false },
    );
  }
  if (rows[rows.length - 1]?.kind === "separator") rows.pop();
  return rows;
};

export const hasPickerDestinations = (rows: readonly PickerRow[]): boolean =>
  rows.some(isDestination);

// Every whitespace-separated term must appear in the destination's label, in
// any order and any case. A filtered list is flat: headings and separators
// describe a structure that no longer holds.
export const filterPickerRows = (rows: readonly PickerRow[], query: string): PickerRow[] => {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...rows];
  return rows.filter(isDestination).flatMap((row) => {
    const label = row.label.toLowerCase();
    return terms.every((term) => label.includes(term))
      ? [{ ...row, title: row.label, depth: 0 }]
      : [];
  });
};

const firstDestinationId = (rows: readonly PickerRow[]): string | null =>
  rows.find(isDestination)?.id ?? null;

export const createPickerState = (rows: PickerRow[]): PickerState => ({
  rows,
  visible: rows,
  query: "",
  activeId: firstDestinationId(rows),
});

// A new query always starts from its best match, so Enter saves what the user
// just narrowed to rather than a row that happened to survive the filter.
export const setPickerQuery = (state: PickerState, query: string): PickerState => {
  const visible = filterPickerRows(state.rows, query);
  return { ...state, query, visible, activeId: firstDestinationId(visible) };
};

export const movePickerActive = (state: PickerState, delta: 1 | -1): PickerState => {
  const destinations = state.visible.filter(isDestination);
  // Walking the list in the direction of travel makes "the one after the
  // active row, else the first" cover both wrapping and no active row.
  const order = delta > 0 ? destinations : destinations.toReversed();
  const next = order[order.findIndex((row) => row.id === state.activeId) + 1] ?? order[0];
  return next ? { ...state, activeId: next.id } : state;
};

export const setPickerActive = (state: PickerState, id: string): PickerState =>
  state.activeId !== id && state.visible.some((row) => isDestination(row) && row.id === id)
    ? { ...state, activeId: id }
    : state;

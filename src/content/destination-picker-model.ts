import type { PickerModel, PickerSource } from "../shared/destination-picker.ts";

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
      // Picks this destination with one keystroke while nothing is typed.
      key?: string;
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
      ...(lastUsed.key ? { key: lastUsed.key } : {}),
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
        : {
            kind: "destination",
            id: item.id,
            title: item.title,
            label,
            depth,
            lastUsed: false,
            ...(item.key ? { key: item.key } : {}),
          },
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

// What a choice in the picker will save, shown in its header so a picker
// opened by a keyboard command says what it is about to act on.
export type PickerSubject = {
  kind: "image" | "video" | "audio" | "link" | "page";
  // A file name or the page title; empty when the address carries no name.
  name: string;
};

// The last path segment a person would recognize as the file's name, else the
// host. An inline data: or page-owned blob: address has neither.
const addressName = (address: string): string => {
  try {
    const url = new URL(address);
    if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "ftp:") return "";
    const segment = url.pathname.split("/").findLast((part) => part.length > 0);
    if (segment === undefined) return url.hostname;
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  } catch {
    return "";
  }
};

export const pickerSubject = (source: PickerSource | null, pageTitle: string): PickerSubject => {
  if (source?.media) return { kind: source.media.kind, name: addressName(source.media.url) };
  if (source?.linkUrl) return { kind: "link", name: addressName(source.linkUrl) };
  return { kind: "page", name: pageTitle.trim() };
};

// Splits a row title around the filter terms so the view can mark what
// matched. Terms are found the way filterPickerRows finds them; overlapping
// and adjacent matches merge into one mark.
export const splitPickerMatches = (
  title: string,
  query: string,
): Array<{ text: string; match: boolean }> => {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = title.toLowerCase();
  // Case folding can change a string's length; marks would then land on the
  // wrong characters, so such a title is shown unmarked.
  if (terms.length === 0 || haystack.length !== title.length) {
    return [{ text: title, match: false }];
  }
  const marked = Array.from({ length: title.length }, () => false);
  for (const term of terms) {
    for (let at = haystack.indexOf(term); at !== -1; at = haystack.indexOf(term, at + 1)) {
      marked.fill(true, at, at + term.length);
    }
  }
  const parts: Array<{ text: string; match: boolean }> = [];
  for (let index = 0; index < title.length; index += 1) {
    const match = marked[index] === true;
    const last = parts[parts.length - 1];
    if (last && last.match === match) last.text += title.charAt(index);
    else parts.push({ text: title.charAt(index), match });
  }
  return parts;
};

// The destination a single keystroke picks, as an access key does in the
// browser's own menu. Keys act only while the filter is empty: once the user
// is typing a name, every character belongs to that name.
export const pickerKeyTarget = (state: PickerState, key: string): string | null => {
  if (state.query !== "") return null;
  const pressed = key.toLowerCase();
  return state.rows.filter(isDestination).find((row) => row.key === pressed)?.id ?? null;
};

// The in-page destination picker is drawn by the content script from a model
// the background builds, and its selection is saved by the background. Neither
// layer may import the other, so their bounded contract lives here.
//
// Only menu item ids and titles cross to the page side. A selection comes back
// as an id the background resolves itself; no path string is ever accepted
// from the page side.
import { DATA_URL_MAX_LENGTH } from "./data-url.ts";
import { parseHoveredSource, type HoveredSource } from "./hovered-source.ts";
import { isStringKeyedRecord } from "./util.ts";

// Background → top-frame content script.
export const PICKER_OPEN_REQUEST = "SAVE_IN_OPEN_PICKER";

const MAX_PICKER_ITEMS = 2_000;
const MAX_PICKER_TEXT_LENGTH = 1_024;

export type PickerCopy = { title: string; filter: string; empty: string; lastUsed: string };
export type PickerItem =
  | { kind: "path"; id: string; title: string; parentId: string | null }
  | { kind: "separator" };
export type PickerModel = {
  lastUsed: { id: string; title: string } | null;
  items: PickerItem[];
  copy: PickerCopy;
};

// What the picker will save. It has the hovered-source shape because the save
// is the same synthesized menu click, but a click-to-save source may be an
// inline data: address up to the cap that path already accepts.
export type PickerSource = HoveredSource;
export const parsePickerSource = (value: unknown): PickerSource | null =>
  parseHoveredSource(value, DATA_URL_MAX_LENGTH);

const boundedText = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_PICKER_TEXT_LENGTH
    ? value
    : undefined;

const parsePickerCopy = (value: unknown): PickerCopy | null => {
  if (!isStringKeyedRecord(value)) return null;
  const title = boundedText(value.title);
  const filter = boundedText(value.filter);
  const empty = boundedText(value.empty);
  const lastUsed = boundedText(value.lastUsed);
  return title && filter && empty && lastUsed ? { title, filter, empty, lastUsed } : null;
};

const parsePickerItem = (value: unknown): PickerItem | null => {
  if (!isStringKeyedRecord(value)) return null;
  if (value.kind === "separator") return { kind: "separator" };
  const id = boundedText(value.id);
  const title = boundedText(value.title);
  if (value.kind !== "path" || !id || !title) return null;
  return { kind: "path", id, title, parentId: boundedText(value.parentId) ?? null };
};

// A content script from an older or newer version may be talking to this
// background, so the page side checks the model instead of trusting its shape.
export const parsePickerModel = (value: unknown): PickerModel | null => {
  if (!isStringKeyedRecord(value) || !Array.isArray(value.items)) return null;
  const copy = parsePickerCopy(value.copy);
  if (!copy || value.items.length > MAX_PICKER_ITEMS) return null;
  const items = value.items.map(parsePickerItem);
  if (!items.every((item): item is PickerItem => item !== null)) return null;
  const rawLastUsed = isStringKeyedRecord(value.lastUsed) ? value.lastUsed : {};
  const id = boundedText(rawLastUsed.id);
  const title = boundedText(rawLastUsed.title);
  return { lastUsed: id && title ? { id, title } : null, items, copy };
};

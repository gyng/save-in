// The content script reads page text for pagetext: rules, while the routing
// matcher, the message protocol, and the background menu bridge consume it in
// contexts that cannot import content code. Their bounded contract lives here.
import { MAX_CSS_SELECTOR_LENGTH } from "./css-selector-attestation.ts";

export const PAGE_TEXT_REQUEST = "SAVE_IN_PAGE_TEXT";
// One selector per rule, so this also bounds the rules that may capture text.
export const MAX_PAGE_TEXT_SELECTORS = 64;
// The text names a file or folder; a path component is far shorter than this.
export const MAX_PAGE_TEXT_LENGTH = 512;

// Selector/text pairs for the configured pagetext: selectors that found text on
// the page. A selector that found none is simply absent.
export type PageTextCapture = Array<[selector: string, text: string]>;

// Page text is untrusted. Collapsing whitespace and bounding the length here
// gives every reader one canonical form; filename sanitization still happens
// in the routing pipeline, where the value becomes a single path component.
export const normalizePageText = (value: string): string =>
  value.replace(/\s+/g, " ").trim().slice(0, MAX_PAGE_TEXT_LENGTH).trimEnd();

const isPageTextSelector = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_CSS_SELECTOR_LENGTH;

export const isPageTextSelectorList = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= MAX_PAGE_TEXT_SELECTORS &&
  value.every(isPageTextSelector);

export const isPageTextCapture = (value: unknown): value is PageTextCapture =>
  Array.isArray(value) &&
  value.length <= MAX_PAGE_TEXT_SELECTORS &&
  value.every(
    (entry: unknown) =>
      Array.isArray(entry) &&
      entry.length === 2 &&
      isPageTextSelector(entry[0]) &&
      typeof entry[1] === "string" &&
      entry[1].length > 0 &&
      // Only the canonical form is accepted, so a sender cannot hand routing a
      // longer or differently spaced value than the content script produces.
      entry[1] === normalizePageText(entry[1]),
  );

// A bridge answer may only speak for the selectors that were asked about.
export const parsePageTextCapture = (
  value: unknown,
  requestedSelectors: readonly string[],
): PageTextCapture | undefined =>
  isPageTextCapture(value)
    ? value.filter(([selector]) => requestedSelectors.includes(selector))
    : undefined;

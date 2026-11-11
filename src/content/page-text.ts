import {
  isPageTextSelectorList,
  MAX_PAGE_TEXT_LENGTH,
  normalizePageText,
  type PageTextCapture,
} from "../shared/page-text-capture.ts";

// A selector such as `body` can match megabytes of text, and one written
// loosely can match thousands of elements. Only the start of the first few
// matches is ever examined, so a save costs the same on a huge page.
const MAX_ELEMENTS_PER_SELECTOR = 16;
const MAX_RAW_TEXT_LENGTH = MAX_PAGE_TEXT_LENGTH * 8;

// A <meta> element carries its value in an attribute and never has text of
// its own, so its content stands in: pages commonly state an author or title
// there in a far more stable place than their visible markup.
const elementText = (element: Element): string =>
  normalizePageText(
    // textContent is null only for documents and doctypes, never an element.
    (element instanceof HTMLMetaElement ? element.content : element.textContent || "").slice(
      0,
      MAX_RAW_TEXT_LENGTH,
    ),
  );

const firstText = (root: ParentNode, selector: string): string => {
  let elements: Element[];
  try {
    elements = Array.from(root.querySelectorAll(selector)).slice(0, MAX_ELEMENTS_PER_SELECTOR);
  } catch {
    // Stored settings may predate selector validation or be written directly.
    // An invalid selector captures nothing, so its rule fails closed.
    return "";
  }
  for (const element of elements) {
    const text = elementText(element);
    if (text) return text;
  }
  return "";
};

// Reads the text of the first element with any, for each selector, from the
// top-level document only. Called at save intent with the selectors of rules
// that can apply to this page — never to watch a page.
export const capturePageText = (root: ParentNode, selectors: unknown): PageTextCapture => {
  if (!isPageTextSelectorList(selectors)) return [];
  const captured: PageTextCapture = [];
  for (const selector of new Set(selectors)) {
    const text = firstText(root, selector);
    if (text) captured.push([selector, text]);
  }
  return captured;
};

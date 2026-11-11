import {
  boundedContextImageUrl,
  boundedImageAltText,
  type ContextImage,
} from "../shared/context-image.ts";
import { isSourcePanelHost } from "./source-panel-host.ts";

// The browser decides a context menu's context on its own, and reports a plain
// "page" for an image it has not finished loading or that sits under an empty
// overlay element. A menu save then stores the page instead of the image the
// pointer was on (#237), so the image is recovered from the event itself.

// Overlays are a few wrappers deep at most; a bounded scan keeps a huge
// stacked page from costing more than the right-click it serves.
const MAX_STACK_DEPTH = 16;

const imageAtPoint = (event: MouseEvent): HTMLImageElement | null => {
  const root = event.target instanceof Node ? event.target.ownerDocument : null;
  if (!root || typeof root.elementsFromPoint !== "function") return null;
  for (const element of root
    .elementsFromPoint(event.clientX, event.clientY)
    .slice(0, MAX_STACK_DEPTH)) {
    if (element instanceof HTMLImageElement) return element;
    // Only empty elements are looked through. Text or other content above an
    // image means the user pointed at that content, not at a backdrop image.
    // A shadow host is never provably empty: its content lives in a tree that
    // textContent does not read and a closed root does not expose, so a custom
    // element — and Save In's own panel — counts as content.
    if (
      element instanceof HTMLMediaElement ||
      element instanceof HTMLCanvasElement ||
      element.shadowRoot ||
      element.localName.includes("-") ||
      isSourcePanelHost(element) ||
      element.textContent?.trim()
    ) {
      return null;
    }
  }
  return null;
};

export const contextImageFromEvent = (event: MouseEvent): ContextImage | null => {
  const pathImage = event
    .composedPath()
    .find((candidate): candidate is HTMLImageElement => candidate instanceof HTMLImageElement);
  const image = pathImage ?? imageAtPoint(event);
  if (!image) return null;
  const src = boundedContextImageUrl(image.currentSrc || image.src);
  if (!src) return null;
  const alt = imageAltText(image);
  return { src, ...(alt ? { alt } : {}) };
};

// Click-to-save and the Page Sources panel hold the saved element itself, so
// they read its alt text directly instead of through the right-click record.
export const imageAltText = (element: Element): string | undefined =>
  element instanceof HTMLImageElement
    ? boundedImageAltText(element.getAttribute("alt"))
    : undefined;

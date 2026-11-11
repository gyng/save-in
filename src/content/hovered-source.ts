import { parseHoveredSource, type HoveredSource } from "../shared/hovered-source.ts";
import { imageAltText } from "./context-image.ts";

// A keyboard command carries no pointer position, and tracking one would cost
// a mousemove listener on every page. The browser already knows what the
// pointer is over: the deepest :hover element, read only when a command asks.

// Open shadow roots are followed a few levels at most; a closed root — Save
// In's own panel included — reports only its host.
const MAX_SHADOW_DEPTH = 8;

type SourceLookup = (
  event: {
    target: EventTarget | null;
    clientX: number;
    clientY: number;
    composedPath: () => Array<EventTarget | null>;
  },
  allowLinks: boolean,
  preferLink?: boolean,
) => { url: string; kind: string; element?: Element } | undefined;

export const hoveredElement = (root: Document): Element | null => {
  let scope: Document | ShadowRoot = root;
  let deepest: Element | null = null;
  for (let depth = 0; depth < MAX_SHADOW_DEPTH; depth += 1) {
    const hovered: NodeListOf<Element> = scope.querySelectorAll(":hover");
    const last: Element | undefined = hovered[hovered.length - 1];
    if (!last) break;
    deepest = last;
    if (!last.shadowRoot) break;
    scope = last.shadowRoot;
  }
  return deepest;
};

const composedAncestors = (element: Element): Node[] => {
  const path: Node[] = [];
  let node: Node | null = element;
  while (node) {
    path.push(node);
    node = node instanceof ShadowRoot ? node.host : node.parentNode;
  }
  return path;
};

// findSource is click-to-save's resolver, so a command saves the same thing a
// click on that element would. The pointer position is unknown here, so its
// coordinate lookup is pointed outside the viewport: guessing a position from
// the hovered element's box could reach media the pointer is nowhere near.
export const hoveredSourceFromDocument = (
  root: Document,
  findSource: SourceLookup,
): HoveredSource | null => {
  const element = hoveredElement(root);
  if (!element) return null;
  const path = composedAncestors(element);
  const event = { target: element, clientX: -1, clientY: -1, composedPath: () => path };
  const media = findSource(event, false);
  const link = findSource(event, true, true);
  // The shared parser bounds both addresses, so the page side never answers
  // with something the background would refuse anyway.
  return parseHoveredSource({
    media: media && {
      url: media.url,
      kind: media.kind,
      alt: media.element && imageAltText(media.element),
    },
    linkUrl: link?.kind === "link" ? link.url : undefined,
  });
};

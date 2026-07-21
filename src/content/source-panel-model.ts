import type { UiTheme } from "../config/content-options.ts";
import type { SourcePanelCopy } from "../shared/source-panel-copy.ts";
import type { PageSourceChannel, PageSourceKind } from "../shared/page-source.ts";
import { isStringMember } from "../shared/util.ts";
import {
  DATA_URL_COLLECTION_CHARACTER_BUDGET,
  isDataUrl,
  isDataUrlWithinCap,
} from "../shared/data-url.ts";

export type { PageSourceKind, PageSourceChannel } from "../shared/page-source.ts";
export type PageSource = {
  url: string;
  kind: PageSourceKind;
  element: Element;
  // URL-deduplicated panel rows retain every element that discovered the
  // source so DOM-aware routing does not depend on traversal order.
  originElements?: Element[] | undefined;
  // Candidate compaction owns this list across incremental reconciliation.
  // originElements above is derived afresh by mergePageSourcesByUrl, because
  // cached row records reuse it and must not resurrect origins removed later.
  collectorOriginElements?: Element[] | undefined;
  bytes?: number | undefined;
  previewable?: boolean | undefined;
  detectedAt?: number | undefined;
  detectedOrder?: number | undefined;
  // Absent for media embedded directly on the page (img/video/audio) — the
  // pre-4.2 default. Set for anchor/background/resource-hint candidates so the
  // automatic scan can gate admission by channel x kind (Page Sources panel
  // itself does not read this field; its behavior is unchanged).
  channel?: PageSourceChannel | undefined;
  responsive?:
    | {
        descriptor?: string | undefined;
        selected: boolean;
      }
    | undefined;
};
export type PageSourceCandidate = PageSource & { collectorOriginElements: Element[] };
export type SourcePanelOptions = {
  enabled?: boolean;
  includeBackgrounds?: boolean;
  live?: boolean;
  previews?: boolean;
  resourceHints?: boolean;
  includeLinks?: boolean;
  copy?: SourcePanelCopy;
  locale?: string;
  theme?: UiTheme;
  onOpenChange?: (open: boolean) => void;
  onSaveIntent?: () => void;
  onCreateRule?: (source: PageSource) => void | Promise<void>;
};

export type PageSourcePayloadBudget = {
  dataUrls: Set<string>;
  dataUrlCharacters: number;
  maximumDataUrlCharacters: number;
  excludeUrl?: ((url: string) => boolean) | undefined;
};

export const createPageSourcePayloadBudget = (
  sources: Iterable<Pick<PageSource, "url">> = [],
  maximumDataUrlCharacters = DATA_URL_COLLECTION_CHARACTER_BUDGET,
  excludeUrl?: (url: string) => boolean,
): PageSourcePayloadBudget => {
  const budget: PageSourcePayloadBudget = {
    dataUrls: new Set(),
    dataUrlCharacters: 0,
    maximumDataUrlCharacters,
    ...(excludeUrl ? { excludeUrl } : {}),
  };
  for (const { url } of sources) {
    if (!isDataUrl(url) || budget.dataUrls.has(url)) continue;
    budget.dataUrls.add(url);
    budget.dataUrlCharacters += url.length;
  }
  return budget;
};

export type SourcePanelResourceTiming = Pick<
  PerformanceResourceTiming,
  "name" | "encodedBodySize" | "transferSize"
>;
export type ResourceTimingByUrl = ReadonlyMap<string, SourcePanelResourceTiming>;

// PerformanceObserver delivers every future resource even after the browser's
// own performance-entry buffer rolls over. Page Sources can stay open for an
// entire SPA visit, so retaining that unbounded stream would let unrelated,
// cache-busted resources pin timing objects for the lifetime of the panel.
export const SOURCE_PANEL_RESOURCE_TIMING_LIMIT = 512;

export const mergeResourceTimings = (
  target: Map<string, SourcePanelResourceTiming>,
  entries: Iterable<SourcePanelResourceTiming>,
): Map<string, SourcePanelResourceTiming> => {
  for (const entry of entries) {
    // Refresh insertion order as well as metadata, so the cap retains the most
    // recently observed version of a URL rather than its first occurrence.
    target.delete(entry.name);
    if (target.size >= SOURCE_PANEL_RESOURCE_TIMING_LIMIT) {
      for (const oldest of target.keys()) {
        target.delete(oldest);
        break;
      }
    }
    // Only these scalar fields are consumed. Holding the browser-owned timing
    // object would also retain optional detail such as a large Server-Timing
    // array for no Page Sources behavior.
    target.set(entry.name, {
      name: entry.name,
      encodedBodySize: entry.encodedBodySize,
      transferSize: entry.transferSize,
    });
  }
  return target;
};

export const isPerformanceResourceTiming = (
  entry: PerformanceEntry,
): entry is PerformanceResourceTiming => !entry.entryType || entry.entryType === "resource";

export const urlsFromCss = (value: string): string[] =>
  [...value.matchAll(/url\((?:"([^"]+)"|'([^']+)'|([^)'"\s]+))\)/g)].flatMap((match) => {
    const url = match[1] || match[2] || match[3];
    /* v8 ignore next -- The CSS URL expression always captures one supported form. */
    return url ? [url] : [];
  });

const isAsciiWhitespace = (value: string | undefined): boolean =>
  value !== undefined && /[\t\n\f\r ]/.test(value);

// Mirrors the URL-token boundaries in the HTML srcset parser. In particular,
// commas inside a non-whitespace URL (such as a data URL) are not separators.
export type SrcsetCandidate = { url: string; descriptor?: string | undefined };

export const candidatesFromSrcset = (input: string): SrcsetCandidate[] => {
  const candidates: SrcsetCandidate[] = [];
  let position = 0;
  while (position < input.length) {
    while (
      position < input.length &&
      (isAsciiWhitespace(input[position]) || input[position] === ",")
    )
      position += 1;
    if (position >= input.length) break;

    const start = position;
    while (position < input.length && !isAsciiWhitespace(input[position])) position += 1;
    let url = input.slice(start, position);
    if (url.endsWith(",")) {
      url = url.replace(/,+$/, "");
      candidates.push({ url });
      continue;
    }

    const descriptorStart = position;
    let parentheses = 0;
    while (position < input.length) {
      const character = input[position];
      position += 1;
      if (character === "(") parentheses += 1;
      else if (character === ")" && parentheses > 0) parentheses -= 1;
      else if (character === "," && parentheses === 0) break;
    }
    const descriptor = input
      .slice(descriptorStart, position - (input[position - 1] === "," ? 1 : 0))
      .trim();
    candidates.push(descriptor ? { url, descriptor } : { url });
  }
  return candidates;
};

export const urlsFromSrcset = (input: string): string[] =>
  candidatesFromSrcset(input).map(({ url }) => url);

export const mergePageSourcesByUrl = (sources: PageSource[]): PageSource[] => {
  const merged = new Map<
    string,
    { source: PageSource; origins: Element[]; originSet: Set<Element> }
  >();
  // Source records are reused by the live collector and captured by cached row
  // controls. Rebuild their derived origin list on every commit so those
  // controls keep a live record without retaining removed duplicate elements.
  sources.forEach((source) => {
    const sourceOrigins =
      source.collectorOriginElements ??
      (source.channel === "resource-hint" ? [] : [source.element]);
    const existing = merged.get(source.url);
    if (!existing) {
      const origins = source.collectorOriginElements
        ? source.collectorOriginElements
        : [...new Set(sourceOrigins)];
      merged.set(source.url, {
        source,
        origins,
        originSet: new Set(origins),
      });
      return;
    }
    for (const sourceOrigin of sourceOrigins) {
      if (existing.originSet.has(sourceOrigin)) continue;
      if (existing.origins === existing.source.collectorOriginElements) {
        existing.origins = [...existing.origins];
      }
      existing.originSet.add(sourceOrigin);
      existing.origins.push(sourceOrigin);
    }
    if (!existing.source.responsive && source.responsive)
      existing.source.responsive = source.responsive;
    else if (existing.source.responsive && source.responsive) {
      existing.source.responsive.selected ||= source.responsive.selected;
      existing.source.responsive.descriptor ||= source.responsive.descriptor;
    }
  });
  return [...merged.values()].map(({ source, origins }) => {
    source.originElements = origins;
    return source;
  });
};

const createPageSourceCandidateAccumulator = (
  deduplicateOrigins = false,
  preserveDuplicateOrigins = true,
) => {
  type CandidateEntry = {
    source: PageSource;
    origins: Element[];
    originSet?: Set<Element>;
  };
  const byUrl = new Map<string, CandidateEntry | Map<string, CandidateEntry>>();
  const values: PageSourceCandidate[] = [];
  const variantKey = (kind: PageSourceKind, channel?: PageSource["channel"]): string =>
    `${kind}\0${channel ?? ""}`;
  const add = (
    url: string,
    kind: PageSourceKind,
    element: Element,
    bytes?: number,
    previewable?: boolean,
    responsive?: PageSource["responsive"],
    channel?: PageSource["channel"],
    suppliedOrigins?: readonly Element[],
  ) => {
    const stored = byUrl.get(url);
    let existing: CandidateEntry | undefined;
    let variants: Map<string, CandidateEntry> | undefined;
    if (stored instanceof Map) {
      variants = stored;
      existing = stored.get(variantKey(kind, channel));
    } else if (stored) {
      if (stored.source.kind === kind && stored.source.channel === channel) existing = stored;
      else {
        variants = new Map([[variantKey(stored.source.kind, stored.source.channel), stored]]);
        byUrl.set(url, variants);
      }
    }
    const sourceOrigins = suppliedOrigins ?? (channel === "resource-hint" ? [] : [element]);
    if (!existing) {
      const origins = preserveDuplicateOrigins
        ? [...new Set(sourceOrigins)]
        : sourceOrigins.slice(0, 1);
      const source: PageSourceCandidate = {
        url,
        kind,
        element,
        collectorOriginElements: origins,
        ...(bytes !== undefined ? { bytes } : {}),
        ...(previewable !== undefined ? { previewable } : {}),
        ...(responsive ? { responsive } : {}),
        ...(channel ? { channel } : {}),
      };
      const entry: CandidateEntry = {
        source,
        origins,
        ...(deduplicateOrigins ? { originSet: new Set(origins) } : {}),
      };
      if (variants) variants.set(variantKey(kind, channel), entry);
      else byUrl.set(url, entry);
      values.push(source);
      return;
    }
    if (preserveDuplicateOrigins) {
      for (const origin of sourceOrigins) {
        if (existing.originSet?.has(origin) || existing.origins.at(-1) === origin) continue;
        existing.originSet?.add(origin);
        existing.origins.push(origin);
      }
    }
    if (existing.source.previewable === false && previewable !== false) {
      existing.source.previewable = previewable;
    }
    if (!existing.source.bytes && bytes) existing.source.bytes = bytes;
    if (!existing.source.responsive && responsive) {
      existing.source.responsive = responsive;
    } else if (existing.source.responsive && responsive) {
      existing.source.responsive.selected ||= responsive.selected;
      existing.source.responsive.descriptor ||= responsive.descriptor;
    }
  };
  return { add, values };
};

export const createPageSourceCandidateCollection = () => {
  const compacted = createPageSourceCandidateAccumulator(true);
  return {
    values: compacted.values,
    addAll: (sources: Iterable<PageSource>): void => {
      for (const source of sources) {
        compacted.add(
          source.url,
          source.kind,
          source.element,
          source.bytes,
          source.previewable,
          source.responsive,
          source.channel,
          source.collectorOriginElements ?? source.originElements,
        );
      }
    },
  };
};

// Discovery needs every origin element for CSS routing, but not a full source
// object for every origin. Compact exact URL/kind/channel variants as they are
// collected so a gallery that repeats one asset retains one element reference
// per occurrence rather than one listener-facing record per occurrence.
export const compactPageSourceCandidates = (
  sources: Iterable<PageSource>,
): PageSourceCandidate[] => {
  const collection = createPageSourceCandidateCollection();
  collection.addAll(sources);
  return collection.values;
};

const absoluteUrl = (value: string): string | null => {
  try {
    const url = new URL(value, document.baseURI);
    return ["http:", "https:", "ftp:", "data:", "blob:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
};

const admittedPageSourceUrl = (
  value: string | null | undefined,
  budget: PageSourcePayloadBudget,
): string | null => {
  if (!value) return null;
  if (isDataUrl(value)) {
    if (!isDataUrlWithinCap(value) || budget.excludeUrl?.(value)) return null;
    if (budget.dataUrls.has(value)) return value;
    if (budget.dataUrlCharacters + value.length > budget.maximumDataUrlCharacters) return null;
    budget.dataUrls.add(value);
    budget.dataUrlCharacters += value.length;
    return value;
  }
  const url = absoluteUrl(value);
  return url && !budget.excludeUrl?.(url) ? url : null;
};

const SOURCE_URL_ADMISSION_CACHE_LIMIT = 512;

const createPageSourceUrlAdmission = (
  budget: PageSourcePayloadBudget,
): ((value: string | null | undefined) => string | null) => {
  const cache = new Map<string, string | null>();
  return (value) => {
    // Data URLs have their own character budget and deduplication set. Their
    // admission can change as that budget fills, so only cache ordinary URLs.
    if (!value || isDataUrl(value)) return admittedPageSourceUrl(value, budget);
    if (cache.has(value)) return cache.get(value) ?? null;
    const admitted = admittedPageSourceUrl(value, budget);
    if (cache.size >= SOURCE_URL_ADMISSION_CACHE_LIMIT) {
      for (const oldest of cache.keys()) {
        cache.delete(oldest);
        break;
      }
    }
    cache.set(value, admitted);
    return admitted;
  };
};

const resourceBytes = (...values: unknown[]): number | undefined =>
  values.find(
    (value): value is number =>
      typeof value === "number" && Number.isSafeInteger(value) && value > 0,
  );
export const formatSourceBytes = (bytes?: number): string => {
  const validBytes = resourceBytes(bytes);
  if (validBytes === undefined) return "size unknown";
  if (validBytes < 1024) return `${validBytes} B`;
  if (validBytes < 1024 * 1024) return `${Math.round(validBytes / 1024)} KB`;
  return `${(validBytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const filterPageSources = (
  sources: PageSource[],
  query: string,
  kind: "all" | PageSourceKind,
): PageSource[] => {
  const normalized = query.trim().toLocaleLowerCase();
  return sources.filter(
    (source) =>
      (kind === "all" || source.kind === kind) &&
      (!normalized || source.url.toLocaleLowerCase().includes(normalized)),
  );
};

const SOURCE_SORTS = [
  "relevance",
  "detected-desc",
  "detected-asc",
  "size-desc",
  "name-asc",
] as const;
export type SourceSort = (typeof SOURCE_SORTS)[number];
export const isSourceSort = (value: unknown): value is SourceSort =>
  isStringMember(SOURCE_SORTS, value);
const compareDetection = (a: PageSource, b: PageSource): number =>
  (a.detectedAt || 0) - (b.detectedAt || 0) || (a.detectedOrder || 0) - (b.detectedOrder || 0);

const KIND_RELEVANCE: Record<PageSourceKind, number> = {
  video: 36,
  audio: 34,
  stream: 32,
  image: 28,
  document: 16,
  link: 0,
};
const HIGH_VALUE_URL_HINT =
  /(?:^|[-_./])(?:download|full|hero|large|master|original|playlist|poster)(?:[-_./]|$)/i;
const LOW_VALUE_URL_HINT =
  /(?:^|[-_./])(?:analytics|avatar|badge|emoji|favicon|icon|logo|pixel|spacer|sprite|thumbnail|thumb|tracking)(?:[-_./]|$)/i;

const relevanceUrl = (value: string): string => {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return value;
  }
};

const sourceRelevanceBase = (source: PageSource): number => {
  let score = KIND_RELEVANCE[source.kind];
  if (source.element.matches("img, video, audio")) score += 32;
  else if (source.kind !== "link" && source.element.matches("a")) score += 12;
  if (source.previewable === true) score += 16;
  else if (source.previewable === false) score -= 18;
  if (source.element.closest("main, article, [role='main']")) score += 16;
  if (source.element.closest("[hidden], [aria-hidden='true']")) score -= 48;

  const url = relevanceUrl(source.url);
  if (HIGH_VALUE_URL_HINT.test(url)) score += 12;
  if (LOW_VALUE_URL_HINT.test(url)) score -= 32;
  return score;
};

const sourceRelevance = (source: PageSource, cache?: WeakMap<PageSource, number>): number => {
  let score = cache?.get(source);
  if (score === undefined) {
    score = sourceRelevanceBase(source);
    cache?.set(source, score);
  }
  if (source.bytes) score += Math.min(24, Math.log2(source.bytes + 1));
  return score;
};

type ScoredSource = { source: PageSource; relevance: number };

const compareRelevance = (a: ScoredSource, b: ScoredSource): number =>
  b.relevance - a.relevance ||
  (b.source.bytes || 0) - (a.source.bytes || 0) ||
  compareDetection(b.source, a.source) ||
  a.source.url.localeCompare(b.source.url);

export const sortPageSources = (
  sources: PageSource[],
  sort: SourceSort,
  relevanceCache?: WeakMap<PageSource, number>,
): PageSource[] => {
  if (sort === "relevance") {
    // Relevance reads DOM context through matches()/closest(). Decorate once so
    // a large result set pays that cost per source, not per sort comparison.
    return sources
      .map((source) => ({ source, relevance: sourceRelevance(source, relevanceCache) }))
      .toSorted(compareRelevance)
      .map(({ source }) => source);
  }
  return [...sources].toSorted((a, b) => {
    if (sort === "detected-asc") return compareDetection(a, b);
    if (sort === "size-desc") return (b.bytes || 0) - (a.bytes || 0);
    if (sort === "name-asc") return a.url.localeCompare(b.url);
    return compareDetection(b, a);
  });
};

export const createSourceTooltip = (source: PageSource): HTMLElement | null => {
  if (!["image", "video", "audio"].includes(source.kind)) return null;
  const tooltip = document.createElement("div");
  tooltip.className = `media-tooltip media-tooltip-${source.kind}`;
  tooltip.setAttribute("role", "tooltip");
  const media = document.createElement(source.kind === "image" ? "img" : source.kind);
  media.setAttribute("src", source.url);
  if (media instanceof HTMLMediaElement) {
    media.autoplay = true;
    media.controls = true;
    media.preload = "metadata";
    if (media instanceof HTMLVideoElement) {
      media.muted = true;
      media.loop = true;
      media.playsInline = true;
    }
  } else {
    /* v8 ignore next -- Supported preview kinds create either media or image elements. */
    if (media instanceof HTMLImageElement) media.alt = "";
  }
  tooltip.append(media);
  return tooltip;
};

export type SourceTooltipDock = "right" | "bottom" | "left" | "top" | "floating";
export type SourceTooltipSide = "left" | "right" | "top" | "bottom";
type SourceTooltipRect = Pick<DOMRectReadOnly, "left" | "top" | "right" | "bottom">;
type SourceTooltipSize = { width: number; height: number };
type SourceViewport = SourceTooltipSize & { left?: number; top?: number };

export const positionDraggedSourcePanel = (
  panel: Pick<DOMRectReadOnly, "left" | "top" | "width" | "height">,
  start: { x: number; y: number },
  current: { x: number; y: number },
  viewport: SourceViewport,
): { left: number; top: number } => {
  const margin = 8;
  const clamp = (value: number, size: number, viewportStart: number, viewportSize: number) =>
    Math.max(
      viewportStart + margin,
      Math.min(
        value,
        Math.max(viewportStart + margin, viewportStart + viewportSize - size - margin),
      ),
    );
  const viewportLeft = viewport.left ?? 0;
  const viewportTop = viewport.top ?? 0;
  return {
    left: clamp(panel.left + current.x - start.x, panel.width, viewportLeft, viewport.width),
    top: clamp(panel.top + current.y - start.y, panel.height, viewportTop, viewport.height),
  };
};

export const positionSourceTooltip = (
  anchor: SourceTooltipRect,
  panel: SourceTooltipRect,
  tooltip: SourceTooltipSize,
  viewport: SourceViewport,
  dock: SourceTooltipDock,
): { left: number; top: number; side: SourceTooltipSide } => {
  const gap = 8;
  const margin = 8;
  const available: Record<SourceTooltipSide, number> = {
    left: panel.left - (viewport.left ?? 0) - gap - margin,
    right: (viewport.left ?? 0) + viewport.width - panel.right - gap - margin,
    top: panel.top - (viewport.top ?? 0) - gap - margin,
    bottom: (viewport.top ?? 0) + viewport.height - panel.bottom - gap - margin,
  };
  const required: Record<SourceTooltipSide, number> = {
    left: tooltip.width,
    right: tooltip.width,
    top: tooltip.height,
    bottom: tooltip.height,
  };
  const dockSide: Record<Exclude<SourceTooltipDock, "floating">, SourceTooltipSide> = {
    right: "left",
    bottom: "top",
    left: "right",
    top: "bottom",
  };
  // The fixed candidate list is non-empty, so its sorted result has a first side.
  const floatingSides = ["left", "right", "top", "bottom"] as const;
  const floatingSide = floatingSides.toSorted(
    (a, b) => available[b] - required[b] - (available[a] - required[a]),
  )[0] as (typeof floatingSides)[number];
  const side = dock === "floating" ? floatingSide : dockSide[dock];
  const clamp = (value: number, size: number, viewportStart: number, viewportSize: number) =>
    Math.max(
      viewportStart + margin,
      Math.min(
        value,
        Math.max(viewportStart + margin, viewportStart + viewportSize - size - margin),
      ),
    );
  const centeredLeft = (anchor.left + anchor.right - tooltip.width) / 2;
  const centeredTop = (anchor.top + anchor.bottom - tooltip.height) / 2;
  const left =
    side === "left"
      ? panel.left - tooltip.width - gap
      : side === "right"
        ? panel.right + gap
        : centeredLeft;
  const top =
    side === "top"
      ? panel.top - tooltip.height - gap
      : side === "bottom"
        ? panel.bottom + gap
        : centeredTop;
  return {
    left: clamp(left, tooltip.width, viewport.left ?? 0, viewport.width),
    top: clamp(top, tooltip.height, viewport.top ?? 0, viewport.height),
    side,
  };
};

export const resourceTimingByUrl = (
  entries: PerformanceEntry[] = performance.getEntriesByType("resource"),
): Map<string, SourcePanelResourceTiming> => {
  // A page can enlarge the browser's resource timing buffer. Walk backward
  // only until the retained set is full, so an initial panel scan neither
  // copies nor processes an arbitrarily large prefix of obsolete entries.
  const newest: PerformanceResourceTiming[] = [];
  const names = new Set<string>();
  for (
    let index = entries.length - 1;
    index >= 0 && names.size < SOURCE_PANEL_RESOURCE_TIMING_LIMIT;
    index -= 1
  ) {
    const entry = entries[index];
    if (!entry || !isPerformanceResourceTiming(entry) || names.has(entry.name)) continue;
    names.add(entry.name);
    newest.push(entry);
  }
  newest.reverse();
  return mergeResourceTimings(new Map(), newest);
};

export const collectResourceHintSources = (
  timingByUrl: ResourceTimingByUrl,
  element: Element = document.body,
): PageSourceCandidate[] =>
  [...timingByUrl.values()]
    .filter(({ name }) => /\.(?:m3u8|mpd)(?:$|[?#])/i.test(name))
    .flatMap((entry) => {
      const url = absoluteUrl(entry.name);
      return url
        ? [
            {
              url,
              kind: "stream" as const,
              element,
              collectorOriginElements: [],
              bytes: resourceBytes(entry.encodedBodySize, entry.transferSize),
              channel: "resource-hint" as const,
            },
          ]
        : [];
    });

const queryIncludingRoot = <ElementType extends Element>(
  root: ParentNode,
  selector: string,
): ElementType[] => {
  const elements = [...root.querySelectorAll<ElementType>(selector)];
  if (root instanceof Element && root.matches(selector)) elements.unshift(root as ElementType);
  return elements;
};

const isBackgroundCandidateElement = (element: Element): boolean =>
  element.localName === "body" ||
  element.hasAttribute("style") ||
  element.hasAttribute("class") ||
  element.hasAttribute("id");

// Full background scans are chunked across idle callbacks. A TreeWalker keeps
// only its current traversal position, while querySelectorAll plus array spread
// retained a second reference to every classed/id'd element until the scan ended.
export function* iterateBackgroundElements(root: ParentNode = document): IterableIterator<Element> {
  if (root instanceof Element && isBackgroundCandidateElement(root)) yield root;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Element && isBackgroundCandidateElement(node)) yield node;
  }
}

export const collectBackgroundElements = (root: ParentNode = document): Element[] => [
  ...iterateBackgroundElements(root),
];

export const collectBackgroundSourceCandidates = (
  elements: Iterable<Element>,
  timingByUrl: ResourceTimingByUrl = resourceTimingByUrl(),
  payloadBudget: PageSourcePayloadBudget = createPageSourcePayloadBudget(),
  preserveDuplicateOrigins = true,
): PageSourceCandidate[] => {
  const found = createPageSourceCandidateAccumulator(false, preserveDuplicateOrigins);
  const admitUrl = createPageSourceUrlAdmission(payloadBudget);
  for (const element of elements) {
    urlsFromCss(getComputedStyle(element).backgroundImage).forEach((value) => {
      const url = admitUrl(value);
      if (!url) return;
      const timing = timingByUrl.get(url);
      found.add(
        url,
        "image",
        element,
        resourceBytes(timing?.encodedBodySize, timing?.transferSize),
        undefined,
        undefined,
        "background",
      );
    });
  }
  return found.values;
};

export const collectPageSourceCandidates = (
  root: ParentNode = document,
  options: SourcePanelOptions = {},
  timingByUrl: ResourceTimingByUrl = resourceTimingByUrl(),
  payloadBudget: PageSourcePayloadBudget = createPageSourcePayloadBudget(),
  preserveDuplicateOrigins = true,
): PageSourceCandidate[] => {
  const found = createPageSourceCandidateAccumulator(false, preserveDuplicateOrigins);
  const admitUrl = createPageSourceUrlAdmission(payloadBudget);
  const add = (
    value: string | null | undefined,
    kind: PageSourceKind,
    element: Element,
    previewable = true,
    responsive?: PageSource["responsive"],
    channel?: PageSource["channel"],
  ) => {
    const url = admitUrl(value);
    if (url) {
      const timing = timingByUrl.get(url);
      found.add(
        url,
        kind,
        element,
        resourceBytes(timing?.encodedBodySize, timing?.transferSize),
        previewable,
        responsive,
        channel,
      );
    }
  };

  queryIncludingRoot<HTMLImageElement>(root, "img").forEach((element) => {
    const selectedUrl = element.currentSrc ? absoluteUrl(element.currentSrc) : null;
    const fallbackSource = element.getAttribute("src") || element.src;
    const ownCandidates = candidatesFromSrcset(element.getAttribute("srcset") || "");
    const pictureCandidates: SrcsetCandidate[] = [];
    if (element.parentElement?.matches("picture")) {
      for (const sibling of element.parentElement.children) {
        if (sibling === element) break;
        if (sibling instanceof HTMLSourceElement)
          pictureCandidates.push(...candidatesFromSrcset(sibling.getAttribute("srcset") || ""));
      }
    }
    const hasResponsiveCandidates = ownCandidates.length + pictureCandidates.length > 0;
    add(
      element.currentSrc,
      "image",
      element,
      true,
      hasResponsiveCandidates ? { selected: true } : undefined,
    );
    add(
      fallbackSource,
      "image",
      element,
      !selectedUrl || absoluteUrl(fallbackSource) === selectedUrl,
      hasResponsiveCandidates
        ? { selected: !selectedUrl || absoluteUrl(fallbackSource) === selectedUrl }
        : undefined,
    );
    ownCandidates.forEach((candidate) =>
      add(candidate.url, "image", element, absoluteUrl(candidate.url) === selectedUrl, {
        descriptor: candidate.descriptor,
        selected: absoluteUrl(candidate.url) === selectedUrl,
      }),
    );
    pictureCandidates.forEach((candidate) =>
      add(candidate.url, "image", element, absoluteUrl(candidate.url) === selectedUrl, {
        descriptor: candidate.descriptor,
        selected: absoluteUrl(candidate.url) === selectedUrl,
      }),
    );
  });
  queryIncludingRoot<HTMLMediaElement>(root, "video, audio").forEach((element) => {
    const kind = element instanceof HTMLVideoElement ? "video" : "audio";
    const selectedUrl = element.currentSrc ? absoluteUrl(element.currentSrc) : null;
    const fallbackSource = element.getAttribute("src") || element.src;
    add(element.currentSrc, kind, element);
    add(fallbackSource, kind, element, !selectedUrl || absoluteUrl(fallbackSource) === selectedUrl);
    element.querySelectorAll<HTMLSourceElement>("source").forEach((source) => {
      const sourceUrl = source.getAttribute("src") || source.src;
      add(sourceUrl, kind, element, absoluteUrl(sourceUrl) === selectedUrl);
      candidatesFromSrcset(source.getAttribute("srcset") || "").forEach((candidate) =>
        add(candidate.url, kind, element, absoluteUrl(candidate.url) === selectedUrl, {
          descriptor: candidate.descriptor,
          selected: absoluteUrl(candidate.url) === selectedUrl,
        }),
      );
    });
  });
  if (options.includeLinks !== false) {
    queryIncludingRoot<HTMLAnchorElement>(root, "a[href]").forEach((element) => {
      const href = absoluteUrl(element.getAttribute("href") || element.href);
      if (!href) return;
      const path = new URL(href).pathname.toLocaleLowerCase();
      const kind: PageSourceKind = /\.(?:png|jpe?g|gif|webp|svg|avif)$/.test(path)
        ? "image"
        : /\.(?:mp4|webm|mov|mkv)$/.test(path)
          ? "video"
          : /\.(?:mp3|ogg|wav|m4a|flac)$/.test(path)
            ? "audio"
            : /\.(?:m3u8|mpd)$/.test(path)
              ? "stream"
              : path.endsWith(".pdf")
                ? "document"
                : "link";
      add(href, kind, element, true, undefined, "anchor");
    });
  }
  if (options.includeBackgrounds !== false) {
    for (const source of collectBackgroundSourceCandidates(
      iterateBackgroundElements(root),
      timingByUrl,
      payloadBudget,
      preserveDuplicateOrigins,
    )) {
      found.add(
        source.url,
        source.kind,
        source.element,
        source.bytes,
        source.previewable,
        source.responsive,
        source.channel,
        source.collectorOriginElements,
      );
    }
  }
  if (options.resourceHints !== false) {
    for (const source of collectResourceHintSources(timingByUrl)) {
      found.add(
        source.url,
        source.kind,
        source.element,
        source.bytes,
        source.previewable,
        source.responsive,
        source.channel,
        source.collectorOriginElements,
      );
    }
  }

  return found.values;
};

export const collectPageSources = (
  root: ParentNode = document,
  options: SourcePanelOptions = {},
): PageSource[] => {
  return mergePageSourcesByUrl(collectPageSourceCandidates(root, options));
};

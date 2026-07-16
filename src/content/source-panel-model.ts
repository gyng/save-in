import type { UiTheme } from "../config/content-options.ts";
import type { SourcePanelCopy } from "../shared/source-panel-copy.ts";
import type { PageSourceChannel, PageSourceKind } from "../shared/page-source.ts";
import { isStringMember } from "../shared/util.ts";

export type { PageSourceKind, PageSourceChannel } from "../shared/page-source.ts";
export type PageSource = {
  url: string;
  kind: PageSourceKind;
  element: Element;
  // URL-deduplicated panel rows retain every element that discovered the
  // source so DOM-aware routing does not depend on traversal order.
  originElements?: Element[] | undefined;
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

export type ResourceTimingByUrl = ReadonlyMap<string, PerformanceResourceTiming>;

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
  const merged = new Map<string, PageSource>();
  sources.forEach((source) => {
    const existing = merged.get(source.url);
    if (!existing) {
      merged.set(source.url, source);
      return;
    }
    const origins = existing.originElements ?? [existing.element];
    for (const element of source.originElements ?? [source.element]) {
      if (!origins.includes(element)) origins.push(element);
    }
    existing.originElements = origins;
    if (!existing.responsive && source.responsive) existing.responsive = source.responsive;
    else if (existing.responsive && source.responsive) {
      existing.responsive.selected ||= source.responsive.selected;
      existing.responsive.descriptor ||= source.responsive.descriptor;
    }
  });
  return [...merged.values()];
};

const absoluteUrl = (value: string): string | null => {
  try {
    const url = new URL(value, document.baseURI);
    return ["http:", "https:", "ftp:", "data:", "blob:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
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

export const SOURCE_SORTS = [
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

const sourceRelevance = (source: PageSource): number => {
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
  if (source.bytes) score += Math.min(24, Math.log2(source.bytes + 1));
  return score;
};

const compareRelevance = (a: PageSource, b: PageSource): number =>
  sourceRelevance(b) - sourceRelevance(a) ||
  (b.bytes || 0) - (a.bytes || 0) ||
  compareDetection(b, a) ||
  a.url.localeCompare(b.url);

export const sortPageSources = (sources: PageSource[], sort: SourceSort): PageSource[] =>
  [...sources].toSorted((a, b) => {
    if (sort === "detected-asc") return compareDetection(a, b);
    if (sort === "relevance") return compareRelevance(a, b);
    if (sort === "size-desc") return (b.bytes || 0) - (a.bytes || 0);
    if (sort === "name-asc") return a.url.localeCompare(b.url);
    return compareDetection(b, a);
  });

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
  entries: PerformanceResourceTiming[] = performance
    .getEntriesByType("resource")
    .filter(isPerformanceResourceTiming),
): Map<string, PerformanceResourceTiming> => new Map(entries.map((entry) => [entry.name, entry]));

export const collectResourceHintSources = (
  timingByUrl: ResourceTimingByUrl,
  element: Element = document.body,
): PageSource[] =>
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

export const collectBackgroundElements = (root: ParentNode = document): HTMLElement[] =>
  queryIncludingRoot<HTMLElement>(root, "body, [style], [class], [id]");

export const collectBackgroundSourceCandidates = (
  elements: Iterable<HTMLElement>,
  timingByUrl: ResourceTimingByUrl = resourceTimingByUrl(),
): PageSource[] => {
  const found: PageSource[] = [];
  for (const element of elements) {
    urlsFromCss(getComputedStyle(element).backgroundImage).forEach((value) => {
      const url = absoluteUrl(value);
      if (!url) return;
      const timing = timingByUrl.get(url);
      found.push({
        url,
        kind: "image",
        element,
        bytes: resourceBytes(timing?.encodedBodySize, timing?.transferSize),
        channel: "background",
      });
    });
  }
  return found;
};

export const collectPageSourceCandidates = (
  root: ParentNode = document,
  options: SourcePanelOptions = {},
  timingByUrl: ResourceTimingByUrl = resourceTimingByUrl(),
): PageSource[] => {
  const found: PageSource[] = [];
  const add = (
    value: string | null | undefined,
    kind: PageSourceKind,
    element: Element,
    previewable = true,
    responsive?: PageSource["responsive"],
    channel?: PageSource["channel"],
  ) => {
    const url = value && absoluteUrl(value);
    if (url) {
      const timing = timingByUrl.get(url);
      found.push({
        url,
        kind,
        element,
        bytes: resourceBytes(timing?.encodedBodySize, timing?.transferSize),
        previewable,
        responsive,
        channel,
      });
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
    found.push(...collectBackgroundSourceCandidates(collectBackgroundElements(root), timingByUrl));
  }
  if (options.resourceHints !== false) {
    found.push(...collectResourceHintSources(timingByUrl));
  }

  return found;
};

export const collectPageSources = (
  root: ParentNode = document,
  options: SourcePanelOptions = {},
): PageSource[] => {
  return mergePageSourcesByUrl(collectPageSourceCandidates(root, options));
};

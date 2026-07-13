import type { UiTheme } from "../config/content-options.ts";
import type { SourcePanelCopy } from "../shared/source-panel-copy.ts";

export type PageSourceKind = "image" | "video" | "audio" | "stream" | "document" | "link";
export type PageSource = {
  url: string;
  kind: PageSourceKind;
  element: Element;
  bytes?: number | undefined;
  previewable?: boolean | undefined;
  detectedAt?: number | undefined;
  detectedOrder?: number | undefined;
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
};

export type ResourceTimingByUrl = ReadonlyMap<string, PerformanceResourceTiming>;

const urlsFromCss = (value: string): string[] =>
  [...value.matchAll(/url\((?:"([^"]+)"|'([^']+)'|([^)'"\s]+))\)/g)].flatMap((match) => {
    const url = match[1] || match[2] || match[3];
    return url ? [url] : [];
  });

const isAsciiWhitespace = (value: string): boolean => /[\t\n\f\r ]/.test(value);

// Mirrors the URL-token boundaries in the HTML srcset parser. In particular,
// commas inside a non-whitespace URL (such as a data URL) are not separators.
export const urlsFromSrcset = (input: string): string[] => {
  const urls: string[] = [];
  let position = 0;
  while (position < input.length) {
    while (
      position < input.length &&
      (isAsciiWhitespace(input[position]!) || input[position] === ",")
    )
      position += 1;
    if (position >= input.length) break;

    const start = position;
    while (position < input.length && !isAsciiWhitespace(input[position]!)) position += 1;
    let url = input.slice(start, position);
    if (url.endsWith(",")) {
      url = url.replace(/,+$/, "");
      if (url) urls.push(url);
      continue;
    }
    urls.push(url);

    let parentheses = 0;
    while (position < input.length) {
      const character = input[position];
      position += 1;
      if (character === "(") parentheses += 1;
      else if (character === ")" && parentheses > 0) parentheses -= 1;
      else if (character === "," && parentheses === 0) break;
    }
  }
  return urls;
};

const absoluteUrl = (value: string): string | null => {
  try {
    const url = new URL(value, document.baseURI);
    return ["http:", "https:", "ftp:", "data:", "blob:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
};

export const ytDlpCommand = (url: string): string => `yt-dlp "${url.replaceAll('"', '\\"')}"`;
export const formatSourceBytes = (bytes?: number): string => {
  if (!bytes) return "size unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  typeof value === "string" && SOURCE_SORTS.includes(value as SourceSort);
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
  } else if (media instanceof HTMLImageElement) {
    media.alt = "";
  }
  tooltip.append(media);
  return tooltip;
};

export type SourceTooltipDock = "right" | "bottom" | "left" | "top" | "floating";
export type SourceTooltipSide = "left" | "right" | "top" | "bottom";
type SourceTooltipRect = Pick<DOMRectReadOnly, "left" | "top" | "right" | "bottom">;
type SourceTooltipSize = { width: number; height: number };

export const positionDraggedSourcePanel = (
  panel: Pick<DOMRectReadOnly, "left" | "top" | "width" | "height">,
  start: { x: number; y: number },
  current: { x: number; y: number },
  viewport: SourceTooltipSize,
): { left: number; top: number } => {
  const margin = 8;
  const clamp = (value: number, size: number, viewportSize: number) =>
    Math.max(margin, Math.min(value, Math.max(margin, viewportSize - size - margin)));
  return {
    left: clamp(panel.left + current.x - start.x, panel.width, viewport.width),
    top: clamp(panel.top + current.y - start.y, panel.height, viewport.height),
  };
};

export const positionSourceTooltip = (
  anchor: SourceTooltipRect,
  panel: SourceTooltipRect,
  tooltip: SourceTooltipSize,
  viewport: SourceTooltipSize,
  dock: SourceTooltipDock,
): { left: number; top: number; side: SourceTooltipSide } => {
  const gap = 8;
  const margin = 8;
  const available: Record<SourceTooltipSide, number> = {
    left: panel.left - gap - margin,
    right: viewport.width - panel.right - gap - margin,
    top: panel.top - gap - margin,
    bottom: viewport.height - panel.bottom - gap - margin,
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
  const side =
    dock === "floating"
      ? (["left", "right", "top", "bottom"] as const).toSorted(
          (a, b) => available[b] - required[b] - (available[a] - required[a]),
        )[0]!
      : dockSide[dock];
  const clamp = (value: number, size: number, viewportSize: number) =>
    Math.max(margin, Math.min(value, Math.max(margin, viewportSize - size - margin)));
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
    left: clamp(left, tooltip.width, viewport.width),
    top: clamp(top, tooltip.height, viewport.height),
    side,
  };
};

export const resourceTimingByUrl = (
  entries: PerformanceResourceTiming[] = performance.getEntriesByType(
    "resource",
  ) as PerformanceResourceTiming[],
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
              bytes: entry.encodedBodySize || entry.transferSize || undefined,
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
        bytes: timing?.encodedBodySize || timing?.transferSize || undefined,
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
  ) => {
    const url = value && absoluteUrl(value);
    if (url) {
      const timing = timingByUrl.get(url);
      found.push({
        url,
        kind,
        element,
        bytes: timing?.encodedBodySize || timing?.transferSize || undefined,
        previewable,
      });
    }
  };

  queryIncludingRoot<HTMLImageElement>(root, "img").forEach((element) => {
    const selectedUrl = element.currentSrc ? absoluteUrl(element.currentSrc) : null;
    const fallbackSource = element.getAttribute("src") || element.src;
    add(element.currentSrc, "image", element);
    add(
      fallbackSource,
      "image",
      element,
      !selectedUrl || absoluteUrl(fallbackSource) === selectedUrl,
    );
    urlsFromSrcset(element.getAttribute("srcset") || "").forEach((candidate) =>
      add(candidate, "image", element, absoluteUrl(candidate) === selectedUrl),
    );
    if (element.parentElement?.matches("picture")) {
      for (const sibling of element.parentElement.children) {
        if (sibling === element) break;
        if (sibling instanceof HTMLSourceElement) {
          urlsFromSrcset(sibling.getAttribute("srcset") || "").forEach((candidate) =>
            add(candidate, "image", element, absoluteUrl(candidate) === selectedUrl),
          );
        }
      }
    }
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
      urlsFromSrcset(source.getAttribute("srcset") || "").forEach((candidate) =>
        add(candidate, kind, element, absoluteUrl(candidate) === selectedUrl),
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
      add(href, kind, element);
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
  const seen = new Set<string>();
  return collectPageSourceCandidates(root, options).filter(
    ({ url }) => !seen.has(url) && Boolean(seen.add(url)),
  );
};

import type { SourcePanelTheme } from "../config/content-options.ts";

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
  theme?: SourcePanelTheme;
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

export type SourceSort = "detected-desc" | "detected-asc" | "size-desc" | "name-asc";
const compareDetection = (a: PageSource, b: PageSource): number =>
  (a.detectedAt || 0) - (b.detectedAt || 0) || (a.detectedOrder || 0) - (b.detectedOrder || 0);

export const sortPageSources = (sources: PageSource[], sort: SourceSort): PageSource[] =>
  [...sources].toSorted((a, b) => {
    if (sort === "detected-asc") return compareDetection(a, b);
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

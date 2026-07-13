export type PageSourceKind = "image" | "video" | "audio" | "stream" | "document" | "link";
export type PageSource = {
  url: string;
  kind: PageSourceKind;
  element: Element;
  bytes?: number;
  detectedAt?: number;
  detectedOrder?: number;
};
export type SourcePanelOptions = {
  enabled?: boolean;
  includeBackgrounds?: boolean;
  live?: boolean;
  previews?: boolean;
  resourceHints?: boolean;
  includeLinks?: boolean;
  onOpenChange?: (open: boolean) => void;
};

const urlsFromCss = (value: string): string[] =>
  [...value.matchAll(/url\((?:"([^"]+)"|'([^']+)'|([^)'"\s]+))\)/g)].map(
    (match) => match[1] || match[2] || match[3],
  );

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
export const sortPageSources = (sources: PageSource[], sort: SourceSort): PageSource[] =>
  [...sources].toSorted((a, b) => {
    if (sort === "detected-asc") return (a.detectedAt || 0) - (b.detectedAt || 0);
    if (sort === "size-desc") return (b.bytes || 0) - (a.bytes || 0);
    if (sort === "name-asc") return a.url.localeCompare(b.url);
    return (b.detectedAt || 0) - (a.detectedAt || 0);
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

export const collectPageSources = (
  root: ParentNode = document,
  options: SourcePanelOptions = {},
): PageSource[] => {
  const found: PageSource[] = [];
  const resourceEntries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  const timingByUrl = new Map(resourceEntries.map((entry) => [entry.name, entry]));
  const add = (value: string | null | undefined, kind: PageSourceKind, element: Element) => {
    const url = value && absoluteUrl(value);
    if (url) {
      const timing = timingByUrl.get(url);
      found.push({
        url,
        kind,
        element,
        bytes: timing?.encodedBodySize || timing?.transferSize || undefined,
      });
    }
  };

  root.querySelectorAll<HTMLImageElement>("img").forEach((element) => {
    add(element.currentSrc || element.src, "image", element);
    element
      .getAttribute("srcset")
      ?.split(",")
      .forEach((candidate) => add(candidate.trim().split(/\s+/)[0], "image", element));
  });
  root.querySelectorAll<HTMLMediaElement>("video, audio").forEach((element) => {
    const kind = element instanceof HTMLVideoElement ? "video" : "audio";
    add(element.currentSrc || element.src, kind, element);
    element.querySelectorAll<HTMLSourceElement>("source").forEach((source) => {
      add(source.src, kind, element);
      source
        .getAttribute("srcset")
        ?.split(",")
        .forEach((candidate) => add(candidate.trim().split(/\s+/)[0], kind, element));
    });
  });
  if (options.includeLinks !== false) {
    root.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((element) => {
      const path = new URL(element.href, document.baseURI).pathname.toLocaleLowerCase();
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
      add(element.href, kind, element);
    });
  }
  if (options.includeBackgrounds !== false) {
    root.querySelectorAll<HTMLElement>("body, [style], [class], [id]").forEach((element) => {
      urlsFromCss(getComputedStyle(element).backgroundImage).forEach((url) =>
        add(url, "image", element),
      );
    });
  }
  if (options.resourceHints !== false) {
    resourceEntries.forEach((entry) => {
      if (/\.(?:m3u8|mpd)(?:$|[?#])/i.test(entry.name)) add(entry.name, "stream", document.body);
    });
  }

  const seen = new Set<string>();
  return found.filter(({ url }) => !seen.has(url) && Boolean(seen.add(url)));
};

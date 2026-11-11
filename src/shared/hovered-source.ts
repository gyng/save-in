// The content script owns the DOM lookup while the background turns the answer
// into a save. Neither layer may import the other, so their bounded
// request/response contract lives here.
import { boundedImageAltText } from "./context-image.ts";
import { isStringKeyedRecord } from "./util.ts";

export const HOVERED_SOURCE_REQUEST = "SAVE_IN_HOVERED_SOURCE";
export const MAX_HOVERED_SOURCE_URL_LENGTH = 8_192;

const HOVERED_MEDIA_KINDS = ["image", "video", "audio"] as const;
export type HoveredMediaKind = (typeof HOVERED_MEDIA_KINDS)[number];

// Media and link are reported separately, as the browser reports srcUrl and
// linkUrl for a menu click, so the background's own "prefer links" settings
// decide between them instead of the page side.
export type HoveredSource = {
  // `alt` is the image's own alt text, read from the element the page side has
  // in hand, so a command or picker save can name the file by it too.
  media?: { url: string; kind: HoveredMediaKind; alt?: string };
  linkUrl?: string;
};

const isHoveredMediaKind = (value: unknown): value is HoveredMediaKind =>
  HOVERED_MEDIA_KINDS.some((kind) => kind === value);

// The schemes click-to-save accepts for the same elements. A page-owned blob:
// is readable because the save is tied to the tab that answered.
const boundedSourceUrl = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== "string" || !value || value.length > maxLength) {
    return undefined;
  }
  try {
    return ["https:", "http:", "ftp:", "blob:", "data:"].includes(new URL(value).protocol)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
};

export const parseHoveredSource = (
  value: unknown,
  maxUrlLength = MAX_HOVERED_SOURCE_URL_LENGTH,
): HoveredSource | null => {
  if (!isStringKeyedRecord(value)) return null;
  const rawMedia = isStringKeyedRecord(value.media) ? value.media : {};
  const mediaUrl = boundedSourceUrl(rawMedia.url, maxUrlLength);
  const linkUrl = boundedSourceUrl(value.linkUrl, maxUrlLength);
  const alt = rawMedia.kind === "image" ? boundedImageAltText(rawMedia.alt) : undefined;
  const media =
    mediaUrl && isHoveredMediaKind(rawMedia.kind)
      ? { url: mediaUrl, kind: rawMedia.kind, ...(alt ? { alt } : {}) }
      : undefined;
  if (!media && !linkUrl) return null;
  return { ...(media ? { media } : {}), ...(linkUrl ? { linkUrl } : {}) };
};

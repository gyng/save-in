import { isStringMember } from "./util.ts";

export const PAGE_SOURCE_KINDS = ["image", "video", "audio", "stream", "document", "link"] as const;

export type PageSourceKind = (typeof PAGE_SOURCE_KINDS)[number];

export const isPageSourceKind = (value: unknown): value is PageSourceKind =>
  isStringMember(PAGE_SOURCE_KINDS, value);

// The collector's origin for a candidate, distinct from its media kind. A
// candidate embedded directly on the page (img/video/audio) carries no
// channel — that is the pre-4.2 default and keeps old candidates valid.
// Anchor/background/resource-hint candidates are new-in-4.2 channels that the
// automatic scan gates independently of kind (see automation/automatic-routing.ts).
export const PAGE_SOURCE_CHANNELS = ["anchor", "background", "resource-hint"] as const;

export type PageSourceChannel = (typeof PAGE_SOURCE_CHANNELS)[number];

export const isPageSourceChannel = (value: unknown): value is PageSourceChannel =>
  isStringMember(PAGE_SOURCE_CHANNELS, value);

// Classify a URL into a media kind by its path extension alone — the shape-only
// signal both the content DOM scan and the background webRequest collector use
// before any richer metadata exists. Query strings are ignored (pathname only),
// so a token-signed `foo.m3u8?...` still classifies as a stream. Anything that
// is not recognizably media falls through to "link".
export const classifyUrlKind = (url: string): PageSourceKind => {
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return "link";
  }
  if (/\.(?:png|jpe?g|gif|webp|svg|avif)$/.test(path)) return "image";
  if (/\.(?:mp4|webm|mov|mkv)$/.test(path)) return "video";
  if (/\.(?:mp3|ogg|wav|m4a|flac)$/.test(path)) return "audio";
  if (/\.(?:m3u8|mpd)$/.test(path)) return "stream";
  if (path.endsWith(".pdf")) return "document";
  return "link";
};

// A recognized media/stream/document kind is worth surfacing; "link" (scripts,
// XHR JSON, beacons, page navigations) is captured for completeness but not
// shown unless the panel asks for everything.
export const isMediaSourceKind = (kind: PageSourceKind): boolean => kind !== "link";

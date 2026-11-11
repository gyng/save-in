// The content script owns DOM extraction while the background consumes the
// result for menu saves. Neither layer may import the other, so their bounded
// request/response contract lives here.
import { isStringKeyedRecord } from "./util.ts";

export const CONTEXT_IMAGE_REQUEST = "SAVE_IN_CONTEXT_IMAGE";
export const MAX_CONTEXT_IMAGE_URL_LENGTH = 8_192;

// Alt text names files, so it is bounded like the link title and download
// attributes rather than carried at whatever length the page chose.
export const MAX_CONTEXT_IMAGE_ALT_LENGTH = 4_096;

export type ContextImage = { src: string; alt?: string | undefined };

export const boundedImageAltText = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, MAX_CONTEXT_IMAGE_ALT_LENGTH) : undefined;
};

// Only an address the downloads pipeline can fetch on its own: a page-owned
// blob: or an inline data: placeholder is not the image the user pointed at.
export const boundedContextImageUrl = (value: unknown): string | undefined => {
  if (typeof value !== "string" || !value || value.length > MAX_CONTEXT_IMAGE_URL_LENGTH) {
    return undefined;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
};

export const parseContextImage = (value: unknown): ContextImage | null => {
  if (!isStringKeyedRecord(value)) return null;
  const src = boundedContextImageUrl(value.src);
  if (!src) return null;
  const alt = boundedImageAltText(value.alt);
  return { src, ...(alt ? { alt } : {}) };
};

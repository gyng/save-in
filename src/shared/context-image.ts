// The content script owns DOM extraction while the background consumes the
// result for menu saves. Neither layer may import the other, so their bounded
// request/response contract lives here.
import { isStringKeyedRecord } from "./util.ts";

export const CONTEXT_IMAGE_REQUEST = "SAVE_IN_CONTEXT_IMAGE";
export const MAX_CONTEXT_IMAGE_URL_LENGTH = 8_192;

export type ContextImage = { src: string };

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
  return src ? { src } : null;
};

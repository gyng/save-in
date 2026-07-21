// The content script owns DOM extraction while the background consumes the
// result for menu saves. Neither layer may import the other, so their bounded
// request/response contract lives here.
import { isStringKeyedRecord } from "./util.ts";

export const CONTEXT_LINK_METADATA_REQUEST = "SAVE_IN_CONTEXT_LINK_METADATA";
export const MAX_CONTEXT_LINK_URL_LENGTH = 8_192;
export const MAX_CONTEXT_LINK_METADATA_LENGTH = 4_096;

export type ContextLinkMetadata = {
  href: string;
  title?: string | undefined;
  download?: string | undefined;
};

export const boundedContextLinkValue = (value: string | null): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, MAX_CONTEXT_LINK_METADATA_LENGTH) : undefined;
};

export const parseContextLinkMetadata = (
  value: unknown,
  expectedHref: string,
): ContextLinkMetadata | null => {
  if (
    !isStringKeyedRecord(value) ||
    value.href !== expectedHref ||
    expectedHref.length > MAX_CONTEXT_LINK_URL_LENGTH ||
    (value.title !== undefined && typeof value.title !== "string") ||
    (value.download !== undefined && typeof value.download !== "string")
  ) {
    return null;
  }
  const title = boundedContextLinkValue(value.title ?? null);
  const download = boundedContextLinkValue(value.download ?? null);
  return {
    href: expectedHref,
    ...(title ? { title } : {}),
    ...(download ? { download } : {}),
  };
};

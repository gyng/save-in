import { isStringMember } from "./util.ts";

export const PAGE_SOURCE_KINDS = ["image", "video", "audio", "stream", "document", "link"] as const;

export type PageSourceKind = (typeof PAGE_SOURCE_KINDS)[number];

export const isPageSourceKind = (value: unknown): value is PageSourceKind =>
  isStringMember(PAGE_SOURCE_KINDS, value);

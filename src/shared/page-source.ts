export const PAGE_SOURCE_KINDS = ["image", "video", "audio", "stream", "document", "link"] as const;

export type PageSourceKind = (typeof PAGE_SOURCE_KINDS)[number];

export const isPageSourceKind = (value: unknown): value is PageSourceKind =>
  typeof value === "string" && PAGE_SOURCE_KINDS.includes(value as PageSourceKind);

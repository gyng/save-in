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

import { RULE_TYPES } from "../shared/constants.ts";
import type { ContentFetchResult } from "../shared/content-fetch-types.ts";
import type { LazyDownloadMetadata } from "../shared/lazy-download-metadata.ts";

export type RoutingContent = ContentFetchResult;

export type RoutingDownloadInfo = LazyDownloadMetadata<RoutingContent> & {
  currentTab?: { title?: string | undefined; incognito?: boolean | undefined } | null | undefined;
  frameUrl?: string | undefined;
  linkText?: string | undefined;
  mediaType?: string | undefined;
  mime?: string | undefined;
  mimeExtension?: string | undefined;
  now?: Date | undefined;
  pageUrl?: string | undefined;
  referrerUrl?: string | undefined;
  selectionText?: string | undefined;
  sourceUrl?: string | undefined;
  url?: string | undefined;
  suggestedFilename?: string | null | undefined;
  context?: string | undefined;
  menuIndex?: string | null | undefined;
  menuItemId?: string | undefined;
  menuItemTitle?: string | undefined;
  menuItemPath?: string | undefined;
  comment?: string | null | undefined;
  modifiers?: string[] | undefined;
  filename?: string | undefined;
  naiveFilename?: string | undefined;
  initialFilename?: string | undefined;
  preview?: boolean | undefined;
  resolvedFilename?: string | undefined;
  counter?: number | undefined;
  abortSignal?: AbortSignal | undefined;
  onContentFetchStart?: ((requestId: string) => void | Promise<void>) | undefined;
  contentFetchDisabled?: boolean | undefined;
};

export type RuleErrorLocation = {
  start: number;
  end: number;
  line: number;
  column: number;
};

export type RuleError = {
  message: string;
  error: string;
  warning?: boolean;
  location?: RuleErrorLocation;
};
export type MatcherResult = RegExpMatchArray | null | false;
export type RoutingInfo = Omit<RoutingDownloadInfo, "currentTab"> & {
  currentTab?: unknown;
  srcUrl?: string | undefined;
  linkUrl?: string | undefined;
};
export type RuleMatcher = (info: RoutingInfo, metadata?: Partial<RoutingInfo>) => MatcherResult;
export type MatcherFactory = (regex: RegExp) => RuleMatcher;
export type MatcherClause = {
  name: string;
  value: RegExp;
  type: typeof RULE_TYPES.MATCHER;
  matcher: RuleMatcher;
};
export type CaptureClause = {
  name: "capture" | "capturegroups";
  value: string;
  type: typeof RULE_TYPES.CAPTURE;
};
export type DestinationClause = {
  name: "into";
  value: string;
  type: typeof RULE_TYPES.DESTINATION;
};
export type RuleClause = MatcherClause | CaptureClause | DestinationClause;

declare const validatedRoutingRule: unique symbol;
export type RoutingRule = RuleClause[] & { readonly [validatedRoutingRule]: true };

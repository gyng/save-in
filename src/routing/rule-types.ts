import { RULE_TYPES } from "../shared/constants.ts";
import type { ContentFetchResult } from "../shared/content-fetch-types.ts";
import type { LazyDownloadMetadata } from "../shared/lazy-download-metadata.ts";
import type { PageSourceKind } from "../shared/page-source.ts";
import type { ClickGesture } from "../shared/click-gesture.ts";
import type { ROUTING_ACTION_VALUES } from "./action-values.ts";

export type RoutingContent = ContentFetchResult;

export type RoutingDownloadInfo = LazyDownloadMetadata<RoutingContent> & {
  currentTab?: { title?: string | undefined; incognito?: boolean | undefined } | null | undefined;
  frameUrl?: string | undefined;
  linkText?: string | undefined;
  linkTitle?: string | undefined;
  linkDownload?: string | undefined;
  mediaType?: string | undefined;
  sourceKind?: PageSourceKind | undefined;
  mime?: string | undefined;
  mimeExtension?: string | undefined;
  now?: Date | undefined;
  pageUrl?: string | undefined;
  referrerUrl?: string | undefined;
  selectionText?: string | undefined;
  selectedUrl?: string | undefined;
  webhookEligible?: boolean | undefined;
  forcePrompt?: boolean | undefined;
  suppressPrompt?: boolean | undefined;
  routingDisabled?: boolean | undefined;
  sourceUrl?: string | undefined;
  url?: string | undefined;
  suggestedFilename?: string | null | undefined;
  context?: string | undefined;
  gesture?: ClickGesture | undefined;
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
  counterPromise?: Promise<number> | undefined;
  abortSignal?: AbortSignal | undefined;
  onContentFetchStart?: ((requestId: string) => void | Promise<void>) | undefined;
  contentFetchDisabled?: boolean | undefined;
  matchedCssSelectorsByOrigin?: string[][] | undefined;
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
export type MatcherAttemptStatus = "matched" | "not-matched" | "missing" | "invalid";
export type MatcherAttempt = {
  source: string;
  value: string | null;
  status: MatcherAttemptStatus;
  matchedText?: string | undefined;
  captures?: Array<string | null> | undefined;
};
export type MatcherEvaluation = {
  result: MatcherResult;
  attempts: MatcherAttempt[];
};
export type RoutingInfo = Omit<RoutingDownloadInfo, "currentTab"> & {
  currentTab?: unknown;
  srcUrl?: string | undefined;
  linkUrl?: string | undefined;
};
export type RuleMatcher = {
  (info: RoutingInfo, metadata?: Partial<RoutingInfo>): MatcherResult;
  explain?: (info: RoutingInfo, metadata?: Partial<RoutingInfo>) => MatcherEvaluation;
};
export type MatcherFactory = (regex: RegExp) => RuleMatcher;
export type RegexMatcherClause = {
  name: string;
  value: RegExp;
  type: typeof RULE_TYPES.MATCHER;
  matcher: RuleMatcher;
};
export type CssMatcherClause = {
  name: "css";
  value: string;
  type: typeof RULE_TYPES.MATCHER;
  matcher: RuleMatcher;
};
export type MatcherClause = RegexMatcherClause | CssMatcherClause;

export const isCssMatcherClause = (clause: MatcherClause): clause is CssMatcherClause =>
  clause.name === "css";

export const isRegexMatcherClause = (clause: MatcherClause): clause is RegexMatcherClause =>
  !isCssMatcherClause(clause);
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
export type FetchClause = {
  name: "fetch";
  value: string;
  type: typeof RULE_TYPES.FETCH;
};
export type RenameClause = {
  name: "rename";
  // Raw clause value ("find -> replacement"); find compiles with the clause
  // flags, replacement stays a literal template until captures and variables
  // expand in the download pipeline.
  value: string;
  find: RegExp;
  replacement: string;
  type: typeof RULE_TYPES.RENAME;
};
export type ExcludeClause = {
  name: "exclude";
  value: (typeof ROUTING_ACTION_VALUES)["exclude"];
  type: typeof RULE_TYPES.ACTION;
};
export type TabActionClause = {
  name: "after";
  value: (typeof ROUTING_ACTION_VALUES)["after"];
  type: typeof RULE_TYPES.ACTION;
};
export type RoutingActionClause = ExcludeClause | TabActionClause;
export type RuleClause =
  | MatcherClause
  | CaptureClause
  | DestinationClause
  | FetchClause
  | RenameClause
  | RoutingActionClause;

declare const parsedRoutingRule: unique symbol;
export type RoutingRule = RuleClause[] & { readonly [parsedRoutingRule]: true };

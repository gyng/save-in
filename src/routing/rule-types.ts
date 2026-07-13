import type { RuleType } from "../shared/constants.ts";

export type RoutingContent = {
  sha256: string;
  downloadUrl: string;
  ownedObjectUrl?: string;
};

export type RoutingDownloadInfo = {
  currentTab?: { title?: string } | null;
  linkText?: string;
  now?: Date;
  pageUrl?: string;
  selectionText?: string;
  sourceUrl?: string;
  url?: string;
  suggestedFilename?: string | null;
  context?: string;
  menuIndex?: string | null;
  comment?: string | null;
  modifiers?: string[];
  legacyDownloadInfo?: unknown;
  filename?: string;
  naiveFilename?: string;
  initialFilename?: string;
  preview?: boolean;
  counter?: number;
  headPromise?: Promise<{ contentType: string; finalUrl: string }>;
  resolvedHead?: { contentType: string; finalUrl: string };
  contentPromise?: Promise<RoutingContent | null>;
  sha256?: string;
};

export type RuleError = { message: string; error: string; warning?: boolean };
export type RuleToken = RegExpMatchArray;
export type MatcherResult = RegExpMatchArray | null | false;
export type RoutingInfo = Omit<RoutingDownloadInfo, "currentTab"> & {
  currentTab?: unknown;
  srcUrl?: string;
  linkUrl?: string;
  frameUrl?: string;
  mediaType?: string;
};
export type RuleMatcher = (info: RoutingInfo, metadata?: Partial<RoutingInfo>) => MatcherResult;
export type MatcherFactory = (regex: RegExp) => RuleMatcher;
export type RuleClause = {
  name: string;
  value: string | RegExp;
  type: RuleType;
  matcher?: RuleMatcher;
};
export type RoutingRule = RuleClause[];

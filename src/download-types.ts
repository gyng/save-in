import type { ContentFetchResult } from "./content-fetch-types.ts";
import type { CurrentTab } from "./current-tab.ts";

export type PathValue = {
  finalize: () => string;
  toString: () => string;
};

export type DownloadInfo = {
  currentTab?: CurrentTab | null;
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
  contentPromise?: Promise<ContentFetchResult | null>;
};

export type DownloadPipelineState = {
  path: PathValue;
  scratch: {
    hasExtension?: boolean | RegExpMatchArray | "" | null;
    mimeExtension?: string;
    [key: string]: unknown;
  };
  info: DownloadInfo;
  needRouteMatch?: boolean;
  route?: PathValue;
  routeIsFolder?: boolean;
};

export type DownloadPlan = {
  state: DownloadPipelineState;
  finalFullPath: string;
  prompt: boolean;
  historyEntryId: string;
};

export type AcquiredDownload = {
  url: string;
  viaFetch: boolean;
};

export type FinalizableDownloadState = Pick<DownloadPipelineState, "path" | "info"> &
  Partial<Pick<DownloadPipelineState, "scratch" | "route" | "routeIsFolder">>;

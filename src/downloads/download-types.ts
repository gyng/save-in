import type { CurrentTab } from "../platform/current-tab.ts";
import type { LazyDownloadMetadata } from "../shared/lazy-download-metadata.ts";
import type { RoutingDownloadInfo } from "../routing/rule-types.ts";

export type PathValue = {
  finalize: () => string;
  toString: () => string;
};

export type DownloadInfo = LazyDownloadMetadata &
  Omit<RoutingDownloadInfo, keyof LazyDownloadMetadata | "currentTab"> & {
    currentTab?: CurrentTab | null | undefined;
  };

export type DownloadPipelineState = {
  path: PathValue;
  scratch: {
    hasExtension?: boolean | RegExpMatchArray | "" | null;
    mimeExtension?: string;
    historyEntryId?: string | null | undefined;
    [key: string]: unknown;
  };
  info: DownloadInfo;
  needRouteMatch?: boolean | undefined;
  route?: PathValue | undefined;
  routeIsFolder?: boolean | undefined;
};

export type DownloadPlan = {
  state: DownloadPipelineState;
  finalFullPath: string;
  prompt: boolean;
  historyEntryId: string | null;
};

export type AcquiredDownload = {
  url: string;
  source: "direct" | "fetched" | "fetch-fallback-direct";
  ownedObjectUrl?: string | undefined;
};

export type DownloadExecutionResult =
  | { status: "started"; downloadId: number }
  | { status: "failed" };

export type DownloadLaunchResult = DownloadExecutionResult | { status: "skipped" };

export type FinalizableDownloadState = Pick<DownloadPipelineState, "path" | "info"> &
  Partial<Pick<DownloadPipelineState, "scratch" | "route" | "routeIsFolder">>;

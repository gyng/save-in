import type { CurrentTab } from "../platform/current-tab.ts";
import type { LazyDownloadMetadata } from "../shared/lazy-download-metadata.ts";
import type { RenameTransform } from "../routing/rename.ts";
import type { RoutingDownloadInfo } from "../routing/rule-types.ts";

export type PathValue = {
  finalize: (options?: {
    finalComponentIsFilename?: boolean;
    transformFinalComponent?: (value: string) => string;
  }) => string;
  toString: () => string;
};

export type DownloadInfo = LazyDownloadMetadata &
  Omit<RoutingDownloadInfo, keyof LazyDownloadMetadata | "currentTab"> & {
    currentTab?: CurrentTab | null | undefined;
  };

export type SourceSidecarRequest = {
  sourceUrl: string;
  title?: string | undefined;
  pageUrl?: string | undefined;
  menuItemId?: string | undefined;
  menuItemTitle?: string | undefined;
};

export type DownloadScratch = {
  hasExtension?: boolean | RegExpMatchArray | "" | null | undefined;
  mimeExtension?: string | undefined;
  pathTemplateRaw?: string | undefined;
  routeTemplateRaw?: string | undefined;
  fetchTemplateRaw?: string | undefined;
  routeOutcome?: "exclude" | undefined;
  routeTabAction?: "close" | undefined;
  routeTabActionHandled?: boolean | undefined;
  routeTabActionSuppressed?: boolean | undefined;
  // Capture-substituted rename transform of the matched rule (variables still
  // unexpanded), and the same transform with its replacement expanded against
  // this download — the value finalizeFullPath applies synchronously.
  renameTemplate?: RenameTransform | undefined;
  renameResolved?: RenameTransform | undefined;
  historyEntryId?: string | null | undefined;
  browserFilenameResolution?: boolean | undefined;
  deferredRouteRequirement?: boolean | undefined;
  sourceSidecar?: SourceSidecarRequest | undefined;
};

export type DownloadPipelineState = {
  path: PathValue;
  scratch: DownloadScratch;
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
  offscreenRequestId?: string | undefined;
};

export type DownloadExecutionResult =
  | { status: "started"; downloadId: number }
  | { status: "skipped" }
  | { status: "failed" };

export type DownloadLaunchResult = DownloadExecutionResult | { status: "skipped" };

export type FinalizableDownloadState = Pick<DownloadPipelineState, "path" | "info"> &
  Partial<Pick<DownloadPipelineState, "scratch" | "route" | "routeIsFolder">>;

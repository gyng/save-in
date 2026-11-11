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
    frameId?: number | undefined;
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
  // Capture-substituted rename transform of the matched rule (variables still
  // unexpanded), and the same transform with its replacement expanded against
  // this download — the value finalizeFullPath applies synchronously.
  renameTemplate?: RenameTransform | undefined;
  renameResolved?: RenameTransform | undefined;
  historyEntryId?: string | null | undefined;
  browserFilenameResolution?: boolean | undefined;
  deferredRouteRequirement?: boolean | undefined;
  deferredRoutingResolution?: true | undefined;
  sourceSidecar?: SourceSidecarRequest | undefined;
  // suggestedFilename was derived from the fetched resource, not supplied by
  // the page, so a fetch: rewrite must not carry it to the new URL.
  syntheticSuggestedFilename?: true | undefined;
  // Click-to-save inherited both its folder and its comment/menuindex from the
  // previous menu save. The plan clears this unless the winning rule matched on
  // that inherited metadata, so it survives a re-plan of a persisted template.
  keepInheritedFolder?: true | undefined;
  // This save deliberately repeats one History already holds (a History
  // re-route downloads the entry's own address again), so the saved-source
  // check must not decline it.
  repeatsSavedSource?: true | undefined;
  // The plan declined this save because History already holds its address.
  savedSourceSkipped?: true | undefined;
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
  // Firefox's emulated Ask: the Save As dialog for a file known to exist.
  askAboutExistingFile?: true | undefined;
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

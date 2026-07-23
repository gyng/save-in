// Small guards and cleanup helpers over DownloadPipelineState shared by
// download.ts, download-plan.ts, and download-execution.ts. Kept dependency-
// free of those three modules so none of them has to import another to reach
// this file (the import graph must stay acyclic).
import { DOWNLOAD_TYPES } from "../shared/constants.ts";
import { OffscreenClient } from "../platform/offscreen-client.ts";
import { downloadPorts } from "./ports.ts";
import type { DownloadPipelineState } from "./download-types.ts";

const logPort = downloadPorts.log;

export const requireDownloadUrl = (state: Pick<DownloadPipelineState, "info">): string => {
  if (!state.info.url) throw new Error("Download URL is required");
  return state.info.url;
};

export const isSourceSidecar = (state: Pick<DownloadPipelineState, "info">): boolean =>
  state.info.context === DOWNLOAD_TYPES.SIDECAR;

export const isPrivateDownloadState = (state: Pick<DownloadPipelineState, "info">): boolean =>
  state.info.currentTab?.incognito === true;

// Chrome can accept the browser download before final-filename routing has
// accepted it. Callers may perform post-start effects only after both routing
// rejection signals have cleared.
export const isRoutingAccepted = (state: Pick<DownloadPipelineState, "scratch">): boolean =>
  state.scratch.routeOutcome !== "exclude" && state.scratch.deferredRouteRequirement !== true;

export const addDownloadLog = (
  state: Pick<DownloadPipelineState, "info">,
  message: string,
  data?: unknown,
): unknown =>
  isPrivateDownloadState(state)
    ? logPort.add(message, data, { privateContext: true })
    : logPort.add(message, data);

export const isHttpDownloadUrl = (value: string): boolean => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
};

const abortError = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException("The operation was aborted", "AbortError");

export const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw abortError(signal);
};

// A fetch: rewrite or a route miss discards any content already prepared
// (fetched bytes, an offscreen hash request) for the state's original URL.
export const releaseUnusedContent = async (state: DownloadPipelineState): Promise<void> => {
  const contentPromise = state.info.contentPromise;
  state.info.contentPromise = undefined;
  if (!contentPromise) return;
  try {
    const content = await contentPromise;
    if (content?.ownedObjectUrl && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(content.ownedObjectUrl);
    }
    if (content?.offscreenRequestId) await OffscreenClient.release(content.offscreenRequestId);
  } catch {
    // The pipeline's original error remains authoritative.
  }
};

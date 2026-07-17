import { downloadPorts } from "./ports.ts";
import { downloadRuntime } from "./download-runtime-instance.ts";
import { retryViaFetch as runRetryViaFetch } from "./download-retry.ts";
import { cancelExpectedDownload, expectDownload, reportDownloadFailure } from "./notification.ts";
import {
  enqueueFilename,
  registerFilenameAndObjectUrlListeners,
  removeFilename,
} from "./filename-listener.ts";
import { BrowserDownloadRouting, routeBrowserDownload } from "./browser-downloads.ts";
import { getRoutingMatches, resolveRenameTransform } from "./download-plan.ts";
import { finalizeFullPath } from "./download-disposition.ts";
import { renameAndDownload } from "./download-execution.ts";
import { addDownloadLog, isSourceSidecar } from "./download-pipeline-state.ts";
import { historyDisplayUrl } from "../shared/data-url.ts";
import type { DownloadPipelineState, DownloadLaunchResult } from "./download-types.ts";

const logPort = downloadPorts.log;

// Automatic fallback chain: a browser-initiated download that failed with
// a network/server error is retried once through a background fetch. Resolves
// true when a retry was started. Downloads that attached native request
// headers opt out because extension fetch cannot replay arbitrary headers;
// DNR Referer protection alone is re-derived for the retry fetch.
export const retryViaFetch = (downloadId: number): Promise<boolean> =>
  runRetryViaFetch(
    downloadRuntime,
    { notifier: { expectDownload, cancelExpectedDownload }, log: logPort },
    downloadId,
    enqueueFilename,
    removeFilename,
  );

export const makeObjectUrl = (content: string, mime = "text/plain"): string => {
  if (typeof URL.createObjectURL === "function") {
    const objectUrl = URL.createObjectURL(
      new Blob([content], {
        type: `${mime};charset=utf-8`,
      }),
    );
    downloadRuntime.generatedObjectUrls.add(objectUrl);
    return objectUrl;
  }

  // MV3 service workers have no URL.createObjectURL: use a data URL
  const bytes = new TextEncoder().encode(content);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${mime};charset=utf-8;base64,${btoa(binary)}`;
};

// Single entry point for firing a download from a menu/message click:
// fire-and-forget (renameAndDownload is async) but with one place that both
// logs and surfaces a terminal pipeline failure to the user. Callers still
// Browser-attempt ownership is registered later, immediately around
// downloads.download(), so planning failures cannot leak an expectation.
export const launchDownload = (state: DownloadPipelineState): Promise<DownloadLaunchResult> =>
  renameAndDownload(state).catch((e) => {
    addDownloadLog(state, "renameAndDownload failed", String(e));
    // An automatic data: save has no suggestedFilename, so the URL fallback
    // would otherwise interpolate the multi-kilobyte payload into the failure
    // notification title; historyDisplayUrl truncates data: URLs (http(s) stay
    // whole).
    const name = state.info.suggestedFilename || historyDisplayUrl(state.info.url) || "";
    if (!isSourceSidecar(state)) reportDownloadFailure(name, String(e));
    return { status: "failed" as const };
  });

// MV3 (Chrome): entry.background calls this synchronously at startup so the
// onDeterminingFilename listener is attached before any download event fires.
export const registerDownloadListener = () => {
  BrowserDownloadRouting.route = (item) =>
    routeBrowserDownload({ getRoutingMatches, resolveRenameTransform, finalizeFullPath }, item);
  registerFilenameAndObjectUrlListeners({
    ...downloadRuntime,
    retryViaFetch,
    getRoutingMatches,
    resolveRenameTransform,
    finalizeFullPath,
  });
};

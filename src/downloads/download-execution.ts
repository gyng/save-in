import { webExtensionApi } from "../platform/web-extension-api.ts";
import { getMessage } from "../platform/localization.ts";

import { getDownload, mergeDownload } from "./download-state.ts";
import type { DownloadRecordUpdate } from "./download-state.ts";
import { downloadsState, sessionWriteState } from "./download-state-instances.ts";
import { DOWNLOAD_TYPES } from "../shared/constants.ts";
import { normalizeSessionCounter, updateSession } from "../shared/session-state.ts";
import { getDownloadHeaders, getFetchReferer } from "./headers.ts";
import {
  cancelExpectedDownload,
  createExtensionNotification,
  EXTENSION_NOTIFICATION_STREAMS,
  expectDownload,
  reportDownloadFailure,
} from "./notification.ts";
import { options } from "../config/options-data.ts";
import { downloadPorts } from "./ports.ts";
import { WEB_EXTENSION_CAPABILITIES } from "../platform/chrome-detector.ts";
import { fetchUrlForDownload } from "./content-fetch.ts";
import { OffscreenClient } from "../platform/offscreen-client.ts";
import {
  DEFERRED_ROUTES_SESSION_KEY,
  FINAL_FILENAMES_SESSION_KEY,
  PENDING_DOWNLOADS_SESSION_KEY,
} from "../shared/storage-keys.ts";
import { emitDownloaded } from "./download-events.ts";
import { extensionSessionStorage } from "../platform/storage-areas.ts";
import type {
  AcquiredDownload,
  DownloadPipelineState,
  DownloadPlan,
  DownloadExecutionResult,
  DownloadLaunchResult,
} from "./download-types.ts";
import { downloadRuntime } from "./download-runtime-instance.ts";
import { resolveDownloadPlan } from "./download-plan.ts";
import { ensureHistoryEntry } from "./history-entry.ts";
import {
  addDownloadLog,
  isHttpDownloadUrl,
  isPrivateDownloadState,
  isSourceSidecar,
  releaseUnusedContent,
  requireDownloadUrl,
  throwIfAborted,
} from "./download-pipeline-state.ts";
import {
  createDeferredRouteRecovery,
  enqueueFilename,
  enqueueDeferredRoute,
  removeDeferredRoute,
  removeFilename,
  type FinalFilenameMap,
} from "./filename-listener.ts";
import { resolveFirefoxDownloadContext } from "./auth-context.ts";
import {
  finishActiveTransfer,
  holdTransferKeepalive,
  registerActiveTransfer,
  releaseTransferKeepalive,
  updateActiveTransfer,
} from "./active-transfers.ts";
import { deliverSaveWebhook } from "./webhook-delivery.ts";

const logPort = downloadPorts.log;
const historyPort = downloadPorts.history;
const backgroundRuntime = downloadPorts.runtime;

// The per-download record (retry + history info) lives in DownloadState, keyed
// by downloadId, mirrored to storage.session so it survives an MV3 worker
// restart. These stay as thin seams because notification.js and the tests use
// them.
export const rememberStartedDownload = (downloadId: number, partial: DownloadRecordUpdate) =>
  mergeDownload(downloadsState, sessionWriteState, extensionSessionStorage, downloadId, partial);

export const getStartedDownload = (downloadId: number) =>
  getDownload(downloadsState, extensionSessionStorage, downloadId);

const releaseAcquiredDownload = async (acquired: AcquiredDownload): Promise<void> => {
  if (acquired.ownedObjectUrl && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(acquired.ownedObjectUrl);
  }
  if (acquired.offscreenRequestId) {
    await OffscreenClient.release(acquired.offscreenRequestId).catch(() => {});
  }
};

const recordDownloadRequest = (plan: DownloadPlan): void => {
  const { state } = plan;
  const privateContext = isPrivateDownloadState(state);
  if (!privateContext) {
    logPort.add("download requested", {
      url: state.info.url && String(state.info.url).slice(0, 200),
      path: plan.finalFullPath,
      route: state.route
        ? String(state.route.finalize({ finalComponentIsFilename: !state.routeIsFolder }))
        : null,
    });
  }
  if (backgroundRuntime.debug && !privateContext) console.log(state, plan.finalFullPath); // eslint-disable-line

  if (!privateContext && !isSourceSidecar(state)) {
    emitDownloaded(state);
    backgroundRuntime.lastDownloadState = state;
  }
};

export const acquireFetchedUrl = async (
  url: string,
  privateContext = false,
  signal?: AbortSignal,
  requestId?: string,
  referer?: string,
): Promise<AcquiredDownload> => {
  const usingOffscreen = OffscreenClient.canUse();
  try {
    const content = await fetchUrlForDownload(url, privateContext, signal, requestId, referer);
    return {
      url: content.downloadUrl,
      source: "fetched",
      ownedObjectUrl: content.ownedObjectUrl,
      offscreenRequestId: content.offscreenRequestId,
    };
  } catch (e) {
    if (signal?.aborted) throw e;
    if (privateContext) {
      logPort.add(usingOffscreen ? "offscreen fetch failed" : "fetch download failed", String(e), {
        privateContext: true,
      });
    } else
      logPort.add(usingOffscreen ? "offscreen fetch failed" : "fetch download failed", String(e));
    return { url, source: "fetch-fallback-direct" };
  }
};

export const acquireDownloadUrl = async (
  plan: DownloadPlan,
  signal?: AbortSignal,
  requestId?: string,
): Promise<AcquiredDownload> => {
  const { state } = plan;
  throwIfAborted(signal);
  if (state.info.contentPromise) {
    const content = await state.info.contentPromise;
    if (content && content.downloadUrl) {
      state.info.contentPromise = undefined;
      return {
        url: content.downloadUrl,
        source: "fetched",
        ownedObjectUrl: content.ownedObjectUrl,
        offscreenRequestId: content.offscreenRequestId,
      };
    }
    if (content?.ownedObjectUrl && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(content.ownedObjectUrl);
    }
    state.info.contentPromise = undefined;
  }
  const url = requireDownloadUrl(state);
  const fetchReferer = state.info.protectedFetchReferer ?? getFetchReferer(state);
  if (fetchReferer && !WEB_EXTENSION_CAPABILITIES.downloadRequestHeaders) {
    return acquireFetchedUrl(url, isPrivateDownloadState(state), signal, requestId, fetchReferer);
  }
  if (options.fetchViaFetch && !getDownloadHeaders(state))
    return acquireFetchedUrl(url, isPrivateDownloadState(state), signal, requestId);
  const ownedObjectUrl = downloadRuntime.generatedObjectUrls.delete(url) ? url : undefined;
  return { url, source: "direct", ownedObjectUrl };
};

export const executeBrowserDownload = async (
  plan: DownloadPlan,
  acquired: AcquiredDownload,
  signal?: AbortSignal,
): Promise<DownloadExecutionResult> => {
  const { state, finalFullPath, prompt, historyEntryId } = plan;
  const privateContext = state.info.currentTab?.incognito === true;
  const pendingSourceSidecar = !prompt && !privateContext ? state.scratch.sourceSidecar : undefined;
  void historyPort.patch(historyEntryId, {
    mechanism: acquired.source === "fetched" ? "fetch-downloads-api" : "downloads-api",
  });
  const filename = finalFullPath || "_";
  const headers =
    acquired.source === "direct" || acquired.source === "fetch-fallback-direct"
      ? getDownloadHeaders(state)
      : undefined;
  const allowOriginalUrlFallback = !headers && isHttpDownloadUrl(requireDownloadUrl(state));
  const deferredRouteRecovery = state.scratch.deferredRouteRequirement
    ? createDeferredRouteRecovery(state)
    : undefined;
  throwIfAborted(signal);
  await Promise.all(
    privateContext
      ? []
      : [
          updateSession<number>(
            sessionWriteState,
            extensionSessionStorage,
            PENDING_DOWNLOADS_SESSION_KEY,
            (n) => normalizeSessionCounter(n) + 1,
          ),
          updateSession<FinalFilenameMap>(
            sessionWriteState,
            extensionSessionStorage,
            FINAL_FILENAMES_SESSION_KEY,
            (m) => enqueueFilename(m, acquired.url, filename),
          ),
          ...(deferredRouteRecovery
            ? [
                updateSession(
                  sessionWriteState,
                  extensionSessionStorage,
                  DEFERRED_ROUTES_SESSION_KEY,
                  (map) => enqueueDeferredRoute(map, acquired.url, deferredRouteRecovery),
                ),
              ]
            : []),
        ],
  );

  const expected = expectDownload(acquired.url, {
    url: state.info.url,
    pageUrl: state.info.pageUrl,
    filename,
    conflictAction: options.conflictAction,
    viaFetch: acquired.source === "fetched",
    retried: false,
    allowOriginalUrlFallback,
    ...(historyEntryId ? { historyEntryId } : {}),
    ...(isSourceSidecar(state) ? { sourceSidecar: true } : {}),
    ...(pendingSourceSidecar ? { pendingSourceSidecar } : {}),
    privateContext,
  });
  try {
    if (acquired.url !== state.info.url) downloadRuntime.movePendingState(state, acquired.url);
    const browserFilenameResolution =
      WEB_EXTENSION_CAPABILITIES.downloadFilenameSuggestion &&
      acquired.source === "direct" &&
      isHttpDownloadUrl(acquired.url);
    state.scratch.browserFilenameResolution = browserFilenameResolution;
    const downloadOptions: Parameters<typeof webExtensionApi.downloads.download>[0] = {
      url: acquired.url,
      saveAs: prompt,
      conflictAction: options.conflictAction,
    };
    // An explicit Chrome downloads.download filename suppresses the server's
    // Content-Disposition name before onDeterminingFilename can route it.
    if (!browserFilenameResolution) downloadOptions.filename = filename;
    if (headers) downloadOptions.headers = headers;
    Object.assign(downloadOptions, await resolveFirefoxDownloadContext(state.info.currentTab));
    throwIfAborted(signal);
    const downloadId = await webExtensionApi.downloads.download(downloadOptions);
    cancelExpectedDownload(expected);
    if (acquired.ownedObjectUrl) {
      downloadRuntime.ownedObjectUrls.set(downloadId, acquired.ownedObjectUrl);
    }
    const browserFilename = downloadRuntime.finalFilenamesByDownloadId.get(downloadId);
    downloadRuntime.finalFilenamesByDownloadId.delete(downloadId);
    await rememberStartedDownload(downloadId, {
      url: state.info.url,
      pageUrl: state.info.pageUrl,
      filename: browserFilename || filename,
      conflictAction: options.conflictAction,
      viaFetch: acquired.source === "fetched",
      retried: false,
      allowOriginalUrlFallback,
      ...(acquired.offscreenRequestId ? { offscreenRequestId: acquired.offscreenRequestId } : {}),
      ...(historyEntryId ? { historyEntryId } : {}),
      ...(isSourceSidecar(state) ? { sourceSidecar: true } : {}),
      ...(pendingSourceSidecar ? { pendingSourceSidecar } : {}),
      privateContext,
      adopted: true,
    });
    if (historyEntryId) {
      updateActiveTransfer(historyEntryId, { downloadId });
      await historyPort.setDownloadId(historyEntryId, downloadId);
    }
    if (signal?.aborted) {
      await webExtensionApi.downloads.cancel(downloadId).catch(() => {});
      await historyPort.setStatus(historyEntryId, "USER_CANCELED", downloadId);
      return { status: "skipped" };
    }
    return { status: "started", downloadId };
  } catch (e) {
    cancelExpectedDownload(expected);
    await releaseAcquiredDownload(acquired);
    if (signal?.aborted) {
      downloadRuntime.forgetPendingState(state);
      await historyPort.setStatus(historyEntryId, "USER_CANCELED");
      return { status: "skipped" };
    }
    addDownloadLog(state, "downloads.download failed", String(e));
    if (
      acquired.source === "direct" &&
      allowOriginalUrlFallback &&
      options.fallbackFetch !== false
    ) {
      const fallback = await acquireFetchedUrl(requireDownloadUrl(state), privateContext, signal);
      return await executeBrowserDownload(plan, fallback, signal);
    } else {
      downloadRuntime.forgetPendingState(state);
      await historyPort.setStatus(historyEntryId, "DOWNLOAD_API_FAILED");
      if (!isSourceSidecar(state)) {
        reportDownloadFailure(finalFullPath || requireDownloadUrl(state), String(e));
      }
      return { status: "failed" };
    }
  } finally {
    await Promise.all(
      privateContext
        ? []
        : [
            updateSession<number>(
              sessionWriteState,
              extensionSessionStorage,
              PENDING_DOWNLOADS_SESSION_KEY,
              (n) => Math.max(0, normalizeSessionCounter(n) - 1),
            ),
            updateSession<FinalFilenameMap>(
              sessionWriteState,
              extensionSessionStorage,
              FINAL_FILENAMES_SESSION_KEY,
              (m) => removeFilename(m, acquired.url, filename),
            ),
            ...(deferredRouteRecovery
              ? [
                  updateSession(
                    sessionWriteState,
                    extensionSessionStorage,
                    DEFERRED_ROUTES_SESSION_KEY,
                    (map) => removeDeferredRoute(map, acquired.url, deferredRouteRecovery.id),
                  ),
                ]
              : []),
          ],
    );
  }
};

// async because applyVariables may await a
// :counter:/:mime: transformer). Callers fire-and-forget, so awaiting the
// path/route interpolation here before the download is safe.
export const renameAndDownload = async (
  state: DownloadPipelineState,
): Promise<DownloadLaunchResult> => {
  const preparationController = new AbortController();
  state.info.abortSignal = preparationController.signal;
  let registeredHistoryId: string | null | undefined;
  let privateHeld = false;
  let activeRequestId: string | undefined;
  const registerTransfer = (requestId?: string) => {
    activeRequestId = requestId ?? activeRequestId;
    const id = state.scratch.historyEntryId;
    if (id) {
      registeredHistoryId = id;
      registerActiveTransfer(
        id,
        preparationController,
        activeRequestId ? { requestId: activeRequestId } : {},
      );
    } else if (!privateHeld) {
      holdTransferKeepalive(preparationController);
      privateHeld = true;
    }
  };
  state.info.onContentFetchStart = (requestId) => {
    ensureHistoryEntry(
      state,
      /* v8 ignore next -- Pipeline preparation always resolves a filename before fetching. */
      state.info.filename ?? state.info.suggestedFilename ?? state.info.url ?? "",
    );
    registerTransfer(requestId);
    // Make an open options page render the cancellable preparation row.
    emitDownloaded(state);
  };
  const finishPreparation = () => {
    if (registeredHistoryId) finishActiveTransfer(registeredHistoryId, preparationController);
    if (privateHeld) releaseTransferKeepalive(preparationController);
    state.info.abortSignal = undefined;
    state.info.onContentFetchStart = undefined;
  };
  let plan: DownloadPlan | null;
  try {
    plan = await resolveDownloadPlan(state);
  } catch (error) {
    downloadRuntime.forgetPendingState(state);
    await releaseUnusedContent(state);
    const url = state.info.url;
    if (url && downloadRuntime.generatedObjectUrls.delete(url)) URL.revokeObjectURL(url);
    if (preparationController.signal.aborted) {
      await historyPort.setStatus(state.scratch.historyEntryId, "USER_CANCELED");
      finishPreparation();
      return { status: "skipped" };
    }
    await historyPort.setStatus(state.scratch.historyEntryId, "DOWNLOAD_PREPARATION_FAILED");
    finishPreparation();
    throw error;
  }
  if (!plan) {
    await releaseUnusedContent(state);
    const url = state.info.url;
    if (url && downloadRuntime.generatedObjectUrls.delete(url)) URL.revokeObjectURL(url);
    await historyPort.setStatus(state.scratch.historyEntryId, "RULE_NO_MATCH");
    finishPreparation();
    if ((state.needRouteMatch || options.routeSkipUnmatched) && options.notifyOnFailure) {
      createExtensionNotification(
        getMessage("notificationRuleMatchFailedExclusiveTitle"),
        getMessage("notificationRuleMatchFailedExclusiveMessage", [requireDownloadUrl(state)]),
        true,
        EXTENSION_NOTIFICATION_STREAMS.ROUTE_MISS,
      );
    }
    return { status: "skipped" };
  }

  registerTransfer();
  recordDownloadRequest(plan);
  let acquired: AcquiredDownload;
  try {
    acquired = await acquireDownloadUrl(plan, preparationController.signal, activeRequestId);
  } catch (error) {
    downloadRuntime.forgetPendingState(state);
    await releaseUnusedContent(state);
    const url = state.info.url;
    if (url && downloadRuntime.generatedObjectUrls.delete(url)) URL.revokeObjectURL(url);
    if (preparationController.signal.aborted) {
      await historyPort.setStatus(plan.historyEntryId, "USER_CANCELED");
      finishPreparation();
      return { status: "skipped" };
    }
    await historyPort.setStatus(plan.historyEntryId, "DOWNLOAD_PREPARATION_FAILED");
    addDownloadLog(state, "download preparation failed", String(error));
    if (!isSourceSidecar(state)) {
      reportDownloadFailure(plan.finalFullPath || requireDownloadUrl(state), String(error));
    }
    finishPreparation();
    return { status: "failed" };
  }
  const result = await executeBrowserDownload(plan, acquired, preparationController.signal);
  finishPreparation();
  if (result.status !== "started") return result;

  // Webhooks are an optional side effect of the user's save command. They
  // never change, delay, or retry the browser download that already started.
  void deliverSaveWebhook(options, plan, logPort);

  // Trigger notifications
  if (state.route) {
    if (options.notifyOnRuleMatch && state.info.context !== DOWNLOAD_TYPES.AUTO) {
      createExtensionNotification(
        getMessage("notificationRuleMatchedTitle"),
        `${state.info.initialFilename}\n⬇\n${state.route}`,
        false,
        EXTENSION_NOTIFICATION_STREAMS.ROUTE_MATCH,
      );
    }
  }
  return result;
};

import { webExtensionApi } from "../platform/web-extension-api.ts";
import { getMessage } from "../platform/localization.ts";

import { getDownload, mergeDownload } from "./download-state.ts";
import { backfillDownloadStartTime } from "./undo-download.ts";
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
import { options, shouldPersistActivity } from "../config/options-data.ts";
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
import { beginAnonymousPrivateDownloadGuard } from "./private-download-guard.ts";
import { ensureHistoryEntry } from "./history-entry.ts";
import { historyDisplayUrl, isDataUrl, truncateDataUrlForDisplay } from "../shared/data-url.ts";
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

const RETAINED_DOWNLOAD_STRING_LIMIT = 8_192;

const compactRetainedString = (value: string): string => {
  if (isDataUrl(value)) return truncateDataUrlForDisplay(value);
  return value.length > RETAINED_DOWNLOAD_STRING_LIMIT
    ? `${value.slice(0, RETAINED_DOWNLOAD_STRING_LIMIT)}…`
    : value;
};

// The latest-download preview and click-to-save fallback need values, not the
// live pipeline object. Snapshotting breaks references to promises, abort
// controllers, callbacks, and selector attestations; string caps keep one
// page-controlled selection or URL from becoming permanent background RSS.
const retainedDownloadSnapshot = (state: DownloadPipelineState): DownloadPipelineState => {
  const info = { ...state.info };
  delete info.headPromise;
  delete info.contentPromise;
  delete info.counterPromise;
  delete info.abortSignal;
  delete info.onContentFetchStart;
  delete info.matchedCssSelectorsByOrigin;
  for (const [key, value] of Object.entries(info)) {
    if (typeof value === "string") Reflect.set(info, key, compactRetainedString(value));
  }
  if (info.currentTab) {
    info.currentTab = { ...info.currentTab };
    if (typeof info.currentTab.title === "string") {
      info.currentTab.title = compactRetainedString(info.currentTab.title);
    }
    if (typeof info.currentTab.url === "string") {
      info.currentTab.url = compactRetainedString(info.currentTab.url);
    }
  }
  if (info.resolvedHead) {
    info.resolvedHead = {
      contentType: compactRetainedString(info.resolvedHead.contentType),
      finalUrl: compactRetainedString(info.resolvedHead.finalUrl),
      ...(info.resolvedHead.contentDisposition
        ? { contentDisposition: compactRetainedString(info.resolvedHead.contentDisposition) }
        : {}),
    };
  }
  if (info.modifiers) info.modifiers = info.modifiers.slice(0, 16);
  return {
    path: state.path,
    scratch: {},
    info,
    ...(state.route ? { route: state.route } : {}),
    ...(state.routeIsFolder !== undefined ? { routeIsFolder: state.routeIsFolder } : {}),
  };
};

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
  if (shouldPersistActivity(privateContext)) {
    logPort.add("download requested", {
      url: historyDisplayUrl(state.info.url)?.slice(0, 200),
      path: plan.finalFullPath,
      route: state.route
        ? String(state.route.finalize({ finalComponentIsFilename: !state.routeIsFolder }))
        : null,
    });
  }
  if (backgroundRuntime.debug && !privateContext) {
    const dataUrl = [state.info.url, state.info.sourceUrl, state.info.selectedUrl].find(
      (value) => typeof value === "string" && isDataUrl(value),
    );
    // Debug consoles retain object graphs. Never hand a page-controlled data:
    // payload (or a path/capture derived from it) to DevTools.
    if (dataUrl) {
      console.log({ context: state.info.context, url: truncateDataUrlForDisplay(dataUrl) }); // eslint-disable-line
    } else {
      console.log(state, plan.finalFullPath); // eslint-disable-line
    }
  }

  if (shouldPersistActivity(privateContext) && !isSourceSidecar(state)) {
    emitDownloaded(state);
    backgroundRuntime.lastDownloadState = retainedDownloadSnapshot(state);
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
  // Firefox's downloads.download rejects data: URLs — its shortcut/object-URL
  // path never hands the API a data: URL either — so convert to a blob object
  // URL first. The Firefox event page has URL.createObjectURL; Chrome's worker
  // does not and its downloads.download accepts data: directly, so Chrome keeps
  // the direct path below. The bytes are self-contained (data: fetch is local:
  // no network, referer, or DNR rule).
  if (isDataUrl(url) && typeof URL.createObjectURL === "function") {
    // A data: fetch is local and effectively instant, so it needs no abort
    // signal; cancellation is already checked before and after acquisition.
    const blob = await (await fetch(url)).blob();
    const objectUrl = URL.createObjectURL(blob);
    return { url: objectUrl, source: "direct", ownedObjectUrl: objectUrl };
  }
  // An object URL this extension generated (a shortcut or a saved selection)
  // is already local, self-contained bytes it owns — like data: above, there
  // is no network, referer or DNR rule involved. Handing it to a fetch path
  // would copy it into a second blob, download the copy, and strand the
  // original in generatedObjectUrls: unrevoked, and unreachable by the revoke
  // sites that only run on a plan failure or route miss. Taking ownership here
  // keeps every generated URL on the direct path that releases it.
  const ownedObjectUrl = downloadRuntime.generatedObjectUrls.delete(url) ? url : undefined;
  if (!ownedObjectUrl) {
    const fetchReferer = state.info.protectedFetchReferer ?? getFetchReferer(state);
    if (fetchReferer && !WEB_EXTENSION_CAPABILITIES.downloadRequestHeaders) {
      return acquireFetchedUrl(url, isPrivateDownloadState(state), signal, requestId, fetchReferer);
    }
    if (options.fetchViaFetch && !getDownloadHeaders(state))
      return acquireFetchedUrl(url, isPrivateDownloadState(state), signal, requestId);
  }
  return { url, source: "direct", ownedObjectUrl };
};

export const executeBrowserDownload = async (
  plan: DownloadPlan,
  acquired: AcquiredDownload,
  signal?: AbortSignal,
): Promise<DownloadExecutionResult> => {
  const { state, finalFullPath, prompt, historyEntryId } = plan;
  const privateContext = state.info.currentTab?.incognito === true;
  const persistActivity = shouldPersistActivity(privateContext);
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
  // data: is the payload, not a compact identifier. It already receives an
  // explicit downloads.download filename and cannot use HTTP retry, so the
  // restart filename map gains nothing by persisting it as a multi-MiB key.
  const persistFilenameKey = !isDataUrl(acquired.url);
  throwIfAborted(signal);
  await Promise.all(
    persistActivity
      ? [
          updateSession<number>(
            sessionWriteState,
            extensionSessionStorage,
            PENDING_DOWNLOADS_SESSION_KEY,
            (n) => normalizeSessionCounter(n) + 1,
          ),
          ...(persistFilenameKey
            ? [
                updateSession<FinalFilenameMap>(
                  sessionWriteState,
                  extensionSessionStorage,
                  FINAL_FILENAMES_SESSION_KEY,
                  (m) => enqueueFilename(m, acquired.url, filename),
                ),
              ]
            : []),
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
        ]
      : [],
  );
  const releasePrivateDownloadGuard = await beginAnonymousPrivateDownloadGuard(privateContext);

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
      // Answered here, where the tab and the save command are still in reach.
      // The completion path has neither, and must not have to guess.
      webhookEligible: state.info.webhookEligible === true && privateContext !== true,
      privateContext,
      adopted: true,
    });
    if (historyEntryId) {
      updateActiveTransfer(historyEntryId, { downloadId });
      // This bind only publishes the bare id early so the options page can
      // poll progress; onDownloadCreated supplies the item's startTime from
      // the event payload, and a same-id bind without a time never clobbers
      // one already captured. The event path can lose its race against
      // cancelExpectedDownload, so the anchor is backfilled off the hot path.
      await historyPort.setDownloadId(historyEntryId, downloadId);
      backfillDownloadStartTime(historyEntryId, downloadId, historyPort.anchorStartTime);
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
        reportDownloadFailure(
          finalFullPath || truncateDataUrlForDisplay(requireDownloadUrl(state)),
          String(e),
        );
      }
      return { status: "failed" };
    }
  } finally {
    await Promise.all([
      ...(persistActivity
        ? [
            updateSession<number>(
              sessionWriteState,
              extensionSessionStorage,
              PENDING_DOWNLOADS_SESSION_KEY,
              (n) => Math.max(0, normalizeSessionCounter(n) - 1),
            ),
            ...(persistFilenameKey
              ? [
                  updateSession<FinalFilenameMap>(
                    sessionWriteState,
                    extensionSessionStorage,
                    FINAL_FILENAMES_SESSION_KEY,
                    (m) => removeFilename(m, acquired.url, filename),
                  ),
                ]
              : []),
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
          ]
        : []),
      ...(releasePrivateDownloadGuard ? [releasePrivateDownloadGuard()] : []),
    ]);
  }
};

// Both of renameAndDownload's containment paths report a terminal failure the
// same way: name the routed destination, or the URL itself when routing never
// produced one. A sidecar stays silent — the user asked for the primary save,
// and its own failure is reported separately.
const reportPreparationFailure = (plan: DownloadPlan, error: unknown): void => {
  if (isSourceSidecar(plan.state)) return;
  reportDownloadFailure(
    plan.finalFullPath || truncateDataUrlForDisplay(requireDownloadUrl(plan.state)),
    String(error),
  );
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
    ensureHistoryEntry(state, state.info.filename as string);
    registerTransfer(requestId);
    // Make an open options page render the cancellable preparation row.
    // An isolated private save has no History row, so emitting its wire state
    // would expose a payload with nothing to render. The explicit persistence
    // opt-in admits both the row and this matching live update.
    if (shouldPersistActivity(isPrivateDownloadState(state))) emitDownloaded(state);
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
        getMessage("notificationRuleMatchFailedExclusiveMessage", [
          truncateDataUrlForDisplay(requireDownloadUrl(state)),
        ]),
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
    reportPreparationFailure(plan, error);
    finishPreparation();
    return { status: "failed" };
  }
  // executeBrowserDownload contains its own failures only from the point it
  // has registered the expectation. A throw before that — an abort landing
  // between acquisition and browser setup, or a rejected session write — would
  // otherwise escape renameAndDownload with the preparation never finished,
  // stranding the cancellable row, its keepalive and the acquired object URL,
  // and turning the user's own cancel into a failure notification.
  let result: DownloadExecutionResult;
  try {
    result = await executeBrowserDownload(plan, acquired, preparationController.signal);
  } catch (error) {
    downloadRuntime.forgetPendingState(state);
    await releaseAcquiredDownload(acquired);
    if (preparationController.signal.aborted) {
      await historyPort.setStatus(plan.historyEntryId, "USER_CANCELED");
      finishPreparation();
      return { status: "skipped" };
    }
    await historyPort.setStatus(plan.historyEntryId, "DOWNLOAD_API_FAILED");
    addDownloadLog(state, "download execution failed", String(error));
    reportPreparationFailure(plan, error);
    finishPreparation();
    return { status: "failed" };
  }
  finishPreparation();
  if (result.status !== "started") return result;

  // Webhooks are an optional side effect of the user's save command. They
  // never change, delay, or retry the browser download that already started.
  // The id is the browser's, so every later event about this download can be
  // joined to this one.
  void deliverSaveWebhook(options, plan, result.downloadId, logPort);

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

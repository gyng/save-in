import { downloadsState, sessionWriteState } from "./download-state-instances.ts";
import { getSession, updateSession } from "../shared/session-state.ts";
import { options } from "../config/options-data.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";
import { WEB_EXTENSION_CAPABILITIES } from "../platform/chrome-detector.ts";
import { extensionSessionStorage } from "../platform/storage-areas.ts";
import { Path } from "../routing/path.ts";
import { isRenameTransform, type RenameTransform } from "../routing/rename.ts";
import { applyVariables, mimeToExtension, resolveMime } from "../routing/variable.ts";
import { EXTENSION_REGEX } from "../routing/filename.ts";
import { mergeDownload } from "./download-state.ts";
import { downloadPorts } from "./ports.ts";
import {
  isOrdinaryBrowserDownload,
  matchesBrowserDownloadFilter,
  routeBrowserDownload,
} from "./browser-downloads.ts";
import type { DownloadRuntimeState } from "./download-runtime-state.ts";
import type { DownloadPipelineState } from "./download-types.ts";
import {
  DEFERRED_ROUTES_SESSION_KEY,
  FINAL_FILENAMES_SESSION_KEY,
} from "../shared/storage-keys.ts";
import { getMessage } from "../platform/localization.ts";
import { createExtensionNotification, EXTENSION_NOTIFICATION_STREAMS } from "./notification.ts";
import { isWireDownloadState, type WireDownloadState } from "../shared/message-protocol.ts";
import { fromWireDownloadState, toWireDownloadState } from "./wire-state.ts";
import { isStringKeyedRecord } from "../shared/util.ts";
import { historyDisplayUrl } from "../shared/data-url.ts";

const historyPort = downloadPorts.history;
const logPort = downloadPorts.log;
const backgroundRuntime = downloadPorts.runtime;

const resolveFinalMimeExtension = async (state: DownloadPipelineState): Promise<void> => {
  const patterns = Array.isArray(options.filenamePatterns) ? options.filenamePatterns : [];
  const usesActualFileExtension = patterns.some((rule) =>
    rule.some((clause) => clause.name === "actualfileext"),
  );
  if (
    options.appendMimeExtension === false ||
    !usesActualFileExtension ||
    EXTENSION_REGEX.test(state.info.filename || "")
  ) {
    return;
  }
  const extension = state.info.mimeExtension || mimeToExtension(await resolveMime(state.info));
  if (extension) {
    state.info.mimeExtension = extension;
    state.scratch.mimeExtension = extension;
  }
};

export type FinalFilenameMap = Record<string, string | string[]>;

export type DeferredRouteRecovery = {
  version: 1;
  id: string;
  state: WireDownloadState;
  pathTemplateRaw?: string | undefined;
  routeTemplateRaw?: string | undefined;
  renameTemplate?: RenameTransform | undefined;
  mimeExtension?: string | undefined;
  historyEntryId?: string | undefined;
};

export type DeferredRouteMap = Record<string, DeferredRouteRecovery | DeferredRouteRecovery[]>;

const normalizeDeferredRoute = (value: unknown): DeferredRouteRecovery | null => {
  if (!isStringKeyedRecord(value)) return null;
  const candidate = value;
  const state = candidate.state;
  if (candidate.version !== 1 || typeof candidate.id !== "string" || !isWireDownloadState(state)) {
    return null;
  }
  return {
    version: 1,
    id: candidate.id,
    state,
    ...(typeof candidate.pathTemplateRaw === "string"
      ? { pathTemplateRaw: candidate.pathTemplateRaw }
      : {}),
    ...(typeof candidate.routeTemplateRaw === "string"
      ? { routeTemplateRaw: candidate.routeTemplateRaw }
      : {}),
    ...(isRenameTransform(candidate.renameTemplate)
      ? { renameTemplate: candidate.renameTemplate }
      : {}),
    ...(typeof candidate.mimeExtension === "string"
      ? { mimeExtension: candidate.mimeExtension }
      : {}),
    ...(typeof candidate.historyEntryId === "string"
      ? { historyEntryId: candidate.historyEntryId }
      : {}),
  };
};

const deferredRouteQueue = (value: unknown): DeferredRouteRecovery[] =>
  (Array.isArray(value) ? value : [value])
    .map(normalizeDeferredRoute)
    .filter((entry): entry is DeferredRouteRecovery => entry !== null);

const safeDeferredRouteMap = (value: unknown): DeferredRouteMap => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return {};
  const entries: Array<[string, DeferredRouteRecovery | DeferredRouteRecovery[]]> = [];
  for (const [url, stored] of Object.entries(value)) {
    const queue = deferredRouteQueue(stored);
    const first = queue[0];
    if (first) entries.push([url, queue.length === 1 ? first : queue]);
  }
  return Object.fromEntries(entries);
};

export const createDeferredRouteRecovery = (
  state: DownloadPipelineState,
): DeferredRouteRecovery => ({
  version: 1,
  id: `${Date.now()}-${Math.random()}`,
  state: toWireDownloadState(state),
  ...(state.scratch.pathTemplateRaw ? { pathTemplateRaw: state.scratch.pathTemplateRaw } : {}),
  ...(state.scratch.routeTemplateRaw ? { routeTemplateRaw: state.scratch.routeTemplateRaw } : {}),
  ...(state.scratch.renameTemplate ? { renameTemplate: state.scratch.renameTemplate } : {}),
  ...(state.scratch.mimeExtension ? { mimeExtension: state.scratch.mimeExtension } : {}),
  ...(state.scratch.historyEntryId ? { historyEntryId: state.scratch.historyEntryId } : {}),
});

export const enqueueDeferredRoute = (
  map: unknown,
  url: string,
  recovery: DeferredRouteRecovery,
): DeferredRouteMap => {
  const safeMap = safeDeferredRouteMap(map);
  const queue = [...deferredRouteQueue(safeMap[url]), recovery];
  return { ...safeMap, [url]: queue.length === 1 ? recovery : queue };
};

export const removeDeferredRoute = (map: unknown, url: string, id?: string): DeferredRouteMap => {
  const copy = { ...safeDeferredRouteMap(map) };
  const queue = deferredRouteQueue(copy[url]);
  const index = id == null ? 0 : queue.findIndex((entry) => entry.id === id);
  if (index >= 0) queue.splice(index, 1);
  const first = queue[0];
  if (first) copy[url] = queue.length === 1 ? first : queue;
  else delete copy[url];
  return copy;
};

const restoreDeferredRoute = (recovery: DeferredRouteRecovery): DownloadPipelineState => {
  const { info } = fromWireDownloadState(recovery.state);
  if (recovery.mimeExtension) info.mimeExtension = recovery.mimeExtension;
  const pathTemplateRaw = recovery.pathTemplateRaw || recovery.state.path || "";
  return {
    path: new Path(pathTemplateRaw),
    info,
    needRouteMatch: true,
    scratch: {
      deferredRouteRequirement: true,
      pathTemplateRaw,
      ...(recovery.routeTemplateRaw ? { routeTemplateRaw: recovery.routeTemplateRaw } : {}),
      ...(recovery.renameTemplate ? { renameTemplate: recovery.renameTemplate } : {}),
      ...(recovery.mimeExtension ? { mimeExtension: recovery.mimeExtension } : {}),
      ...(recovery.historyEntryId ? { historyEntryId: recovery.historyEntryId } : {}),
    },
  };
};

export const filenameQueue = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string"
      ? [value]
      : [];

const safeFilenameMap = (value: unknown): FinalFilenameMap => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return {};
  const entries: Array<[string, string | string[]]> = [];
  for (const [url, stored] of Object.entries(value)) {
    const queue = filenameQueue(stored);
    const first = queue[0];
    if (first !== undefined) entries.push([url, queue.length === 1 ? first : queue]);
  }
  return Object.fromEntries(entries);
};

export const enqueueFilename = (map: unknown, url: string, filename: string): FinalFilenameMap => {
  const safeMap = safeFilenameMap(map);
  const queue = [...filenameQueue(safeMap[url]), filename];
  const first = queue[0];
  return { ...safeMap, [url]: queue.length === 1 && first !== undefined ? first : queue };
};

export const removeFilename = (map: unknown, url: string, filename?: string): FinalFilenameMap => {
  const copy = { ...safeFilenameMap(map) };
  const queue = filenameQueue(copy[url]);
  const index = filename == null ? 0 : queue.indexOf(filename);
  if (index >= 0) queue.splice(index, 1);
  const first = queue[0];
  if (first !== undefined) copy[url] = queue.length === 1 ? first : queue;
  else delete copy[url];
  return copy;
};

type FilenameDownload = DownloadRuntimeState & {
  retryViaFetch(downloadId: number): Promise<boolean>;
  getRoutingMatches(state: DownloadPipelineState): string | null | undefined;
  resolveRenameTransform(state: DownloadPipelineState): Promise<void>;
  finalizeFullPath(state: DownloadPipelineState): string;
};

const rememberFilename = (downloadId: number, filename: string, privateContext = false) =>
  mergeDownload(downloadsState, sessionWriteState, extensionSessionStorage, downloadId, {
    filename,
    privateContext,
  });

export const registerFilenameAndObjectUrlListeners = (Download: FilenameDownload): void => {
  webExtensionApi.downloads?.onChanged?.addListener((delta) => {
    if (delta.state?.current !== "complete" && !delta.error) return;
    const objectUrl = Download.ownedObjectUrls.get(delta.id);
    if (!objectUrl) return;
    Download.ownedObjectUrls.delete(delta.id);
    URL.revokeObjectURL(objectUrl);
  });
  if (!WEB_EXTENSION_CAPABILITIES.downloadFilenameSuggestion) return;

  chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
    const pendingUrl = Download.pendingStates.has(downloadItem.url)
      ? downloadItem.url
      : Download.pendingStates.has(downloadItem.finalUrl)
        ? downloadItem.finalUrl
        : undefined;
    const pendingQueue = pendingUrl ? Download.pendingStates.get(pendingUrl) : undefined;
    const initiatedBySaveIn = webExtensionApi.runtime?.id === downloadItem.byExtensionId;
    const initiatedByPage = !downloadItem.byExtensionId && Boolean(pendingQueue);
    if (!initiatedBySaveIn && !initiatedByPage) {
      if (!isOrdinaryBrowserDownload(downloadItem, webExtensionApi.runtime?.id)) return false;
      if (downloadItem.incognito) {
        suggest();
        return false;
      }
      void (async () => {
        if (backgroundRuntime.ready) await backgroundRuntime.ready.catch(() => {});
        const url = downloadItem.finalUrl || downloadItem.url;
        if (
          !options.routeBrowserDownloads ||
          !matchesBrowserDownloadFilter(
            url,
            options.browserDownloadFilter,
            options.browserDownloadExcludeFilter,
            options.browserDownloadFiltersEnabled,
          )
        ) {
          suggest();
          return;
        }
        const filename = await routeBrowserDownload(Download, downloadItem);
        suggest(filename ? { filename, conflictAction: options.conflictAction } : undefined);
      })().catch((error) => {
        logPort.add("browser download routing failed", String(error));
        suggest();
      });
      return true;
    }

    const retryFilename = Download.pendingRetryFilenames.get(downloadItem.url);
    if (retryFilename) {
      Download.pendingRetryFilenames.delete(downloadItem.url);
      void updateSession<FinalFilenameMap>(
        sessionWriteState,
        extensionSessionStorage,
        FINAL_FILENAMES_SESSION_KEY,
        (map) => removeFilename(map, downloadItem.url, retryFilename),
      ).catch((error) => logPort.add("retry filename cleanup failed", String(error)));
      suggest({ filename: retryFilename, conflictAction: options.conflictAction });
      return false;
    }

    const rejectDeferredRoute = async (state: DownloadPipelineState): Promise<void> => {
      suggest();
      if (typeof downloadItem.id === "number") {
        await webExtensionApi.downloads.cancel(downloadItem.id).catch(() => {});
        await historyPort
          .setStatus(state.scratch?.historyEntryId, "RULE_NO_MATCH", downloadItem.id)
          .catch((error) => logPort.add("route-miss history update failed", String(error)));
      }
      if (options.notifyOnFailure) {
        createExtensionNotification(
          getMessage("notificationRuleMatchFailedExclusiveTitle"),
          getMessage("notificationRuleMatchFailedExclusiveMessage", [
            historyDisplayUrl(state.info.url) ?? "",
          ]),
          true,
          EXTENSION_NOTIFICATION_STREAMS.ROUTE_MISS,
        );
      }
    };

    const rememberResolvedFilename = (state: DownloadPipelineState, filename: string): void => {
      if (typeof downloadItem.id === "number") {
        Download.finalFilenamesByDownloadId.set(downloadItem.id, filename);
        void rememberFilename(downloadItem.id, filename, state.info.currentTab?.incognito === true);
      }
      const historyEntryId = state.scratch?.historyEntryId;
      if (typeof historyEntryId === "string") {
        void historyPort.patch(historyEntryId, { finalFullPath: filename });
      }
    };

    const pendingState = pendingQueue?.shift();
    if (pendingUrl && pendingQueue?.length === 0) Download.pendingStates.delete(pendingUrl);

    if (!pendingState || !pendingState.path) {
      void (async () => {
        if (backgroundRuntime.ready) await backgroundRuntime.ready.catch(() => {});
        const [filenameResult, deferredResult] = await Promise.all([
          getSession(extensionSessionStorage, FINAL_FILENAMES_SESSION_KEY),
          getSession(extensionSessionStorage, DEFERRED_ROUTES_SESSION_KEY),
        ]);
        const map = safeFilenameMap(filenameResult[FINAL_FILENAMES_SESSION_KEY]);
        const deferredMap = safeDeferredRouteMap(deferredResult[DEFERRED_ROUTES_SESSION_KEY]);
        const urls = [downloadItem.url, downloadItem.finalUrl].filter(
          (url): url is string => typeof url === "string" && Boolean(url),
        );
        const recoveredUrl = urls.find((url) => Boolean(map[url]));
        const deferredUrl = urls.find((url) => Boolean(deferredMap[url]));
        const recovered = recoveredUrl ? filenameQueue(map[recoveredUrl])[0] : undefined;
        const recovery = deferredUrl ? deferredRouteQueue(deferredMap[deferredUrl])[0] : undefined;

        if (recovery && deferredUrl) {
          const recoveredState = restoreDeferredRoute(recovery);
          recoveredState.info.filename =
            downloadItem.filename ||
            recoveredState.info.suggestedFilename ||
            recoveredState.info.filename;
          try {
            await resolveFinalMimeExtension(recoveredState);
            const pathTemplateRaw = recoveredState.scratch.pathTemplateRaw || "";
            recoveredState.path = await applyVariables(
              new Path(pathTemplateRaw),
              recoveredState.info,
            );
            const routeMatches =
              recoveredState.scratch.routeTemplateRaw ?? Download.getRoutingMatches(recoveredState);
            if (!routeMatches) {
              await rejectDeferredRoute(recoveredState);
              return;
            }
            recoveredState.routeIsFolder = /\/\s*$/.test(routeMatches);
            recoveredState.route = await applyVariables(
              new Path(routeMatches),
              recoveredState.info,
            );
            await Download.resolveRenameTransform(recoveredState);
            recoveredState.scratch.deferredRouteRequirement = false;
            const filename = Download.finalizeFullPath(recoveredState);
            rememberResolvedFilename(recoveredState, filename);
            suggest({ filename, conflictAction: options.conflictAction });
          } catch (error) {
            logPort.add("deferred route recovery failed", String(error));
            await rejectDeferredRoute(recoveredState);
          } finally {
            await Promise.all([
              updateSession<FinalFilenameMap>(
                sessionWriteState,
                extensionSessionStorage,
                FINAL_FILENAMES_SESSION_KEY,
                (stored) =>
                  recoveredUrl
                    ? removeFilename(stored, recoveredUrl, recovered)
                    : safeFilenameMap(stored),
              ),
              updateSession<DeferredRouteMap>(
                sessionWriteState,
                extensionSessionStorage,
                DEFERRED_ROUTES_SESSION_KEY,
                (stored) => removeDeferredRoute(stored, deferredUrl, recovery.id),
              ),
            ]).catch((error) =>
              logPort.add("deferred route recovery cleanup failed", String(error)),
            );
          }
          return;
        }

        if (initiatedBySaveIn && options.routeSkipUnmatched) {
          await rejectDeferredRoute({
            path: new Path(""),
            scratch: {},
            info: {
              url: downloadItem.finalUrl || downloadItem.url,
              filename: downloadItem.filename,
              currentTab: downloadItem.incognito ? { incognito: true } : null,
            },
          });
          if (recoveredUrl) {
            await updateSession<FinalFilenameMap>(
              sessionWriteState,
              extensionSessionStorage,
              FINAL_FILENAMES_SESSION_KEY,
              (stored) => removeFilename(stored, recoveredUrl, recovered),
            );
          }
          return;
        }

        if (!recovered || !recoveredUrl) {
          suggest();
          return;
        }
        if (typeof downloadItem.id === "number") {
          Download.finalFilenamesByDownloadId.set(downloadItem.id, recovered);
          void rememberFilename(downloadItem.id, recovered);
        }
        await updateSession<FinalFilenameMap>(
          sessionWriteState,
          extensionSessionStorage,
          FINAL_FILENAMES_SESSION_KEY,
          (stored) => removeFilename(stored, recoveredUrl, recovered),
        );
        suggest({ filename: recovered, conflictAction: options.conflictAction });
      })().catch((error) => {
        logPort.add("filename recovery failed", String(error));
        suggest();
      });
      return true;
    }

    pendingState.info = pendingState.info || {};
    const previousFilename = pendingState.info.filename;
    pendingState.info.filename = pendingState.scratch?.browserFilenameResolution
      ? downloadItem.filename || pendingState.info.suggestedFilename || pendingState.info.filename
      : pendingState.info.suggestedFilename || downloadItem.filename || pendingState.info.filename;

    const pathTemplateRaw = pendingState.scratch?.pathTemplateRaw;
    const routeTemplateRaw = pendingState.scratch?.routeTemplateRaw;
    const filenameChanged = pendingState.info.filename !== previousFilename;
    const needsActualFilenameResolution =
      (filenameChanged || pendingState.scratch?.deferredRouteRequirement === true) &&
      ((Array.isArray(options.filenamePatterns) && options.filenamePatterns.length > 0) ||
        (typeof pathTemplateRaw === "string" && /:(?:filename|fileext):/.test(pathTemplateRaw)) ||
        (typeof routeTemplateRaw === "string" && /:(?:filename|fileext):/.test(routeTemplateRaw)));
    if (needsActualFilenameResolution) {
      void (async () => {
        await resolveFinalMimeExtension(pendingState);
        if (typeof pathTemplateRaw === "string") {
          pendingState.path = await applyVariables(new Path(pathTemplateRaw), pendingState.info);
        }
        const routeMatches = routeTemplateRaw ?? Download.getRoutingMatches(pendingState);
        pendingState.route = undefined;
        pendingState.routeIsFolder = false;
        if (routeMatches) {
          pendingState.routeIsFolder = /\/\s*$/.test(routeMatches);
          pendingState.route = await applyVariables(new Path(routeMatches), pendingState.info);
        }
        if (pendingState.scratch?.deferredRouteRequirement && !routeMatches) {
          await rejectDeferredRoute(pendingState);
          return;
        }
        // Re-expand the rename replacement against the browser-resolved
        // filename, exactly like the route template re-expansion above.
        await Download.resolveRenameTransform(pendingState);
        pendingState.scratch.deferredRouteRequirement = false;
        const filename = Download.finalizeFullPath(pendingState);
        rememberResolvedFilename(pendingState, filename);
        suggest({ filename, conflictAction: options.conflictAction });
      })().catch((error) => {
        logPort.add("filename resolution failed", String(error));
        if (pendingState.scratch?.deferredRouteRequirement) void rejectDeferredRoute(pendingState);
        else suggest();
      });
      return true;
    }

    const filename = Download.finalizeFullPath(pendingState);
    if (typeof downloadItem.id === "number") {
      Download.finalFilenamesByDownloadId.set(downloadItem.id, filename);
      void rememberFilename(
        downloadItem.id,
        filename,
        pendingState.info.currentTab?.incognito === true,
      );
    }
    const historyEntryId = pendingState.scratch?.historyEntryId;
    if (typeof historyEntryId === "string") {
      void historyPort.patch(historyEntryId, { finalFullPath: filename });
    }
    suggest({ filename, conflictAction: options.conflictAction });
    return false;
  });
};

import { downloadsState, sessionWriteState } from "./state.ts";
import { getSession, updateSession } from "../shared/session-state.ts";
import { options } from "../config/options-data.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";
import { WEB_EXTENSION_CAPABILITIES } from "../platform/chrome-detector.ts";
import { extensionSessionStorage } from "../platform/storage-areas.ts";
import { Path } from "../routing/path.ts";
import { applyVariables } from "../routing/variable.ts";
import { mergeDownload } from "./download-state.ts";
import { DownloadRetry } from "./download-retry.ts";
import { downloadPorts } from "./ports.ts";
import {
  isOrdinaryBrowserDownload,
  matchesBrowserDownloadFilter,
  routeBrowserDownload,
} from "./browser-downloads.ts";
import type { DownloadRuntimeState } from "./download-runtime-state.ts";
import type { DownloadPipelineState } from "./download-types.ts";
import { FINAL_FILENAMES_SESSION_KEY } from "../shared/storage-keys.ts";

const historyPort = downloadPorts.history;
const logPort = downloadPorts.log;
const backgroundRuntime = downloadPorts.runtime;

export type FinalFilenameMap = Record<string, string | string[]>;

export const filenameQueue = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string"
      ? [value]
      : [];

const safeFilenameMap = (value: unknown): FinalFilenameMap =>
  value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as FinalFilenameMap)
    : {};

export const enqueueFilename = (
  map: FinalFilenameMap | undefined,
  url: string,
  filename: string,
): FinalFilenameMap => {
  map = safeFilenameMap(map);
  const queue = [...filenameQueue(map[url]), filename];
  return { ...map, [url]: queue.length === 1 ? queue[0] : queue };
};

export const removeFilename = (
  map: FinalFilenameMap | undefined,
  url: string,
  filename?: string,
): FinalFilenameMap => {
  const copy = { ...safeFilenameMap(map) };
  const queue = filenameQueue(copy[url]);
  const index = filename == null ? 0 : queue.indexOf(filename);
  if (index >= 0) queue.splice(index, 1);
  if (queue.length) copy[url] = queue.length === 1 ? queue[0] : queue;
  else delete copy[url];
  return copy;
};

type FilenameDownload = DownloadRuntimeState & {
  retryViaFetch(downloadId: number): Promise<boolean>;
  getRoutingMatches(state: DownloadPipelineState): string | null | undefined;
  finalizeFullPath(state: DownloadPipelineState): string;
};

const rememberFilename = (downloadId: number, filename: string) =>
  mergeDownload(downloadsState, sessionWriteState, extensionSessionStorage, downloadId, {
    filename,
  });

export const registerFilenameAndObjectUrlListeners = (Download: FilenameDownload): void => {
  DownloadRetry.retry = Download.retryViaFetch;
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
      void (async () => {
        if (backgroundRuntime.ready) await backgroundRuntime.ready.catch(() => {});
        const url = downloadItem.finalUrl || downloadItem.url;
        if (
          !options.routeBrowserDownloads ||
          !matchesBrowserDownloadFilter(
            url,
            options.browserDownloadFilter,
            options.browserDownloadExcludeFilter,
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

    const pendingState = pendingQueue?.shift();
    if (pendingUrl && pendingQueue?.length === 0) Download.pendingStates.delete(pendingUrl);

    if (!pendingState || !pendingState.path) {
      getSession<FinalFilenameMap>(extensionSessionStorage, FINAL_FILENAMES_SESSION_KEY)
        .then((res) => {
          const map = res[FINAL_FILENAMES_SESSION_KEY] || {};
          const recoveredUrl = map[downloadItem.url]
            ? downloadItem.url
            : map[downloadItem.finalUrl]
              ? downloadItem.finalUrl
              : undefined;
          const recovered = recoveredUrl ? filenameQueue(map[recoveredUrl])[0] : undefined;
          if (!recovered) {
            suggest();
            return;
          }
          if (typeof downloadItem.id === "number") {
            Download.finalFilenamesByDownloadId.set(downloadItem.id, recovered);
            void rememberFilename(downloadItem.id, recovered);
          }
          updateSession<FinalFilenameMap>(
            sessionWriteState,
            extensionSessionStorage,
            FINAL_FILENAMES_SESSION_KEY,
            (m) => removeFilename(m, recoveredUrl!, recovered),
          );
          suggest({ filename: recovered, conflictAction: options.conflictAction });
        })
        .catch((error) => {
          logPort.add("filename recovery failed", String(error));
          suggest();
        });
      return true;
    }

    pendingState.info = pendingState.info || {};
    const previousFilename = pendingState.info.filename;
    pendingState.info.filename =
      pendingState.info.suggestedFilename || downloadItem.filename || pendingState.info.filename;

    const pathTemplateRaw = pendingState.scratch?.pathTemplateRaw;
    const filenameChanged = pendingState.info.filename !== previousFilename;
    const needsActualFilenameResolution =
      filenameChanged &&
      ((Array.isArray(options.filenamePatterns) && options.filenamePatterns.length > 0) ||
        (typeof pathTemplateRaw === "string" && /:(?:filename|fileext):/.test(pathTemplateRaw)));
    if (needsActualFilenameResolution) {
      void (async () => {
        if (typeof pathTemplateRaw === "string") {
          pendingState.path = await applyVariables(new Path(pathTemplateRaw), pendingState.info);
        }
        const routeMatches = Download.getRoutingMatches(pendingState);
        pendingState.route = undefined;
        pendingState.routeIsFolder = false;
        if (routeMatches) {
          pendingState.routeIsFolder = /\/\s*$/.test(routeMatches);
          pendingState.route = await applyVariables(new Path(routeMatches), pendingState.info);
        }
        const filename = Download.finalizeFullPath(pendingState);
        if (typeof downloadItem.id === "number") {
          Download.finalFilenamesByDownloadId.set(downloadItem.id, filename);
          void rememberFilename(downloadItem.id, filename);
        }
        const historyEntryId = pendingState.scratch?.historyEntryId;
        if (typeof historyEntryId === "string") {
          void historyPort.patch(historyEntryId, { finalFullPath: filename });
        }
        suggest({ filename, conflictAction: options.conflictAction });
      })().catch((error) => {
        logPort.add("filename resolution failed", String(error));
        suggest();
      });
      return true;
    }

    const filename = Download.finalizeFullPath(pendingState);
    if (typeof downloadItem.id === "number") {
      Download.finalFilenamesByDownloadId.set(downloadItem.id, filename);
      void rememberFilename(downloadItem.id, filename);
    }
    suggest({ filename, conflictAction: options.conflictAction });
    return false;
  });
};

import { webExtensionApi } from "../platform/web-extension-api.ts";

/* eslint-disable no-unused-vars */

import { BackgroundState } from "../background/state.ts";
import { getDownload, mergeDownload } from "./download-state.ts";
import type { DownloadRecord } from "./download-state.ts";
import { getSession, updateSession } from "../background/session-state.ts";
import { RequestHeaders } from "./headers.ts";
import { Notifier } from "./notification.ts";
import { Log } from "../background/log.ts";
import { matchRules } from "../routing/router.ts";
import { Path, sanitizeFilename } from "../routing/path.ts";
import { applyVariables, mimeToExtension, resolveMime } from "../routing/variable.ts";
import { SaveHistory } from "../background/history.ts";
import { options } from "../config/options-data.ts";
import { WEB_EXTENSION_CAPABILITIES } from "../platform/chrome-detector.ts";
import { getFilenameFromContentDispositionHeader } from "../vendor/content-disposition.ts";
import { makeUrlFromBlob } from "./content-fetch.ts";
import { OffscreenClient } from "../platform/offscreen-client.ts";
import { EXTENSION_REGEX, getFilenameFromUrl } from "../routing/filename.ts";
import { DownloadEvents } from "./download-events.ts";
import { DownloadRetry } from "./download-retry.ts";
import { extensionSessionStorage } from "../platform/storage-areas.ts";
import type {
  AcquiredDownload,
  DownloadPipelineState,
  DownloadPlan,
  FinalizableDownloadState,
} from "./download-types.ts";

// Most-recent download state: fallback for consumers that can't correlate
// by URL. Concurrent downloads are disambiguated via Download.pendingStates.
let globalChromeState: DownloadPipelineState | null = null;

const mergeStartedDownload = (downloadId: number, partial: Partial<DownloadRecord>) =>
  mergeDownload(
    BackgroundState.downloads,
    BackgroundState.sessionWrites,
    extensionSessionStorage,
    downloadId,
    partial,
  );

const getStartedDownload = (downloadId: number) =>
  getDownload(BackgroundState.downloads, extensionSessionStorage, downloadId);

const requireDownloadUrl = (state: Pick<DownloadPipelineState, "info">): string => {
  if (!state.info.url) throw new Error("Download URL is required");
  return state.info.url;
};

type FinalFilenameMap = Record<string, string | string[]>;
const filenameQueue = (value: string | string[] | undefined): string[] =>
  Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
const enqueueFilename = (map: FinalFilenameMap | undefined, url: string, filename: string) => {
  const queue = [...filenameQueue(map?.[url]), filename];
  return { ...map, [url]: queue.length === 1 ? queue[0] : queue };
};
const removeFilename = (map: FinalFilenameMap | undefined, url: string, filename?: string) => {
  const copy = { ...map };
  const queue = filenameQueue(copy[url]);
  const index = filename == null ? 0 : queue.indexOf(filename);
  if (index >= 0) queue.splice(index, 1);
  if (queue.length) copy[url] = queue.length === 1 ? queue[0] : queue;
  else delete copy[url];
  return copy;
};

const recordDownloadRequest = (plan: DownloadPlan): void => {
  const { state } = plan;
  Log.add("download requested", {
    url: state.info.url && String(state.info.url).slice(0, 200),
    path: plan.finalFullPath,
    route: state.route ? String(state.route.finalize()) : null,
  });
  if (window.SI_DEBUG) console.log(state, plan.finalFullPath); // eslint-disable-line

  DownloadEvents.downloaded(state);
  window.lastDownloadState = state;
};

export const Download = {
  DISPOSITION_FILENAME_REGEX: /filename[^;=\n]*=((['"])(.*)?\2|(.+'')?([^;\n]*))/i,
  // A trailing dotted token of 1–8 alnum chars, but NOT an all-digit one:
  // "photo.12345" is an id/version, not a ".12345" extension (§8.1). Real
  // numeric-bearing extensions keep a letter (mp3, mp4, h264, 7z).

  // url -> state for in-flight downloads, so onDeterminingFilename (Chrome)
  // and the referer listener (Firefox) attribute the right state when two
  // downloads overlap (e.g. tab-strip batch saves)
  pendingStates: new Map<string, DownloadPipelineState[]>(),

  rememberPendingState: (state: DownloadPipelineState) => {
    globalChromeState = state;
    if (state.info && state.info.url) {
      const queue = Download.pendingStates.get(state.info.url) || [];
      queue.push(state);
      Download.pendingStates.set(state.info.url, queue);
      // Bounded: Firefox has no onDeterminingFilename to consume entries
      if (Download.pendingStates.size > 50) {
        const oldest = Download.pendingStates.keys().next().value;
        if (oldest !== undefined) Download.pendingStates.delete(oldest);
      }
    }
  },

  // The per-download record (retry + history info) lives in DownloadState, keyed
  // by downloadId, mirrored to storage.session so it survives an MV3 worker
  // restart. These stay as thin seams because notification.js and the tests use
  // them.
  rememberStartedDownload: mergeStartedDownload,

  getStartedDownload,

  // blob/data URL -> final filename for retry downloads, so Chrome's
  // onDeterminingFilename suggests the intended path instead of falling
  // back to an unrelated pending state
  pendingRetryFilenames: new Map<string, string>(),
  ownedObjectUrls: new Map<number, string>(),
  generatedObjectUrls: new Set<string>(),

  // Automatic fallback chain: a browser-initiated download that failed with
  // a network/server error is retried once through a background fetch
  // (host permissions exempt extension-context fetches from CORS, and the
  // referer rule is re-armed). Resolves true when a retry was started.
  retryViaFetch: async (downloadId: number): Promise<boolean> => {
    const record = await Download.getStartedDownload(downloadId);
    if (!record || record.retried || record.viaFetch || options.fallbackFetch === false) {
      return false;
    }
    if (!record.url || !record.filename) {
      return false;
    }
    const { filename, url } = record;
    // Persist the retry guard (merge the full record so a persisted-only hit
    // keeps its other fields) so a second failure after a worker restart can't
    // retry the same download twice
    record.retried = true;
    await mergeStartedDownload(downloadId, record);

    let blobUrl: string | undefined;
    let expected: ReturnType<typeof Notifier.expectDownload> | undefined;
    let newId: number | undefined;
    try {
      await RequestHeaders.prepareReferer({ info: { url, pageUrl: record.pageUrl } });
      const response = await fetch(url, { credentials: "include" });
      if (response.ok === false) throw new Error(`HTTP ${response.status}`);
      blobUrl = await makeUrlFromBlob(await response.blob());
      Download.pendingRetryFilenames.set(blobUrl, filename);
      expected = Notifier.expectDownload(blobUrl);
      await Promise.all([
        updateSession<number>(
          BackgroundState.sessionWrites,
          extensionSessionStorage,
          "siPendingDownloads",
          (n) => Math.max(0, (n || 0) + 1),
        ),
        updateSession<FinalFilenameMap>(
          BackgroundState.sessionWrites,
          extensionSessionStorage,
          "siFinalFilenames",
          (m) => enqueueFilename(m, blobUrl!, filename),
        ),
      ]);
      newId = await webExtensionApi.downloads.download({
        url: blobUrl,
        filename,
        conflictAction: record.conflictAction,
      });
      Notifier.cancelExpectedDownload(expected);
      expected = undefined;
      if (blobUrl.startsWith("blob:")) Download.ownedObjectUrls.set(newId, blobUrl);
      await Download.rememberStartedDownload(
        newId,
        Object.assign({}, record, { viaFetch: true, adopted: true }),
      );
      return true;
    } catch (e) {
      if (expected) Notifier.cancelExpectedDownload(expected);
      if (blobUrl?.startsWith("blob:") && newId == null) URL.revokeObjectURL(blobUrl);
      Log.add("fallback fetch failed", String(e));
      return false;
    } finally {
      if (blobUrl) {
        Download.pendingRetryFilenames.delete(blobUrl);
        await Promise.all([
          updateSession<number>(
            BackgroundState.sessionWrites,
            extensionSessionStorage,
            "siPendingDownloads",
            (n) => Math.max(0, (n || 0) - 1),
          ),
          updateSession<FinalFilenameMap>(
            BackgroundState.sessionWrites,
            extensionSessionStorage,
            "siFinalFilenames",
            (m) => removeFilename(m, blobUrl!, filename),
          ),
        ]);
      }
    }
  },

  makeObjectUrl: (content: string, mime = "text/plain"): string => {
    if (typeof URL.createObjectURL === "function") {
      const objectUrl = URL.createObjectURL(
        new Blob([content], {
          type: `${mime};charset=utf-8`,
        }),
      );
      Download.generatedObjectUrls.add(objectUrl);
      return objectUrl;
    }

    // MV3 service workers have no URL.createObjectURL: use a data URL
    const bytes = new TextEncoder().encode(content);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return `data:${mime};charset=utf-8;base64,${btoa(binary)}`;
  },

  finalizeFullPath: (_state: FinalizableDownloadState): string => {
    let finalDir = _state.path.finalize();
    let finalFilename;

    if (_state.route && _state.routeIsFolder) {
      // §8.1: a folder-only rule (its `into:` ends with "/") routes into a
      // directory and keeps the download's real name — the browser's
      // Content-Disposition/MIME-resolved filename (or the URL/CD name on
      // Firefox) — instead of naming the file after the folder.
      const routeDir = String(_state.route.finalize()).replace(/\/+$/, "");
      finalDir = [finalDir, routeDir].filter((x) => x != null && x !== "").join("/");
      finalFilename =
        typeof _state.info.filename === "string"
          ? sanitizeFilename(_state.info.filename)
          : undefined;
    } else if (_state.route) {
      // The rule sets the whole name (which may itself include subdirectories)
      finalFilename = _state.route.finalize();
    } else {
      finalFilename =
        typeof _state.info.filename === "string"
          ? sanitizeFilename(_state.info.filename)
          : undefined;
    }

    // §8.1: append a MIME-derived extension when the resolved filename has none
    // (extensionless CDN / query-suffix URLs). The extension is resolved once,
    // asynchronously, in renameAndDownload and stashed on scratch.
    if (
      _state.scratch &&
      _state.scratch.mimeExtension &&
      finalFilename &&
      !EXTENSION_REGEX.test(finalFilename)
    ) {
      finalFilename = `${finalFilename}.${_state.scratch.mimeExtension}`;
    }

    const finalFullPath = [finalDir, finalFilename].filter((x) => x != null).join("/");

    return finalFullPath.replace(/^\.\//, "").replace(/^\//, "");
  },

  getFilenameFromContentDisposition: (disposition: unknown): string | null => {
    if (typeof disposition !== "string") return null;

    const filenameFromLib = getFilenameFromContentDispositionHeader(disposition);

    if (filenameFromLib) {
      // Some servers double-encode; decode at most twice, but a filename
      // with a literal % (e.g. "50%.txt") must not throw and lose the name
      const safeDecode = (s: string) => {
        try {
          return decodeURIComponent(s);
        } catch (e) {
          return s;
        }
      };
      return safeDecode(safeDecode(filenameFromLib));
    }

    return null;
  },

  getRoutingMatches: (state: Pick<DownloadPipelineState, "info">): string | null => {
    const filenamePatterns = Array.isArray(options.filenamePatterns)
      ? options.filenamePatterns
      : [];
    if (!filenamePatterns || filenamePatterns.length === 0) {
      return null;
    }

    return matchRules(filenamePatterns, state.info);
  },

  // Single entry point for firing a download from a menu/message click:
  // fire-and-forget (renameAndDownload is async) but with one place that both
  // logs and surfaces a terminal pipeline failure to the user. Callers still
  // Browser-attempt ownership is registered later, immediately around
  // downloads.download(), so planning failures cannot leak an expectation.
  launch: (state: DownloadPipelineState): Promise<void> =>
    Download.renameAndDownload(state).catch((e) => {
      Log.add("renameAndDownload failed", String(e));
      const name = (state && state.info && (state.info.suggestedFilename || state.info.url)) || "";
      Notifier.reportFailure(name, String(e));
    }),

  resolveDownloadPlan: async (state: DownloadPipelineState): Promise<DownloadPlan | null> => {
    const url = requireDownloadUrl(state);
    const naiveFilename = getFilenameFromUrl(url);
    const initialFilename = state.info.suggestedFilename || naiveFilename || url;
    Object.assign(state.info, { naiveFilename, filename: initialFilename, initialFilename });
    if (state.path instanceof Path && typeof state.path.raw === "string") {
      state.scratch.pathTemplateRaw = state.path.raw;
    }

    // This must precede the first await so onDeterminingFilename can correlate
    // a download even when variable interpolation yields control.
    Download.rememberPendingState(state);

    // Firefox resolves a server-provided filename before finalizing the plan.
    // Chrome must defer this to onDeterminingFilename, which runs after the
    // browser download starts.
    if (!WEB_EXTENSION_CAPABILITIES.downloadFilenameSuggestion) {
      try {
        const response = await fetch(url, {
          method: "HEAD",
          credentials: "include",
        });
        if (response.headers.has("Content-Disposition")) {
          const dispositionName = Download.getFilenameFromContentDisposition(
            response.headers.get("Content-Disposition"),
          );
          state.info.filename = dispositionName || state.info.filename;
        }
      } catch {
        // HEAD is best-effort; acquisition still proceeds with the resolved name.
      }
    }

    state.path = await applyVariables(state.path, state.info);
    const routeMatches = Download.getRoutingMatches(state);
    if (routeMatches) {
      state.routeIsFolder = typeof routeMatches === "string" && /\/\s*$/.test(routeMatches);
      state.route = await applyVariables(new Path(routeMatches), state.info);
    }
    if (state.needRouteMatch && !routeMatches) return null;

    if (options.appendMimeExtension !== false) {
      const tentative =
        state.route && !state.routeIsFolder
          ? state.route.finalize()
          : typeof state.info.filename === "string"
            ? sanitizeFilename(state.info.filename)
            : undefined;
      if (tentative && !EXTENSION_REGEX.test(tentative)) {
        const ext = mimeToExtension(await resolveMime(state.info));
        if (ext) state.scratch.mimeExtension = ext;
      }
    }

    return Download.createDownloadPlan(state);
  },

  createDownloadPlan: (state: DownloadPipelineState): DownloadPlan => {
    const finalFullPath = Download.finalizeFullPath(state);
    state.scratch.hasExtension = finalFullPath && finalFullPath.match(EXTENSION_REGEX);
    const noExtensionPrompt = options.promptIfNoExtension && !state.scratch.hasExtension;
    const shiftHeldPrompt =
      options.promptOnShift &&
      state.info.modifiers &&
      typeof state.info.modifiers.find((m) => m === "Shift") !== "undefined";
    const noRuleMatchedPrompt = options.routeFailurePrompt && !state.route;
    const prompt = options.prompt || noExtensionPrompt || shiftHeldPrompt || noRuleMatchedPrompt;

    const historyEntryId = SaveHistory.add({
      timestamp: new Date().toISOString(),
      url: state.info.url,
      finalFullPath,
      routed: Boolean(state.route),
      info: {
        sourceUrl: state.info.sourceUrl,
        pageUrl: state.info.pageUrl,
        context: state.info.context,
      },
    });
    state.scratch.historyEntryId = historyEntryId;

    return { state, finalFullPath, prompt, historyEntryId };
  },

  acquireFetchedUrl: async (url: string): Promise<AcquiredDownload> => {
    if (OffscreenClient.canUse()) {
      try {
        return { url: await OffscreenClient.fetch(url), source: "fetched" };
      } catch (e) {
        Log.add("offscreen fetch failed", String(e));
        return { url, source: "fetch-fallback-direct" };
      }
    }

    try {
      const response = await fetch(url, { credentials: "include" });
      if (response.ok === false) throw new Error(`HTTP ${response.status}`);
      const objectUrl = await makeUrlFromBlob(await response.blob());
      return {
        url: objectUrl,
        source: "fetched",
        ownedObjectUrl: objectUrl.startsWith("blob:") ? objectUrl : undefined,
      };
    } catch (e) {
      Log.add("fetch download failed", String(e));
      return { url, source: "fetch-fallback-direct" };
    }
  },

  acquireDownloadUrl: async (plan: DownloadPlan): Promise<AcquiredDownload> => {
    const { state } = plan;
    if (state.info.contentPromise) {
      const content = await state.info.contentPromise;
      if (content && content.downloadUrl) {
        return {
          url: content.downloadUrl,
          source: "fetched",
          ownedObjectUrl: content.ownedObjectUrl,
        };
      }
    }
    const url = requireDownloadUrl(state);
    if (options.fetchViaFetch) return Download.acquireFetchedUrl(url);
    const ownedObjectUrl = Download.generatedObjectUrls.delete(url) ? url : undefined;
    return { url, source: "direct", ownedObjectUrl };
  },

  executeBrowserDownload: async (plan: DownloadPlan, acquired: AcquiredDownload): Promise<void> => {
    const { state, finalFullPath, prompt, historyEntryId } = plan;
    const filename = finalFullPath || "_";
    await RequestHeaders.prepareReferer(state);
    await Promise.all([
      updateSession<number>(
        BackgroundState.sessionWrites,
        extensionSessionStorage,
        "siPendingDownloads",
        (n) => Math.max(0, (n || 0) + 1),
      ),
      updateSession<FinalFilenameMap>(
        BackgroundState.sessionWrites,
        extensionSessionStorage,
        "siFinalFilenames",
        (m) => enqueueFilename(m, acquired.url, filename),
      ),
    ]);

    const expected = Notifier.expectDownload(acquired.url);
    try {
      const downloadId = await webExtensionApi.downloads.download({
        url: acquired.url,
        filename,
        saveAs: prompt,
        conflictAction: options.conflictAction,
      });
      Notifier.cancelExpectedDownload(expected);
      if (acquired.ownedObjectUrl) {
        Download.ownedObjectUrls.set(downloadId, acquired.ownedObjectUrl);
      }
      await Download.rememberStartedDownload(downloadId, {
        url: state.info.url,
        pageUrl: state.info.pageUrl,
        filename,
        conflictAction: options.conflictAction,
        viaFetch: acquired.source === "fetched",
        retried: false,
        historyEntryId,
        adopted: true,
      });
      if (historyEntryId) SaveHistory.setDownloadId(historyEntryId, downloadId);
    } catch (e) {
      Notifier.cancelExpectedDownload(expected);
      if (acquired.ownedObjectUrl) URL.revokeObjectURL(acquired.ownedObjectUrl);
      Log.add("downloads.download failed", String(e));
      if (acquired.source === "direct" && options.fallbackFetch !== false) {
        const fallback = await Download.acquireFetchedUrl(requireDownloadUrl(state));
        await Download.executeBrowserDownload(plan, fallback);
      } else {
        await SaveHistory.setStatus(historyEntryId, "DOWNLOAD_API_FAILED");
        Notifier.reportFailure(finalFullPath || state.info.url || "", String(e));
      }
    } finally {
      await Promise.all([
        updateSession<number>(
          BackgroundState.sessionWrites,
          extensionSessionStorage,
          "siPendingDownloads",
          (n) => Math.max(0, (n || 0) - 1),
        ),
        updateSession<FinalFilenameMap>(
          BackgroundState.sessionWrites,
          extensionSessionStorage,
          "siFinalFilenames",
          (m) => removeFilename(m, acquired.url, filename),
        ),
      ]);
    }
  },

  // async because applyVariables may await a
  // :counter:/:mime: transformer). Callers fire-and-forget, so awaiting the
  // path/route interpolation here before the download is safe.
  renameAndDownload: async (state: DownloadPipelineState): Promise<void> => {
    const plan = await Download.resolveDownloadPlan(state);
    if (!plan) {
      const url = state.info.url;
      if (url && Download.generatedObjectUrls.delete(url)) URL.revokeObjectURL(url);
      return;
    }

    recordDownloadRequest(plan);
    const acquired = await Download.acquireDownloadUrl(plan);
    await Download.executeBrowserDownload(plan, acquired);

    // Trigger notifications
    if (state.route) {
      if (options.notifyOnRuleMatch) {
        Notifier.createExtensionNotification(
          webExtensionApi.i18n.getMessage("notificationRuleMatchedTitle"),
          `${state.info.initialFilename}\n⬇\n${state.route}`,
          false,
        );
      }
    } else if (options.routeExclusive && options.notifyOnFailure) {
      Notifier.createExtensionNotification(
        webExtensionApi.i18n.getMessage("notificationRuleMatchFailedExclusiveTitle"),
        webExtensionApi.i18n.getMessage("notificationRuleMatchFailedExclusiveMessage", [
          state.info.url,
        ]),
        true,
      );
    }
  },
};

// MV3 (Chrome): entry.background calls this synchronously at startup so the
// onDeterminingFilename listener is attached before any download event fires.
export const registerDownloadListener = () => {
  DownloadRetry.retry = Download.retryViaFetch;
  webExtensionApi.downloads?.onChanged?.addListener((delta) => {
    if (delta.state?.current !== "complete" && !delta.error) return;
    const objectUrl = Download.ownedObjectUrls.get(delta.id);
    if (!objectUrl) return;
    Download.ownedObjectUrls.delete(delta.id);
    URL.revokeObjectURL(objectUrl);
  });
  if (WEB_EXTENSION_CAPABILITIES.downloadFilenameSuggestion) {
    chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
      // Don't interfere with other extensions
      if (!webExtensionApi.runtime || webExtensionApi.runtime.id !== downloadItem.byExtensionId) {
        return false;
      }

      // Fetch-fallback retries carry their finalized filename directly; the
      // pending-state fallback below would suggest an unrelated download's name
      const retryFilename = Download.pendingRetryFilenames.get(downloadItem.url);
      if (retryFilename) {
        Download.pendingRetryFilenames.delete(downloadItem.url);
        suggest({
          filename: retryFilename,
          conflictAction: options.conflictAction,
        });
        return false;
      }

      // Correlate by URL so overlapping downloads each get their own state;
      // the most-recent state is the fallback for uncorrelatable items
      const pendingQueue =
        Download.pendingStates.get(downloadItem.url) ||
        Download.pendingStates.get(downloadItem.finalUrl);
      const pendingState = pendingQueue?.shift() || globalChromeState;
      if (pendingQueue?.length === 0) {
        Download.pendingStates.delete(downloadItem.url);
        Download.pendingStates.delete(downloadItem.finalUrl);
      }

      // In-memory state is lost if the MV3 service worker restarted between
      // requesting the download and this event: recover the persisted filename,
      // keyed by download URL so overlapping downloads each get their own name
      if (!pendingState || !pendingState.path) {
        getSession<FinalFilenameMap>(extensionSessionStorage, "siFinalFilenames").then((res) => {
          const map = res.siFinalFilenames || {};
          const recoveredUrl = map[downloadItem.url]
            ? downloadItem.url
            : map[downloadItem.finalUrl]
              ? downloadItem.finalUrl
              : undefined;
          const recovered = recoveredUrl ? filenameQueue(map[recoveredUrl])[0] : undefined;
          if (recovered) {
            updateSession<FinalFilenameMap>(
              BackgroundState.sessionWrites,
              extensionSessionStorage,
              "siFinalFilenames",
              (m) => removeFilename(m, recoveredUrl!, recovered),
            );
            suggest({
              filename: recovered,
              conflictAction: options.conflictAction,
            });
          } else {
            suggest();
          }
        });
        return true; // suggest is called asynchronously
      }

      pendingState.info = pendingState.info || {};
      const previousFilename = pendingState.info.filename;
      pendingState.info.filename =
        (pendingState.info && pendingState.info.suggestedFilename) ||
        downloadItem.filename ||
        (pendingState.info && pendingState.info.filename);

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
          const historyEntryId = pendingState.scratch?.historyEntryId;
          if (typeof historyEntryId === "string") {
            void SaveHistory.patch(historyEntryId, { finalFullPath: filename });
          }
          suggest({ filename, conflictAction: options.conflictAction });
        })();
        return true;
      }

      suggest({
        filename: Download.finalizeFullPath(pendingState),
        conflictAction: options.conflictAction,
      });
      return false;
    });
  }
};

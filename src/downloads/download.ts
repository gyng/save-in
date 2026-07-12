import { webExtensionApi } from "../platform/web-extension-api.ts";

/* eslint-disable no-unused-vars */

import { downloadsState, sessionWriteState } from "./state.ts";
import { getDownload, mergeDownload } from "./download-state.ts";
import type { DownloadRecord } from "./download-state.ts";
import { normalizeSessionCounter, updateSession } from "../shared/session-state.ts";
import { RequestHeaders } from "./headers.ts";
import { Notifier } from "./notification.ts";
import { matchRules } from "../routing/router.ts";
import { Path, sanitizeFilename } from "../routing/path.ts";
import { applyVariables, mimeToExtension, resolveMime } from "../routing/variable.ts";
import { options } from "../config/options-data.ts";
import { downloadPorts } from "./ports.ts";
import { WEB_EXTENSION_CAPABILITIES } from "../platform/chrome-detector.ts";
import { getFilenameFromContentDispositionHeader } from "../vendor/content-disposition.ts";
import { makeUrlFromBlob } from "./content-fetch.ts";
import { OffscreenClient } from "../platform/offscreen-client.ts";
import { EXTENSION_REGEX, getFilenameFromUrl } from "../routing/filename.ts";
import { MESSAGE_TYPES } from "../shared/constants.ts";
import { DownloadEvents } from "./download-events.ts";
import { retryViaFetch } from "./download-retry.ts";
import { extensionSessionStorage } from "../platform/storage-areas.ts";
import type {
  AcquiredDownload,
  DownloadPipelineState,
  DownloadPlan,
  DownloadExecutionResult,
  DownloadLaunchResult,
  FinalizableDownloadState,
} from "./download-types.ts";
import { createDownloadRuntimeState } from "./download-runtime-state.ts";
import {
  enqueueFilename,
  registerFilenameAndObjectUrlListeners,
  removeFilename,
} from "./filename-listener.ts";
import { BrowserDownloadRouting, routeBrowserDownload } from "./browser-downloads.ts";

const downloadRuntime = createDownloadRuntimeState();
const logPort = downloadPorts.log;
const historyPort = downloadPorts.history;
const backgroundRuntime = downloadPorts.runtime;

const mergeStartedDownload = (downloadId: number, partial: Partial<DownloadRecord>) =>
  mergeDownload(downloadsState, sessionWriteState, extensionSessionStorage, downloadId, partial);

const getStartedDownload = (downloadId: number) =>
  getDownload(downloadsState, extensionSessionStorage, downloadId);

const requireDownloadUrl = (state: Pick<DownloadPipelineState, "info">): string => {
  if (!state.info.url) throw new Error("Download URL is required");
  return state.info.url;
};

const isHttpDownloadUrl = (value: string | undefined): boolean => {
  if (!value) return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
};

const releaseUnusedContent = async (state: DownloadPipelineState): Promise<void> => {
  const contentPromise = state.info.contentPromise;
  state.info.contentPromise = undefined;
  if (!contentPromise) return;
  try {
    const content = await contentPromise;
    if (content?.ownedObjectUrl && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(content.ownedObjectUrl);
    }
  } catch {
    // The pipeline's original error remains authoritative.
  }
};

import type { FinalFilenameMap } from "./filename-listener.ts";

const recordDownloadRequest = (plan: DownloadPlan): void => {
  const { state } = plan;
  logPort.add("download requested", {
    url: state.info.url && String(state.info.url).slice(0, 200),
    path: plan.finalFullPath,
    route: state.route ? String(state.route.finalize()) : null,
  });
  if (backgroundRuntime.debug) console.log(state, plan.finalFullPath); // eslint-disable-line

  DownloadEvents.downloaded(state);
  backgroundRuntime.lastDownloadState = state;
};

export const Download = {
  DISPOSITION_FILENAME_REGEX: /filename[^;=\n]*=((['"])(.*)?\2|(.+'')?([^;\n]*))/i,
  // A trailing dotted token of 1–8 alnum chars, but NOT an all-digit one:
  // "photo.12345" is an id/version, not a ".12345" extension (§8.1). Real
  // numeric-bearing extensions keep a letter (mp3, mp4, h264, 7z).

  // url -> state for in-flight downloads, so onDeterminingFilename can
  // attribute the right state when two Chrome downloads overlap.
  ...downloadRuntime,

  // The per-download record (retry + history info) lives in DownloadState, keyed
  // by downloadId, mirrored to storage.session so it survives an MV3 worker
  // restart. These stay as thin seams because notification.js and the tests use
  // them.
  rememberStartedDownload: mergeStartedDownload,

  getStartedDownload,

  // blob/data URL -> final filename for retry downloads, so Chrome's
  // onDeterminingFilename suggests the intended path instead of falling
  // back to an unrelated pending state
  // Automatic fallback chain: a browser-initiated download that failed with
  // a network/server error is retried once through a background fetch. Resolves
  // true when a retry was started. Referer-protected attempts opt out because
  // extension fetch cannot preserve that browser-download header.
  retryViaFetch: (downloadId: number): Promise<boolean> =>
    retryViaFetch(
      Download,
      { notifier: Notifier, log: logPort },
      downloadId,
      enqueueFilename,
      removeFilename,
    ),

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
  launch: (state: DownloadPipelineState): Promise<DownloadLaunchResult> =>
    Download.renameAndDownload(state).catch((e) => {
      logPort.add("renameAndDownload failed", String(e));
      const name = (state && state.info && (state.info.suggestedFilename || state.info.url)) || "";
      Notifier.reportFailure(name, String(e));
      return { status: "failed" as const };
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
    if (WEB_EXTENSION_CAPABILITIES.downloadFilenameSuggestion) {
      Download.rememberPendingState(state);
    }

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
    if ((state.needRouteMatch || options.routeExclusive) && !routeMatches) {
      Download.forgetPendingState(state);
      return null;
    }

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

    const historyEntryId = historyPort.add({
      timestamp: new Date().toISOString(),
      initiatedAt: state.info.now?.toISOString(),
      url: state.info.url,
      finalFullPath,
      routed: Boolean(state.route),
      info: {
        sourceUrl: state.info.sourceUrl,
        pageUrl: state.info.pageUrl,
        context: state.info.context,
      },
      menu: {
        id: state.info.menuItemId,
        title: state.info.menuItemTitle,
        path: state.info.menuItemPath,
      },
      variables: Object.fromEntries(
        Object.entries({
          filename: state.info.filename,
          initialfilename: state.info.initialFilename,
          suggestedfilename: state.info.suggestedFilename,
          pagetitle: state.info.currentTab?.title,
          pageurl: state.info.pageUrl,
          sourceurl: state.info.sourceUrl,
          linktext: state.info.linkText,
          selection: state.info.selectionText,
          context: state.info.context,
          comment: state.info.comment,
          menuindex: state.info.menuIndex,
          counter: state.info.counter,
        })
          .filter(
            (entry): entry is [string, string | number] =>
              typeof entry[1] === "string" || typeof entry[1] === "number",
          )
          .map(([key, value]) => [key, String(value)]),
      ),
    });
    state.scratch.historyEntryId = historyEntryId;

    return { state, finalFullPath, prompt, historyEntryId };
  },

  acquireFetchedUrl: async (url: string): Promise<AcquiredDownload> => {
    if (OffscreenClient.canUse()) {
      try {
        return { url: await OffscreenClient.fetch(url), source: "fetched" };
      } catch (e) {
        logPort.add("offscreen fetch failed", String(e));
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
      logPort.add("fetch download failed", String(e));
      return { url, source: "fetch-fallback-direct" };
    }
  },

  acquireDownloadUrl: async (plan: DownloadPlan): Promise<AcquiredDownload> => {
    const { state } = plan;
    if (state.info.contentPromise) {
      const content = await state.info.contentPromise;
      if (content && content.downloadUrl) {
        state.info.contentPromise = undefined;
        return {
          url: content.downloadUrl,
          source: "fetched",
          ownedObjectUrl: content.ownedObjectUrl,
        };
      }
      if (content?.ownedObjectUrl && typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(content.ownedObjectUrl);
      }
      state.info.contentPromise = undefined;
    }
    const url = requireDownloadUrl(state);
    if (options.fetchViaFetch) return Download.acquireFetchedUrl(url);
    const ownedObjectUrl = Download.generatedObjectUrls.delete(url) ? url : undefined;
    return { url, source: "direct", ownedObjectUrl };
  },

  executeBrowserDownload: async (
    plan: DownloadPlan,
    acquired: AcquiredDownload,
  ): Promise<DownloadExecutionResult> => {
    const { state, finalFullPath, prompt, historyEntryId } = plan;
    void historyPort.patch(historyEntryId, {
      mechanism: acquired.source === "fetched" ? "fetch-downloads-api" : "downloads-api",
    });
    const filename = finalFullPath || "_";
    const headers =
      acquired.source === "direct" || acquired.source === "fetch-fallback-direct"
        ? RequestHeaders.getDownloadHeaders(state)
        : undefined;
    const allowOriginalUrlFallback = !headers && isHttpDownloadUrl(state.info.url);
    await Promise.all([
      updateSession<number>(
        sessionWriteState,
        extensionSessionStorage,
        "siPendingDownloads",
        (n) => normalizeSessionCounter(n) + 1,
      ),
      updateSession<FinalFilenameMap>(
        sessionWriteState,
        extensionSessionStorage,
        "siFinalFilenames",
        (m) => enqueueFilename(m, acquired.url, filename),
      ),
    ]);

    const expected = Notifier.expectDownload(acquired.url, {
      url: state.info.url,
      pageUrl: state.info.pageUrl,
      filename,
      conflictAction: options.conflictAction,
      viaFetch: acquired.source === "fetched",
      retried: false,
      allowOriginalUrlFallback,
      historyEntryId,
    });
    try {
      if (acquired.url !== state.info.url) Download.movePendingState(state, acquired.url);
      const downloadOptions: Parameters<typeof webExtensionApi.downloads.download>[0] = {
        url: acquired.url,
        filename,
        saveAs: prompt,
        conflictAction: options.conflictAction,
      };
      if (headers) downloadOptions.headers = headers;
      const downloadId = await webExtensionApi.downloads.download(downloadOptions);
      Notifier.cancelExpectedDownload(expected);
      if (acquired.ownedObjectUrl) {
        Download.ownedObjectUrls.set(downloadId, acquired.ownedObjectUrl);
      }
      const browserFilename = Download.finalFilenamesByDownloadId.get(downloadId);
      Download.finalFilenamesByDownloadId.delete(downloadId);
      await Download.rememberStartedDownload(downloadId, {
        url: state.info.url,
        pageUrl: state.info.pageUrl,
        filename: browserFilename || filename,
        conflictAction: options.conflictAction,
        viaFetch: acquired.source === "fetched",
        retried: false,
        allowOriginalUrlFallback,
        historyEntryId,
        adopted: true,
      });
      if (historyEntryId) historyPort.setDownloadId(historyEntryId, downloadId);
      return { status: "started", downloadId };
    } catch (e) {
      Notifier.cancelExpectedDownload(expected);
      if (acquired.ownedObjectUrl) URL.revokeObjectURL(acquired.ownedObjectUrl);
      logPort.add("downloads.download failed", String(e));
      if (
        acquired.source === "direct" &&
        allowOriginalUrlFallback &&
        options.fallbackFetch !== false
      ) {
        const fallback = await Download.acquireFetchedUrl(requireDownloadUrl(state));
        return await Download.executeBrowserDownload(plan, fallback);
      } else {
        Download.forgetPendingState(state);
        await historyPort.setStatus(historyEntryId, "DOWNLOAD_API_FAILED");
        Notifier.reportFailure(finalFullPath || state.info.url || "", String(e));
        return { status: "failed" };
      }
    } finally {
      await Promise.all([
        updateSession<number>(
          sessionWriteState,
          extensionSessionStorage,
          "siPendingDownloads",
          (n) => Math.max(0, normalizeSessionCounter(n) - 1),
        ),
        updateSession<FinalFilenameMap>(
          sessionWriteState,
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
  renameAndDownload: async (state: DownloadPipelineState): Promise<DownloadLaunchResult> => {
    let plan: DownloadPlan | null;
    try {
      plan = await Download.resolveDownloadPlan(state);
    } catch (error) {
      Download.forgetPendingState(state);
      await releaseUnusedContent(state);
      const url = state.info.url;
      if (url && Download.generatedObjectUrls.delete(url)) URL.revokeObjectURL(url);
      throw error;
    }
    if (!plan) {
      await releaseUnusedContent(state);
      const url = state.info.url;
      if (url && Download.generatedObjectUrls.delete(url)) URL.revokeObjectURL(url);
      if ((state.needRouteMatch || options.routeExclusive) && options.notifyOnFailure) {
        Notifier.createExtensionNotification(
          webExtensionApi.i18n.getMessage("notificationRuleMatchFailedExclusiveTitle"),
          webExtensionApi.i18n.getMessage("notificationRuleMatchFailedExclusiveMessage", [
            state.info.url,
          ]),
          true,
        );
      }
      return { status: "skipped" };
    }

    recordDownloadRequest(plan);
    let acquired: AcquiredDownload;
    try {
      acquired = await Download.acquireDownloadUrl(plan);
    } catch (error) {
      Download.forgetPendingState(state);
      await releaseUnusedContent(state);
      const url = state.info.url;
      if (url && Download.generatedObjectUrls.delete(url)) URL.revokeObjectURL(url);
      await historyPort.setStatus(plan.historyEntryId, "DOWNLOAD_PREPARATION_FAILED");
      logPort.add("download preparation failed", String(error));
      Notifier.reportFailure(plan.finalFullPath || state.info.url || "", String(error));
      return { status: "failed" };
    }
    const result = await Download.executeBrowserDownload(plan, acquired);
    if (result.status === "failed") return result;

    // Trigger notifications
    if (state.route) {
      if (options.notifyOnRuleMatch) {
        Notifier.createExtensionNotification(
          webExtensionApi.i18n.getMessage("notificationRuleMatchedTitle"),
          `${state.info.initialFilename}\n⬇\n${state.route}`,
          false,
        );
      }
    }
    return result;
  },
};

// MV3 (Chrome): entry.background calls this synchronously at startup so the
// onDeterminingFilename listener is attached before any download event fires.
export const registerDownloadListener = () => {
  BrowserDownloadRouting.route = (item) => routeBrowserDownload(Download, item);
  registerFilenameAndObjectUrlListeners(Download);
};

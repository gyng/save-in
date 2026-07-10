/* eslint-disable no-unused-vars */

// Most-recent download state: fallback for consumers that can't correlate
// by URL. Concurrent downloads are disambiguated via Download.pendingStates.
let globalChromeState = {};

const Download = {
  DISPOSITION_FILENAME_REGEX: /filename[^;=\n]*=((['"])(.*)?\2|(.+'')?([^;\n]*))/i,
  EXTENSION_REGEX: /\.([0-9a-z]{1,8})$/i,

  // url -> state for in-flight downloads, so onDeterminingFilename (Chrome)
  // and the referer listener (Firefox) attribute the right state when two
  // downloads overlap (e.g. tab-strip batch saves)
  pendingStates: new Map(),

  rememberPendingState: (state) => {
    globalChromeState = state;
    if (state.info && state.info.url) {
      Download.pendingStates.set(state.info.url, state);
      // Bounded: Firefox has no onDeterminingFilename to consume entries
      if (Download.pendingStates.size > 50) {
        const oldest = Download.pendingStates.keys().next().value;
        Download.pendingStates.delete(oldest);
      }
    }
  },

  // downloadId -> what we need to retry it through the fetch fallback
  // (notification.js consults this when a download fails)
  startedDownloads: new Map(),

  rememberStartedDownload: (downloadId, record) => {
    Download.startedDownloads.set(downloadId, record);
    if (Download.startedDownloads.size > 50) {
      const oldest = Download.startedDownloads.keys().next().value;
      Download.startedDownloads.delete(oldest);
    }
  },

  // blob/data URL -> final filename for retry downloads, so Chrome's
  // onDeterminingFilename suggests the intended path instead of falling
  // back to an unrelated pending state
  pendingRetryFilenames: new Map(),

  // Automatic fallback chain: a browser-initiated download that failed with
  // a network/server error is retried once through a background fetch
  // (host permissions exempt extension-context fetches from CORS, and the
  // referer rule is re-armed). Resolves true when a retry was started.
  retryViaFetch: (downloadId) => {
    const record = Download.startedDownloads.get(downloadId);
    if (!record || record.retried || record.viaFetch || options.fallbackFetch === false) {
      return Promise.resolve(false);
    }
    record.retried = true;

    return RequestHeaders.prepareReferer({ info: { url: record.url, pageUrl: record.pageUrl } })
      .then(() => fetch(record.url, { credentials: "include" }))
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.blob();
      })
      .then((blob) => Download.makeUrlFromBlob(blob))
      .then((blobUrl) => {
        Download.pendingRetryFilenames.set(blobUrl, record.filename);
        // expectDownload so the retry download is tracked via the in-memory
        // path (not the session-restart fallback) — that keeps the pending
        // counter balanced against the cleanup below
        Notifier.expectDownload();
        return Promise.all([
          SessionState.update("siPendingDownloads", (n) => Math.max(0, (n || 0) + 1)),
          SessionState.update("siFinalFilenames", (m) =>
            Object.assign({}, m, { [blobUrl]: record.filename }),
          ),
        ])
          .then(() =>
            browser.downloads.download({
              url: blobUrl,
              filename: record.filename,
              conflictAction: record.conflictAction,
            }),
          )
          .then((newId) => {
            Download.rememberStartedDownload(newId, Object.assign({}, record, { viaFetch: true }));
            return Notifier.trackDownload(newId);
          })
          .then(() =>
            Promise.all([
              SessionState.update("siPendingDownloads", (n) => Math.max(0, (n || 0) - 1)),
              SessionState.update("siFinalFilenames", (m) => {
                const copy = Object.assign({}, m);
                delete copy[blobUrl];
                return copy;
              }),
            ]),
          )
          .then(() => true);
      })
      .catch((e) => {
        if (typeof Log !== "undefined") {
          Log.add("fallback fetch failed", String(e));
        }
        return false;
      });
  },

  makeObjectUrl: (content, mime = "text/plain") => {
    if (typeof URL.createObjectURL === "function") {
      return URL.createObjectURL(
        new Blob([content], {
          type: `${mime};charset=utf-8`,
        }),
      );
    }

    // MV3 service workers have no URL.createObjectURL: use a data URL
    const bytes = new TextEncoder().encode(content);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return `data:${mime};charset=utf-8;base64,${btoa(binary)}`;
  },

  // Object URL if available (MV2), data URL otherwise (MV3 service workers)
  makeUrlFromBlob: (blob) => {
    if (typeof URL.createObjectURL === "function") {
      return Promise.resolve(URL.createObjectURL(blob));
    }

    return blob.arrayBuffer().then((buf) => {
      const bytes = new Uint8Array(buf);
      let binary = "";
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
      }
      const mime = blob.type || "application/octet-stream";
      return `data:${mime};base64,${btoa(binary)}`;
    });
  },

  getFilenameFromUrl: (url) => {
    let segment;
    try {
      const remotePath = new URL(url).pathname;
      segment = remotePath.substring(remotePath.lastIndexOf("/") + 1);
    } catch (e) {
      // Not a parseable URL (e.g. a data: URL handled elsewhere): no name
      return "";
    }
    try {
      // A malformed percent-escape (e.g. "50%off.jpg") must not abort the
      // whole download — fall back to the raw segment
      return decodeURIComponent(segment);
    } catch (e) {
      return segment;
    }
  },

  finalizeFullPath: (_state) => {
    const finalDir = _state.path.finalize();
    const finalFilename = _state.route
      ? _state.route.finalize()
      : Path.sanitizeFilename(_state.info.filename);
    const finalFullPath = [finalDir, finalFilename].filter((x) => x != null).join("/");

    return finalFullPath.replace(/^\.\//, "").replace(/^\//, "");
  },

  getFilenameFromContentDisposition: (disposition) => {
    if (typeof disposition !== "string") return null;

    const filenameFromLib = getFilenameFromContentDispositionHeader(disposition);

    if (filenameFromLib) {
      // Some servers double-encode; decode at most twice, but a filename
      // with a literal % (e.g. "50%.txt") must not throw and lose the name
      const safeDecode = (s) => {
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

  getRoutingMatches: (state) => {
    const filenamePatterns = options.filenamePatterns;
    if (!filenamePatterns || filenamePatterns.length === 0) {
      return null;
    }

    return Router.matchRules(filenamePatterns, state.info);
  },

  // async because Variable.applyVariables is now async (it may await a
  // :counter:/:mime: transformer). Callers fire-and-forget, so awaiting the
  // path/route interpolation here before the download is safe.
  renameAndDownload: async (state) => {
    const naiveFilename = Download.getFilenameFromUrl(state.info.url);
    const initialFilename = state.info.suggestedFilename || naiveFilename || state.info.url;

    Object.assign(state.info, {
      naiveFilename,
      filename: initialFilename,
      initialFilename,
    });

    // Register the pending state synchronously — before the async variable
    // interpolation — so a fast onDeterminingFilename / referer listener finds
    // it. It's the same object, interpolated in place below.
    Download.rememberPendingState(state);

    state.path = await Variable.applyVariables(state.path, state.info);
    // FIXME: Fix router params for new path struct
    const routeMatches = Download.getRoutingMatches(state);
    if (routeMatches) {
      state.route = await Variable.applyVariables(new Path.Path(routeMatches), state.info);
    }

    if (typeof state.needRouteMatch !== "undefined" && state.needRouteMatch && !routeMatches) {
      return;
    }

    const download = (_state) => {
      const finalFullPath = Download.finalizeFullPath(_state);
      // Set below via SaveHistory.add; threaded onto the started-download
      // record so the completion/failure handler can update this entry
      let historyEntryId = null;

      if (typeof Log !== "undefined") {
        Log.add("download requested", {
          url: _state.info.url && String(_state.info.url).slice(0, 200),
          path: finalFullPath,
          route: _state.route ? String(_state.route.finalize()) : null,
        });
      }

      if (window.SI_DEBUG) {
        console.log(_state, finalFullPath); // eslint-disable-line
      }

      _state.scratch.hasExtension = finalFullPath && finalFullPath.match(Download.EXTENSION_REGEX);
      const noExtensionPrompt = options.promptIfNoExtension && !_state.scratch.hasExtension;
      const shiftHeldPrompt =
        options.promptOnShift &&
        _state.info.modifiers &&
        typeof _state.info.modifiers.find((m) => m === "Shift") !== "undefined";
      const noRuleMatchedPrompt = options.routeFailurePrompt && !_state.route;

      const prompt = options.prompt || noExtensionPrompt || shiftHeldPrompt || noRuleMatchedPrompt;

      // viaFetch marks attempts that already went through a fetch (their
      // URL is a blob/data URL, or the fetch itself failed) so the
      // automatic fallback never loops
      const browserDownload = (_url, viaFetch = false) =>
        RequestHeaders.prepareReferer(_state)
          .then(() =>
            // Persist before calling the downloads API so notification tracking
            // and onDeterminingFilename survive an MV3 service worker restart.
            // The counter and the per-download-URL filename map both tolerate
            // overlapping downloads (a boolean/single value clobbered them).
            Promise.all([
              SessionState.update("siPendingDownloads", (n) => Math.max(0, (n || 0) + 1)),
              SessionState.update("siFinalFilenames", (m) =>
                Object.assign({}, m, { [_url]: finalFullPath || "_" }),
              ),
            ]),
          )
          .then(() =>
            browser.downloads.download({
              url: _url,
              filename: finalFullPath || "_",
              saveAs: prompt,
              conflictAction: options.conflictAction,
            }),
          )
          .then((downloadId) => {
            // Enough to retry this download via the fetch fallback if it
            // later fails with a network/server error
            Download.rememberStartedDownload(downloadId, {
              url: _state.info.url,
              pageUrl: _state.info.pageUrl,
              filename: finalFullPath || "_",
              conflictAction: options.conflictAction,
              viaFetch,
              retried: false,
              historyEntryId,
            });
            return Notifier.trackDownload(downloadId);
          })
          .catch((e) => {
            // e.g. Firefox rejects data: URLs in downloads.download
            if (typeof Log !== "undefined") {
              Log.add("downloads.download failed", String(e));
            }
            // Immediate rejections also get one fetch-fallback attempt
            if (!viaFetch && options.fallbackFetch !== false) {
              fetchDownload(_state.info.url);
            }
          })
          .then(() =>
            Promise.all([
              SessionState.update("siPendingDownloads", (n) => Math.max(0, (n || 0) - 1)),
              SessionState.update("siFinalFilenames", (m) => {
                const copy = Object.assign({}, m);
                delete copy[_url];
                return copy;
              }),
            ]),
          );

      const fetchDownload = (_url) => {
        fetch(_url, { credentials: "include" })
          .then((response) => response.blob())
          .then((myBlob) => Download.makeUrlFromBlob(myBlob))
          .then((blobUrl) => browserDownload(blobUrl, true))
          .catch((e) => {
            // A failed fetch (network/CORS) must not be a silent no-op
            if (typeof Log !== "undefined") {
              Log.add("fetch download failed", String(e));
            }
            browserDownload(_url, true);
          });
      };

      // Record history before triggering the download so the entry id is
      // available to the started-download record above. Store a compact
      // entry (not the whole state) so history can hold many entries, plus
      // whether a routing/rename rule was applied
      historyEntryId = SaveHistory.add({
        timestamp: new Date().toISOString(),
        url: _state.info.url,
        finalFullPath,
        routed: Boolean(_state.route),
        info: {
          sourceUrl: _state.info.sourceUrl,
          pageUrl: _state.info.pageUrl,
          context: _state.info.context,
        },
      });

      if (options.fetchViaContent) {
        Messaging.send
          .fetchViaContent(_state)
          .then((res) =>
            // Object URL has to be created inside the background script
            Download.makeUrlFromBlob(res.body.blob).then((blobUrl) =>
              browserDownload(blobUrl, true),
            ),
          )
          .catch((e) => {
            if (window.SI_DEBUG) {
              console.log("Failed to fetch via content", e); // eslint-disable-line
            }
            browserDownload(_state.info.url);
          });
      } else if (options.fetchViaFetch) {
        fetchDownload(_state.info.url);
      } else {
        browserDownload(_state.info.url);
      }

      Messaging.emit.downloaded(_state);
      window.lastDownloadState = _state;
    };

    // Chrome: Skip HEAD request for Content-Disposition and use onDeterminingFilename
    if (
      CURRENT_BROWSER === BROWSERS.CHROME &&
      chrome.downloads &&
      chrome.downloads.onDeterminingFilename
    ) {
      download(state);
    } else {
      fetch(state.info.url, { method: "HEAD", credentials: "include" })
        .then((res) => {
          if (res.headers.has("Content-Disposition")) {
            const disposition = res.headers.get("Content-Disposition");
            const dispositionName = Download.getFilenameFromContentDisposition(disposition);
            state.info.filename = dispositionName || state.info.filename;
          }
          download(state);
        })
        .catch(() => {
          // HEAD rejected for whatever reason: try to download anyway
          download(state);
        });
    }

    // Trigger notifications
    if (state.route) {
      if (options.notifyOnRuleMatch) {
        Notifier.createExtensionNotification(
          browser.i18n.getMessage("notificationRuleMatchedTitle"),
          `${state.info.initialFilename}\n⬇\n${state.route}`,
          false,
        );
      }
    } else if (options.routeExclusive && options.notifyOnFailure) {
      Notifier.createExtensionNotification(
        browser.i18n.getMessage("notificationRuleMatchFailedExclusiveTitle"),
        browser.i18n.getMessage("notificationRuleMatchFailedExclusiveMessage", [state.info.url]),
        true,
      );
    }
  },
};

if (chrome && chrome.downloads && chrome.downloads.onDeterminingFilename) {
  chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
    // Don't interfere with other extensions
    if (!browser.runtime || browser.runtime.id !== downloadItem.byExtensionId) {
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
    const pendingState =
      Download.pendingStates.get(downloadItem.url) ||
      Download.pendingStates.get(downloadItem.finalUrl) ||
      globalChromeState;
    Download.pendingStates.delete(downloadItem.url);
    Download.pendingStates.delete(downloadItem.finalUrl);

    // In-memory state is lost if the MV3 service worker restarted between
    // requesting the download and this event: recover the persisted filename,
    // keyed by download URL so overlapping downloads each get their own name
    if (!pendingState || !pendingState.path) {
      SessionState.get("siFinalFilenames").then((res) => {
        const map = res.siFinalFilenames || {};
        const recovered = map[downloadItem.url] || map[downloadItem.finalUrl];
        if (recovered) {
          SessionState.update("siFinalFilenames", (m) => {
            const copy = Object.assign({}, m);
            delete copy[downloadItem.url];
            delete copy[downloadItem.finalUrl];
            return copy;
          });
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
    pendingState.info.filename =
      (pendingState.info && pendingState.info.suggestedFilename) ||
      downloadItem.filename ||
      (pendingState.info && pendingState.info.filename);

    suggest({
      filename: Download.finalizeFullPath(pendingState),
      conflictAction: options.conflictAction,
    });
    return false;
  });
}

// Export for testing
if (typeof module !== "undefined") {
  module.exports = Download;
}

/* eslint-disable no-unused-vars */

// Most-recent download state: fallback for consumers that can't correlate
// by URL. Concurrent downloads are disambiguated via Download.pendingStates.
let globalChromeState = {};

const Download = {
  DISPOSITION_FILENAME_REGEX: /filename[^;=\n]*=((['"])(.*)?\2|(.+'')?([^;\n]*))/i,
  // A trailing dotted token of 1–8 alnum chars, but NOT an all-digit one:
  // "photo.12345" is an id/version, not a ".12345" extension (§8.1). Real
  // numeric-bearing extensions keep a letter (mp3, mp4, h264, 7z).
  EXTENSION_REGEX: /\.(?!\d+$)([0-9a-z]{1,8})$/i,

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

  // The per-download record (retry + history info) lives in DownloadState, keyed
  // by downloadId, mirrored to storage.session so it survives an MV3 worker
  // restart. These stay as thin seams because notification.js and the tests use
  // them.
  rememberStartedDownload: (downloadId, record) => DownloadState.merge(downloadId, record),

  getStartedDownload: (downloadId) => DownloadState.get(downloadId),

  // blob/data URL -> final filename for retry downloads, so Chrome's
  // onDeterminingFilename suggests the intended path instead of falling
  // back to an unrelated pending state
  pendingRetryFilenames: new Map(),

  // Automatic fallback chain: a browser-initiated download that failed with
  // a network/server error is retried once through a background fetch
  // (host permissions exempt extension-context fetches from CORS, and the
  // referer rule is re-armed). Resolves true when a retry was started.
  retryViaFetch: (downloadId) =>
    Download.getStartedDownload(downloadId).then((record) => {
      if (!record || record.retried || record.viaFetch || options.fallbackFetch === false) {
        return false;
      }
      // Persist the retry guard (merge the full record so a persisted-only hit
      // keeps its other fields) so a second failure after a worker restart can't
      // retry the same download twice
      record.retried = true;
      DownloadState.merge(downloadId, record);

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
            .then((newId) =>
              // The retry is our download too: adopt it so its completion
              // notifies and its outcome updates the same history entry
              Download.rememberStartedDownload(
                newId,
                Object.assign({}, record, { viaFetch: true, adopted: true }),
              ),
            )
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
    }),

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

  // Chrome MV3 only: fetch + createObjectURL in an offscreen document instead
  // of base64-ing the whole file into a data URL in the service worker. Gated
  // on a worker with no createObjectURL AND chrome.offscreen present, so the
  // Firefox event page (which has createObjectURL) never takes this path.
  canUseOffscreen: () =>
    typeof URL.createObjectURL !== "function" &&
    typeof chrome !== "undefined" &&
    Boolean(chrome.offscreen),

  // At most one offscreen document exists; create it lazily and reuse it
  ensureOffscreen: () => {
    const has = chrome.offscreen.hasDocument
      ? chrome.offscreen.hasDocument()
      : Promise.resolve(false);
    return Promise.resolve(has).then((exists) => {
      if (exists) {
        return null;
      }
      return chrome.offscreen
        .createDocument({
          url: "src/offscreen.html",
          reasons: ["BLOBS"],
          justification:
            "Create object URLs for fetched downloads (service workers have no URL.createObjectURL)",
        })
        .catch((e) => {
          // A concurrent createDocument races to "only one document" — tolerate
          if (!/single|only one|already/i.test(String(e))) {
            throw e;
          }
        });
    });
  },

  // Fetch a URL in the offscreen document and resolve to its blob object URL
  fetchViaOffscreen: (url) =>
    Download.ensureOffscreen()
      .then(() => chrome.runtime.sendMessage({ type: MESSAGE_TYPES.OFFSCREEN_FETCH, url }))
      .then((res) => {
        if (!res || !res.blobUrl) {
          throw new Error((res && res.error) || "offscreen fetch failed");
        }
        return res.blobUrl;
      }),

  // Content hashing pulls the whole file into memory, so it is capped (bigger
  // files are skipped) and time-limited.
  HASH_MAX_BYTES: 256 * 1024 * 1024,
  HASH_FETCH_TIMEOUT_MS: 30000,

  // Fetch a URL's content ONCE and resolve to both its SHA-256 (hex) and a
  // reusable download URL, so a :sha256: download isn't fetched a second time
  // to save it. On Chrome the fetch/hash/blob-URL happen together in the
  // offscreen document (a service worker can't createObjectURL); on the Firefox
  // event page it's all in-context. Resolves to null on failure / over-cap so
  // the caller falls back to a normal fetch.
  resolveContent: (url) => {
    if (Download.canUseOffscreen()) {
      return Download.ensureOffscreen()
        .then(() =>
          chrome.runtime.sendMessage({
            type: MESSAGE_TYPES.OFFSCREEN_FETCH,
            url,
            hash: "SHA-256",
            maxBytes: Download.HASH_MAX_BYTES,
          }),
        )
        .then((res) =>
          res && res.blobUrl ? { sha256: res.hash || "", downloadUrl: res.blobUrl } : null,
        )
        .catch(() => null);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Download.HASH_FETCH_TIMEOUT_MS);
    return fetch(url, { credentials: "include", signal: controller.signal })
      .then((res) => {
        if (!res.ok || Number(res.headers.get("Content-Length")) > Download.HASH_MAX_BYTES) {
          return null;
        }
        return res.blob();
      })
      .then((blob) => {
        if (!blob || blob.size > Download.HASH_MAX_BYTES) {
          return null;
        }
        return blob.arrayBuffer().then((buf) =>
          crypto.subtle.digest("SHA-256", buf).then((digest) => ({
            sha256: [...new Uint8Array(digest)]
              .map((b) => b.toString(16).padStart(2, "0"))
              .join(""),
            downloadUrl: URL.createObjectURL(blob),
          })),
        );
      })
      .catch(() => null)
      .finally(() => clearTimeout(timer));
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
    let finalDir = _state.path.finalize();
    let finalFilename;

    if (_state.route && _state.routeIsFolder) {
      // §8.1: a folder-only rule (its `into:` ends with "/") routes into a
      // directory and keeps the download's real name — the browser's
      // Content-Disposition/MIME-resolved filename (or the URL/CD name on
      // Firefox) — instead of naming the file after the folder.
      const routeDir = String(_state.route.finalize()).replace(/\/+$/, "");
      finalDir = [finalDir, routeDir].filter((x) => x != null && x !== "").join("/");
      finalFilename = Path.sanitizeFilename(_state.info.filename);
    } else if (_state.route) {
      // The rule sets the whole name (which may itself include subdirectories)
      finalFilename = _state.route.finalize();
    } else {
      finalFilename = Path.sanitizeFilename(_state.info.filename);
    }

    // §8.1: append a MIME-derived extension when the resolved filename has none
    // (extensionless CDN / query-suffix URLs). The extension is resolved once,
    // asynchronously, in renameAndDownload and stashed on scratch.
    if (
      _state.scratch &&
      _state.scratch.mimeExtension &&
      finalFilename &&
      !Download.EXTENSION_REGEX.test(finalFilename)
    ) {
      finalFilename = `${finalFilename}.${_state.scratch.mimeExtension}`;
    }

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

  // Single entry point for firing a download from a menu/message click:
  // fire-and-forget (renameAndDownload is async) but with one place that both
  // logs and surfaces a terminal pipeline failure to the user. Callers still
  // call Notifier.expectDownload() themselves (the tab-strip batch stages it
  // separately from the per-tab launch).
  launch: (state) =>
    Download.renameAndDownload(state).catch((e) => {
      if (typeof Log !== "undefined") {
        Log.add("renameAndDownload failed", String(e));
      }
      const name = (state && state.info && (state.info.suggestedFilename || state.info.url)) || "";
      Notifier.reportFailure(name, String(e));
    }),

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
    const routeMatches = Download.getRoutingMatches(state);
    if (routeMatches) {
      // §8.1: a trailing "/" on the rule's `into:` marks it as a folder-only
      // route — the destination is a directory and the real filename is kept
      // (see finalizeFullPath). Backward-compatible: rules without a trailing
      // slash still set the whole name.
      state.routeIsFolder = typeof routeMatches === "string" && /\/\s*$/.test(routeMatches);
      state.route = await Variable.applyVariables(new Path.Path(routeMatches), state.info);
    }

    if (typeof state.needRouteMatch !== "undefined" && state.needRouteMatch && !routeMatches) {
      return;
    }

    // §8.1: if the resolved filename has no (valid) extension, derive one from
    // the server's Content-Type so extensionless CDN / query-suffix URLs still
    // save with a sensible extension. Best-effort HEAD (shared with :mime:),
    // gated on the option; finalizeFullPath appends scratch.mimeExtension.
    if (options.appendMimeExtension !== false && typeof Variable !== "undefined") {
      const tentative =
        state.route && !state.routeIsFolder
          ? state.route.finalize()
          : Path.sanitizeFilename(state.info.filename);
      if (tentative && !Download.EXTENSION_REGEX.test(tentative)) {
        const ext = Variable.mimeToExtension(await Variable.resolveMime(state.info));
        if (ext) {
          state.scratch.mimeExtension = ext;
        }
      }
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
            // The record carries what a fetch-fallback retry needs and marks the
            // download as ours (adopted) so the notifier watches it for a
            // completion/failure toast — download.js knows for certain it is ours,
            // where onDownloadCreated's adoption is only a best-effort backstop
            // for the worker-restart case
            const remembered = Download.rememberStartedDownload(downloadId, {
              url: _state.info.url,
              pageUrl: _state.info.pageUrl,
              filename: finalFullPath || "_",
              conflictAction: options.conflictAction,
              viaFetch,
              retried: false,
              historyEntryId,
              adopted: true,
            });
            // Bind the download id to the history entry now so the options page
            // can poll its progress while it is still downloading
            if (typeof SaveHistory !== "undefined" && historyEntryId) {
              SaveHistory.setDownloadId(historyEntryId, downloadId);
            }
            return remembered;
          })
          .catch((e) => {
            // e.g. Firefox rejects data: URLs in downloads.download
            if (typeof Log !== "undefined") {
              Log.add("downloads.download failed", String(e));
            }
            // Immediate rejections also get one fetch-fallback attempt; once the
            // fallback is exhausted (or disabled), tell the user rather than
            // failing silently — onDownloadChanged never fires for a download
            // that was never created
            if (!viaFetch && options.fallbackFetch !== false) {
              fetchDownload(_state.info.url);
            } else {
              Notifier.reportFailure(finalFullPath || _state.info.url, String(e));
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
        // Chrome MV3: fetch + createObjectURL in an offscreen document so large
        // files aren't base64-buffered into a data URL (which also has a size cap)
        if (Download.canUseOffscreen()) {
          Download.fetchViaOffscreen(_url)
            .then((blobUrl) => browserDownload(blobUrl, true))
            .catch((e) => {
              if (typeof Log !== "undefined") {
                Log.add("offscreen fetch failed", String(e));
              }
              browserDownload(_url, true);
            });
          return;
        }

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

      const normalDownload = () => {
        if (options.fetchViaFetch) {
          fetchDownload(_state.info.url);
        } else {
          browserDownload(_state.info.url);
        }
      };

      // A :sha256: (or other content) variable already fetched the whole file
      // to hash it; reuse that one fetch's download URL instead of fetching the
      // file a second time to save it. Falls back to the normal path if the
      // shared fetch failed (contentPromise resolved to null).
      if (_state.info.contentPromise) {
        _state.info.contentPromise.then((content) => {
          if (content && content.downloadUrl) {
            browserDownload(content.downloadUrl, true);
          } else {
            normalDownload();
          }
        });
      } else {
        normalDownload();
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

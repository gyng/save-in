/* eslint-disable no-unused-vars */

let globalChromeState = {};

const Download = {
  DISPOSITION_FILENAME_REGEX:
    /filename[^;=\n]*=((['"])(.*)?\2|(.+'')?([^;\n]*))/i,
  EXTENSION_REGEX: /\.([0-9a-z]{1,8})$/i,

  makeObjectUrl: (content, mime = "text/plain") => {
    if (typeof URL.createObjectURL === "function") {
      return URL.createObjectURL(
        new Blob([content], {
          type: `${mime};charset=utf-8`,
        })
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
        binary += String.fromCharCode.apply(
          null,
          bytes.subarray(i, i + chunkSize)
        );
      }
      const mime = blob.type || "application/octet-stream";
      return `data:${mime};base64,${btoa(binary)}`;
    });
  },

  getFilenameFromUrl: (url) => {
    const remotePath = new URL(url).pathname;
    return decodeURIComponent(
      remotePath.substring(remotePath.lastIndexOf("/") + 1)
    );
  },

  finalizeFullPath: (_state) => {
    const finalDir = _state.path.finalize();
    const finalFilename = _state.route
      ? _state.route.finalize()
      : Path.sanitizeFilename(_state.info.filename);
    const finalFullPath = [finalDir, finalFilename]
      .filter((x) => x != null)
      .join("/");

    return finalFullPath.replace(/^\.\//, "").replace(/^\//, "");
  },

  getFilenameFromContentDisposition: (disposition) => {
    if (typeof disposition !== "string") return null;

    const filenameFromLib =
      getFilenameFromContentDispositionHeader(disposition);

    if (filenameFromLib) {
      return decodeURIComponent(decodeURIComponent(filenameFromLib));
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

  renameAndDownload: (state) => {
    const naiveFilename = Download.getFilenameFromUrl(state.info.url);
    const initialFilename =
      state.info.suggestedFilename || naiveFilename || state.info.url;

    Object.assign(state.info, {
      naiveFilename,
      filename: initialFilename,
      initialFilename,
    });

    state.path = Variable.applyVariables(state.path, state.info);
    // FIXME: Fix router params for new path struct
    const routeMatches = Download.getRoutingMatches(state);
    if (routeMatches) {
      state.route = Variable.applyVariables(
        new Path.Path(routeMatches),
        state.info
      );
    }

    if (
      typeof state.needRouteMatch !== "undefined" &&
      state.needRouteMatch &&
      !routeMatches
    ) {
      return;
    }

    const download = (_state) => {
      const finalFullPath = Download.finalizeFullPath(_state);

      if (typeof Log !== "undefined") {
        Log.add("download requested", {
          url: _state.info.url && String(_state.info.url).slice(0, 200),
          path: finalFullPath,
          route: _state.route ? String(_state.route.finalize()) : null,
        });
      }

      if (window.SI_DEBUG) {
        console.log(state, finalFullPath); // eslint-disable-line
      }

      _state.scratch.hasExtension =
        finalFullPath && finalFullPath.match(Download.EXTENSION_REGEX);
      const noExtensionPrompt =
        options.promptIfNoExtension && !_state.scratch.hasExtension;
      const shiftHeldPrompt =
        options.promptOnShift &&
        _state.info.modifiers &&
        typeof _state.info.modifiers.find((m) => m === "Shift") !== "undefined";
      const noRuleMatchedPrompt = options.routeFailurePrompt && !state.route;

      const prompt =
        options.prompt ||
        noExtensionPrompt ||
        shiftHeldPrompt ||
        noRuleMatchedPrompt;

      const browserDownload = (_url) =>
        Headers.prepareReferer(_state)
          .then(() =>
            // Persist before calling the downloads API so notification
            // tracking and onDeterminingFilename survive an MV3 service
            // worker restart mid-download
            SessionState.set({
              siPendingDownload: true,
              siFinalFilename: finalFullPath || "_",
            })
          )
          .then(() =>
            browser.downloads.download({
              url: _url,
              filename: finalFullPath || "_",
              saveAs: prompt,
              conflictAction: options.conflictAction,
            })
          )
          .then((downloadId) => Notification.trackDownload(downloadId))
          .catch(() => {})
          .then(() => SessionState.set({ siPendingDownload: false }));

      const fetchDownload = (_url) => {
        fetch(_url)
          .then((response) => response.blob())
          .then((myBlob) => Download.makeUrlFromBlob(myBlob))
          .then((blobUrl) => browserDownload(blobUrl));
      };

      if (options.fetchViaContent) {
        Messaging.send
          .fetchViaContent(_state)
          .then((res) =>
            // Object URL has to be created inside the background script
            Download.makeUrlFromBlob(res.body.blob).then((blobUrl) =>
              browserDownload(blobUrl)
            )
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
      SaveHistory.add({
        timestamp: new Date().toISOString(),
        url: _state.info.url,
        finalFullPath,
        state: _state,
      });
    };

    // Chrome: Skip HEAD request for Content-Disposition and use onDeterminingFilename
    if (
      CURRENT_BROWSER === BROWSERS.CHROME &&
      chrome.downloads &&
      chrome.downloads.onDeterminingFilename
    ) {
      globalChromeState = state;
      download(state);
    } else {
      // Set globalChromeState as well for headers
      globalChromeState = state;
      fetch(state.info.url, { method: "HEAD", credentials: "include" })
        .then((res) => {
          if (res.headers.has("Content-Disposition")) {
            const disposition = res.headers.get("Content-Disposition");
            const dispositionName =
              Download.getFilenameFromContentDisposition(disposition);
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
        Notification.createExtensionNotification(
          browser.i18n.getMessage("notificationRuleMatchedTitle"),
          `${state.info.initialFilename}\n⬇\n${state.route}`,
          false
        );
      }
    } else if (options.routeExclusive && options.notifyOnFailure) {
      Notification.createExtensionNotification(
        browser.i18n.getMessage("notificationRuleMatchFailedExclusiveTitle"),
        browser.i18n.getMessage("notificationRuleMatchFailedExclusiveMessage", [
          state.info.url,
        ]),
        true
      );
    }
  },
};

if (chrome && chrome.downloads && chrome.downloads.onDeterminingFilename) {
  chrome.downloads.onDeterminingFilename.addListener(
    (downloadItem, suggest) => {
      // Don't interfere with other extensions
      if (
        !browser.runtime ||
        browser.runtime.id !== downloadItem.byExtensionId
      ) {
        return false;
      }

      // In-memory state is lost if the MV3 service worker restarted between
      // requesting the download and this event: recover the persisted filename
      if (!globalChromeState || !globalChromeState.path) {
        SessionState.get("siFinalFilename").then((res) => {
          if (res.siFinalFilename) {
            suggest({
              filename: res.siFinalFilename,
              conflictAction: options.conflictAction,
            });
          } else {
            suggest();
          }
        });
        return true; // suggest is called asynchronously
      }

      globalChromeState.info = globalChromeState.info || {};
      globalChromeState.info.filename =
        (globalChromeState.info && globalChromeState.info.suggestedFilename) ||
        downloadItem.filename ||
        (globalChromeState.info && globalChromeState.info.filename);

      suggest({
        filename: Download.finalizeFullPath(globalChromeState),
        conflictAction: options.conflictAction,
      });
      return false;
    }
  );
}

// Export for testing
if (typeof module !== "undefined") {
  module.exports = Download;
}

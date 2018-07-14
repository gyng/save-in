/* eslint-disable no-unused-vars */

let globalChromeState = {};

const Download = {
  DISPOSITION_FILENAME_REGEX: /filename[^;=\n]*=((['"])(.*)?\2|(.+'')?([^;\n]*))/i,
  EXTENSION_REGEX: /\.([0-9a-z]{1,8})$/i,

  makeObjectUrl: (content, mime = "text/plain") =>
    URL.createObjectURL(
      new Blob([content], {
        type: `${mime};charset=utf-8`
      })
    ),

  getFilenameFromUrl: url => {
    const remotePath = new URL(url).pathname;
    return decodeURIComponent(
      remotePath.substring(remotePath.lastIndexOf("/") + 1)
    );
  },

  finalizeFullPath: _state => {
    const finalDir = _state.path.finalize();
    const finalFilename = _state.route
      ? _state.route.finalize()
      : Path.sanitizeFilename(_state.info.filename);
    const finalFullPath = [finalDir, finalFilename]
      .filter(x => x != null)
      .join("/");

    return finalFullPath.replace(/^\.\//, "");
  },

  getFilenameFromContentDisposition: disposition => {
    if (typeof disposition !== "string") return null;

    const filenameFromLib = getFilenameFromContentDispositionHeader(
      disposition
    );

    if (filenameFromLib) {
      return decodeURIComponent(decodeURIComponent(filenameFromLib));
    }

    return null;
  },

  getRoutingMatches: state => {
    const filenamePatterns = options.filenamePatterns;
    const downloadInfo = state.info.legacyDownloadInfo;

    if (!filenamePatterns || filenamePatterns.length === 0) {
      return null;
    }

    return Router.matchRules(
      filenamePatterns,
      state.info.legacyDownloadInfo,
      state.info
    );
  },

  renameAndDownload: state => {
    const naiveFilename = Download.getFilenameFromUrl(state.info.url);
    const initialFilename =
      state.info.suggestedFilename || naiveFilename || state.info.url;

    Object.assign(state.info, {
      naiveFilename,
      filename: initialFilename,
      initialFilename
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

    const download = _state => {
      const finalFullPath = Download.finalizeFullPath(_state);

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
        typeof _state.info.modifiers.find(m => m === "Shift") !== "undefined";
      const noRuleMatchedPrompt = options.routeFailurePrompt && !state.route;

      const prompt =
        options.prompt ||
        noExtensionPrompt ||
        shiftHeldPrompt ||
        noRuleMatchedPrompt;

      const browserDownload = _url => {
        browser.downloads.download({
          url: _url,
          filename: finalFullPath || "_",
          saveAs: prompt,
          conflictAction: options.conflictAction
        });
      };

      if (options.fetchViaContent) {
        Messaging.send
          .fetchViaContent(_state)
          .then(res => {
            // Object URL has to be created inside the background script
            const objectUrl = URL.createObjectURL(res.body.blob);
            return browserDownload(objectUrl);
          })
          .catch(e => {
            if (window.SI_DEBUG) {
              console.log("Failed to fetch via content", e); // eslint-disable-line
            }
            browserDownload(_state.info.url);
          });
      } else {
        browserDownload(_state.info.url);
      }

      Messaging.emit.downloaded(_state);
      window.lastDownloadState = _state;
    };

    // Chrome: Skip HEAD request for Content-Disposition and use onDeterminingFilename
    if (
      browser === chrome &&
      chrome.downloads &&
      chrome.downloads.onDeterminingFilename
    ) {
      globalChromeState = state;
      download(state);
    } else {
      fetch(state.info.url, { method: "HEAD" })
        .then(res => {
          if (res.headers.has("Content-Disposition")) {
            const disposition = res.headers.get("Content-Disposition");
            const dispositionName = Download.getFilenameFromContentDisposition(
              disposition
            );
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
          state.info.url
        ]),
        true
      );
    }
  }
};

if (chrome && chrome.downloads && chrome.downloads.onDeterminingFilename) {
  chrome.downloads.onDeterminingFilename.addListener(
    (downloadItem, suggest) => {
      globalChromeState.info = globalChromeState.info || {};
      globalChromeState.info.filename =
        (globalChromeState.info && globalChromeState.info.suggestedFilename) ||
        downloadItem.filename ||
        (globalChromeState.info && globalChromeState.info.filename);
      suggest({
        filename: Download.finalizeFullPath(globalChromeState),
        conflictAction: options.conflictAction
      });
    }
  );
}

// Export for testing
if (typeof module !== "undefined") {
  module.exports = Download;
}

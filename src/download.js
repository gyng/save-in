/* eslint-disable no-unused-vars */

const globalChromeState = {};

const Downloads = {
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
      : Paths.sanitizeFilename(_state.info.filename);
    const finalFullPath = [finalDir, finalFilename]
      .filter(x => x != null)
      .join("/");

    return finalFullPath.replace(/^\.\//, "");
  },

  getFilenameFromContentDisposition: disposition => {
    if (typeof disposition !== "string") return null;

    const matches = disposition.match(Downloads.DISPOSITION_FILENAME_REGEX);

    if (matches && matches.length >= 3) {
      // First decode utf8
      // And then decode once more for any URI-encoded headers
      const filteredMatches = matches.filter(m => m != null);
      const match = filteredMatches[filteredMatches.length - 1];
      let filename = decodeURIComponent(decodeURIComponent(escape(match)));

      // Wrapped in quotation marks
      if (filename[0] && filename[filename.length - 1] === '"') {
        filename = filename.slice(1, -1);
      }

      filename = Paths.sanitizeFilename(filename);

      return filename;
    }

    return null;
  },

  getRoutingMatches: state => {
    const filenamePatterns = options.filenamePatterns;
    const downloadInfo = state.info.legacyDownloadInfo;

    if (!filenamePatterns || filenamePatterns.length === 0) {
      return null;
    }

    return matchRules(
      filenamePatterns,
      state.info.legacyDownloadInfo,
      state.info
    );
  },

  renameAndDownload: state => {
    const naiveFilename = Downloads.getFilenameFromUrl(state.info.url);
    const initialFilename =
      state.info.suggestedFilename || naiveFilename || state.info.url;

    Object.assign(state.info, {
      naiveFilename,
      filename: initialFilename,
      initialFilename
    });

    state.path = Variables.applyVariables(state.path, state.info);

    // FIXME: Fix router params for new path struct
    const routeMatches = Downloads.getRoutingMatches(state);
    if (routeMatches) {
      state.route = Variables.applyVariables(
        new Paths.Path(routeMatches),
        state.info
      );
    }

    const download = _state => {
      const finalFullPath = Downloads.finalizeFullPath(_state);

      if (window.SI_DEBUG) {
        console.log(state, finalFullPath); // eslint-disable-line
      }

      _state.scratch.hasExtension =
        routeMatches && routeMatches.match(Downloads.EXTENSION_REGEX);

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

      browser.downloads.download({
        url: _state.info.url,
        filename: finalFullPath || "_",
        saveAs: prompt,
        conflictAction: options.conflictAction
      });

      Messenging.emit.downloaded(_state);
      window.lastDownloadState = _state;
    };

    // Chrome: Skip HEAD request for Content-Disposition and use onDeterminingFilename
    if (
      browser === chrome &&
      chrome.downloads &&
      chrome.downloads.onDeterminingFilename
    ) {
      download(state);
    } else {
      fetch(state.info.url, { method: "HEAD" })
        .then(res => {
          if (res.headers.has("Content-Disposition")) {
            const disposition = res.headers.get("Content-Disposition");
            const dispositionName = Downloads.getFilenameFromContentDisposition(
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
        createExtensionNotification(
          "Save In: Rule matched",
          `${state.info.initialFilename}\n⬇\n${state.route}`,
          false
        );
      }
    } else if (options.routeExclusive && options.notifyOnFailure) {
      createExtensionNotification(
        "Save In: Failed to route or rename download",
        `No matching rule found for ${state.info.url}`,
        true
      );
    }
  }
};

if (chrome && chrome.downloads && chrome.downloads.onDeterminingFilename) {
  chrome.downloads.onDeterminingFilename.addListener(
    (downloadItem, suggest) => {
      globalChromeState.info.filename =
        globalChromeState.info.suggestedFilename ||
        downloadItem.filename ||
        globalChromeState.info.filename;
      suggest({
        filename: Downloads.finalizeFullPath(globalChromeState),
        conflictAction: options.conflictAction
      });
    }
  );
}

// Export for testing
if (typeof module !== "undefined") {
  module.exports = Downloads;
}

/* eslint-disable no-unused-vars */

const DISPOSITION_FILENAME_REGEX = /filename[^;=\n]*=((['"])(.*)?\2|(.+'')?([^;\n]*))/i;
const EXTENSION_REGEX = /\.([0-9a-z]{1,8})$/i;
const SPECIAL_CHARACTERS_REGEX = /[<>:"/\\|?*\0]/g;
const BAD_LEADING_CHARACTERS = /^[./\\]/g;
const SEPARATOR_REGEX = /[/\\]/g;

const makeObjectUrl = (content, mime = "text/plain") =>
  URL.createObjectURL(
    new Blob([content], {
      type: `${mime};charset=utf-8`
    })
  );

// WIP: Remove
const sanitizePath = (pathStr, maxComponentLength = 0) =>
  pathStr &&
  pathStr
    .split(SEPARATOR_REGEX)
    .map(s => sanitizeFilename(s, maxComponentLength))
    .join("/");

const getFilenameFromUrl = url => {
  const remotePath = new URL(url).pathname;
  return decodeURIComponent(
    remotePath.substring(remotePath.lastIndexOf("/") + 1)
  );
};

const finalizeFullPath = _state => {
  const finalDir = finalizeToString(_state.path);
  const finalMatch = _state.route ? finalizeToString(_state.route) : null;
  const finalFilename = sanitizeFilename(_state.info.filename);
  const finalFullPath = [finalDir, finalMatch, finalFilename]
    .filter(x => x != null)
    .join("/");

  return finalFullPath;
};

const getFilenameFromContentDisposition = disposition => {
  if (typeof disposition !== "string") return null;

  const matches = disposition.match(DISPOSITION_FILENAME_REGEX);

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

    filename = sanitizeFilename(filename);

    return filename;
  }

  return null;
};

// Used for validation
// const removeSpecialDirs = path => {
//   let ret = path;
//   Object.keys(SPECIAL_DIRS).forEach(v => {
//     ret = ret.replace(SPECIAL_DIRS[v], "");
//   });
//   return ret;
// };

const getRoutingMatches = state => {
  const filenamePatterns = state.info.filenamePatterns;
  const downloadInfo = state.info.legacyDownloadInfo;

  if (!filenamePatterns || filenamePatterns.length === 0) {
    return null;
  }

  return matchRules(
    filenamePatterns,
    state.info.legacyDownloadInfo,
    state.info
  );
};

let globalChromeState = {};
if (chrome && chrome.downloads && chrome.downloads.onDeterminingFilename) {
  chrome.downloads.onDeterminingFilename.addListener(
    (downloadItem, suggest) => {
      globalChromeState.info.filename =
        globalChromeState.info.suggestedFilename ||
        downloadItem.filename ||
        globalChromeState.info.filename;
      suggest({
        filename: finalizeFullPath(globalChromeState),
        conflictAction: options.conflictAction
      });
    }
  );
}

const renameAndDownload = state => {
  const naiveFilename = getFilenameFromUrl(state.info.url);
  const initialFilename =
    state.info.suggestedFilename || naiveFilename || state.info.url;

  Object.assign(state.info, {
    naiveFilename,
    filename: initialFilename,
    initialFilename
  });

  state.path = applyVariables(state.path, state.info);

  // FIXME: Fix router params for new path struct
  const routeMatches = getRoutingMatches(state);
  if (routeMatches) {
    state.route = applyVariables(new Path(routeMatches), state.info);
  } else {
    state.scratch.prompt = options.prompt || options.routeFailurePrompt;
  }

  const download = _state => {
    const finalFullPath = finalizeFullPath(_state);

    _state.scratch.hasExtension =
      routeMatches && routeMatches.match(EXTENSION_REGEX);

    const prompt =
      _state.info.prompt ||
      (options.promptIfNoExtension && !_state.scratch.hasExtension) ||
      (options.promptOnShift &&
        _state.info.modifiers &&
        typeof _state.info.modifiers.find(m => m === "Shift") !== "undefined");

    console.log(_state, "x", finalFullPath);

    browser.downloads.download({
      url: _state.info.url,
      filename: finalFullPath || "_",
      saveAs: prompt,
      conflictAction: options.conflictAction
    });

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
          const dispositionName = getFilenameFromContentDisposition(
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
};

// Export for testing
if (typeof module !== "undefined") {
  module.exports = {
    replaceFsBadChars,
    sanitizePath,
    truncateIfLongerThan,
    getFilenameFromUrl,
    getFilenameFromContentDisposition,
    replaceSpecialDirs,
    getRoutingMatches,
    makeObjectUrl,
    removeSpecialDirs,
    DISPOSITION_FILENAME_REGEX,
    EXTENSION_REGEX,
    SPECIAL_CHARACTERS_REGEX
  };
}

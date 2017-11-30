/* eslint-disable no-unused-vars */

const DISPOSITION_FILENAME_REGEX = /filename[^;=\n]*=((['"])(.*)?\2|(.+'')?([^;\n]*))/i;
const EXTENSION_REGEX = /\.([0-9a-z]{1,8})$/i;
const SPECIAL_CHARACTERS_REGEX = /[~<>:"/\\|?*\0]/g;
const BAD_LEADING_CHARACTERS = /^[./\\]/g;

const makeObjectUrl = (content, mime = "text/plain") =>
  URL.createObjectURL(
    new Blob([content], {
      type: `${mime};charset=utf-8`
    })
  );

// TODO: Make this OS-aware instead of assuming Windows
const replaceFsBadChars = s => s.replace(SPECIAL_CHARACTERS_REGEX, "_");
// Leading dots are considered invalid by both Firefox and Chrome
const replaceLeadingDots = s => s.replace(BAD_LEADING_CHARACTERS, "");

const truncateIfLongerThan = (str, max) =>
  str && max > 0 && str.length > max ? str.substr(0, max) : str;

const sanitizePath = (pathStr, maxComponentLength = 0) =>
  pathStr
    .split(new RegExp("[\\/\\\\]", "g"))
    .map(replaceFsBadChars)
    .map(replaceLeadingDots)
    .map(c => truncateIfLongerThan(c, maxComponentLength))
    .join("/");

const getFilenameFromUrl = url => {
  const remotePath = new URL(url).pathname;
  return decodeURIComponent(
    remotePath.substring(remotePath.lastIndexOf("/") + 1)
  );
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

    if (filename[0] && filename[filename.length - 1] === '"') {
      filename = filename.slice(1, -1);
    }

    return filename;
  }

  return null;
};

// Handles SPECIAL_DIRS except FILENAME and SEPARATOR
const replaceSpecialDirs = (path, url, info) => {
  if (window.SI_DEBUG) {
    console.log("replaceSpecialDirs", path, url, info); // eslint-disable-line
  }

  let ret = path;

  try {
    ret = ret.replace(SPECIAL_DIRS.SOURCE_DOMAIN, new URL(url).hostname);
  } catch (e) {
    if (window.SI_DEBUG) {
      console.log("Bad url", url, e); // eslint-disable-line
    }
  }

  try {
    ret = ret.replace(SPECIAL_DIRS.PAGE_DOMAIN, new URL(info.pageUrl).hostname);
  } catch (e) {
    if (window.SI_DEBUG) {
      console.log("Bad page url", url, e); // eslint-disable-line
    }
  }

  ret = ret.replace(SPECIAL_DIRS.PAGE_URL, replaceFsBadChars(info.pageUrl));
  ret = ret.replace(SPECIAL_DIRS.SOURCE_URL, replaceFsBadChars(info.srcUrl));
  const now = new Date();

  const padDateComponent = (num, func) => num.toString().padStart(2, "0");

  const date = [
    now.getFullYear(),
    padDateComponent(now.getMonth() + 1),
    padDateComponent(now.getDate())
  ].join("-");
  ret = ret.replace(SPECIAL_DIRS.DATE, date);

  const isodate = [
    now.getUTCFullYear(),
    padDateComponent(now.getUTCMonth() + 1),
    padDateComponent(now.getUTCDate()),
    "T",
    padDateComponent(now.getUTCHours()),
    padDateComponent(now.getUTCMinutes()),
    padDateComponent(now.getUTCSeconds()),
    "Z"
  ].join("");

  ret = ret.replace(SPECIAL_DIRS.ISO8601_DATE, isodate);
  ret = ret.replace(SPECIAL_DIRS.UNIX_DATE, Date.parse(now) / 1000);

  ret = ret.replace(SPECIAL_DIRS.YEAR, now.getFullYear());
  ret = ret.replace(SPECIAL_DIRS.MONTH, padDateComponent(now.getMonth() + 1));
  ret = ret.replace(SPECIAL_DIRS.DAY, padDateComponent(now.getDate()));
  ret = ret.replace(SPECIAL_DIRS.HOUR, padDateComponent(now.getHours()));
  ret = ret.replace(SPECIAL_DIRS.MINUTE, padDateComponent(now.getMinutes()));
  ret = ret.replace(SPECIAL_DIRS.SECOND, padDateComponent(now.getSeconds()));

  ret = ret.replace(
    SPECIAL_DIRS.PAGE_TITLE,
    (currentTab && currentTab.title) || ""
  );

  ret = ret.replace(SPECIAL_DIRS.LINK_TEXT, info.linkText);

  return ret;
};

// Handles rewriting FILENAME and regex captures
const rewriteFilename = (filename, filenamePatterns, info, url) => {
  // Clauses (matchers)
  if (!filenamePatterns || filenamePatterns.length === 0 || !info) {
    return filename;
  }

  const matchFile = matchRules(filenamePatterns, info, filename);

  // Didn't get any matches, abort!
  if (!matchFile) {
    return matchFile;
  }

  // Variables
  let ret = matchFile.replace(SPECIAL_DIRS.FILENAME, filename);
  ret = ret.replace(SPECIAL_DIRS.LINK_TEXT, info.linkText);
  const fileExtensionMatches = filename.match(EXTENSION_REGEX);
  const fileExtension = (fileExtensionMatches && fileExtensionMatches[1]) || "";
  ret = ret.replace(SPECIAL_DIRS.FILE_EXTENSION, fileExtension);
  ret = replaceSpecialDirs(ret, url, info);

  if (window.SI_DEBUG) {
    console.log("matchfile", matchFile, ret, filenamePatterns, info); // eslint-disable-line
  }

  return ret;
};

// CHROME
// Chrome has a nice API for this. Migrate to this once it's available on Firefox, since
// we wont't have to fire off another HEAD just to get Content-Disposition.
let globalChromeRewriteOptions = {}; // global variable: no other easy way around this
if (chrome && chrome.downloads && chrome.downloads.onDeterminingFilename) {
  chrome.downloads.onDeterminingFilename.addListener(
    (downloadItem, suggest) => {
      const rewrittenFilename = rewriteFilename(
        globalChromeRewriteOptions.suggestedFilename || downloadItem.filename,
        globalChromeRewriteOptions.filenamePatterns,
        globalChromeRewriteOptions.info,
        globalChromeRewriteOptions.url
      );

      suggest({
        filename: `${globalChromeRewriteOptions.path}/${replaceFsBadChars(
          rewrittenFilename
        )}`,
        conflictAction: globalChromeRewriteOptions.conflictAction
      });
    }
  );
}

const downloadInto = (path, url, info, options, suggestedFilename) => {
  // Make bug reports easier
  /* eslint-disable no-console */
  if (window.SI_DEBUG) {
    console.log("downloadInto path", path);
    console.log("downloadInto url", url);
    console.log("downloadInto info", info);
    console.log("downloadInto options", options);
    console.log("downloadInto suggestedFilename", suggestedFilename);
  }
  /* eslint-enable no-console */

  const {
    filenamePatterns,
    promptIfNoExtension,
    conflictAction,
    truncateLength,
    routeExclusive
  } = options;
  let prompt = options.prompt;

  const download = (filename, rewrite = true) => {
    let rewrittenFilename = rewrite
      ? rewriteFilename(
          suggestedFilename || filename,
          filenamePatterns,
          info,
          url
        )
      : suggestedFilename || filename;

    if (routeExclusive) {
      if (!rewrittenFilename) {
        if (options.routeFailurePrompt) {
          prompt = true;
        } else if (options.notifyOnFailure) {
          createExtensionNotification(
            "Save In: Failed to route or rename download",
            `No matching rule found for ${url}`,
            true,
            options
          );
        } else {
          return;
        }
      }
    }

    // If no filename rewrites matched, fall back to filename
    rewrittenFilename = rewrittenFilename || suggestedFilename || filename;

    const hasExtension =
      rewrittenFilename && rewrittenFilename.match(EXTENSION_REGEX);

    const fsSafeDirectory = sanitizePath(
      path.replace(/^\.[\\/\\\\]?/, ""),
      truncateLength
    );
    const fsSafeFilename = sanitizePath(rewrittenFilename, truncateLength);

    const fsSafePath = fsSafeDirectory
      ? [fsSafeDirectory, fsSafeFilename].join("/")
      : fsSafeFilename;

    if (window.SI_DEBUG) {
      /* eslint-disable no-console */
      console.log("download filename", filename);
      console.log("download suggestedFilename", suggestedFilename);
      console.log("download rewrittenFilename", rewrittenFilename);
      console.log("download fsSafeDirectory", fsSafeDirectory);
      console.log("download fsSafeFilename", fsSafeFilename);
      console.log("download fsSafePath", fsSafePath);
      console.log("download conflictAction", conflictAction);
      console.log("download prompt", prompt);
      /* eslint-enable no-console */
    }

    // conflictAction is Chrome only and overridden in onDeterminingFilename, Firefox enforced in settings
    browser.downloads.download({
      url,
      filename: fsSafePath,
      saveAs: prompt || (promptIfNoExtension && !hasExtension),
      conflictAction
    });
  };

  // CHROME
  if (
    browser === chrome &&
    chrome.downloads &&
    chrome.downloads.onDeterminingFilename
  ) {
    globalChromeRewriteOptions = {
      path,
      filenamePatterns,
      suggestedFilename,
      url,
      info,
      truncateLength,
      conflictAction
    };

    download(url, false); // Will be rewritten inside Chrome event listener
    return;
  }

  const urlFilename = getFilenameFromUrl(url);

  fetch(url, { method: "HEAD" })
    .then(res => {
      if (res.headers.has("Content-Disposition")) {
        const disposition = res.headers.get("Content-Disposition");
        const filename =
          getFilenameFromContentDisposition(disposition) || urlFilename;
        download(filename);
      } else {
        download(urlFilename || url);
      }
    })
    .catch(() => {
      // HEAD rejected for whatever reason: try to download anyway
      download(urlFilename);
    });
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
    rewriteFilename,
    makeObjectUrl,
    DISPOSITION_FILENAME_REGEX,
    EXTENSION_REGEX,
    SPECIAL_CHARACTERS_REGEX
  };
}

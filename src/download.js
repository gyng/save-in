/* eslint-disable no-unused-vars */

const DISPOSITION_FILENAME_REGEX = /filename[^;=\n]*=((['"])(.*)?\2|(.+'')?([^;\n]*))/i;
const EXTENSION_REGEX = /\.([0-9a-z]{1,8})$/i;
const SPECIAL_CHARACTERS_REGEX = /[~<>:"/\\|?*\0]/g;

const makeObjectUrl = (content, mime = "text/plain") =>
  URL.createObjectURL(
    new Blob([content], {
      type: `${mime};charset=utf-8`
    })
  );

// TODO: Make this OS-aware instead of assuming Windows
const replaceFsBadChars = s => s.replace(SPECIAL_CHARACTERS_REGEX, "_");
const replaceFsBadCharsInPath = pathStr =>
  pathStr
    .split(new RegExp("[\\/\\\\]", "g"))
    .map(replaceFsBadChars)
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

  ret = ret.replace(SPECIAL_DIRS.SOURCE_DOMAIN, new URL(url).hostname);
  ret = ret.replace(SPECIAL_DIRS.PAGE_DOMAIN, new URL(info.pageUrl).hostname);
  ret = ret.replace(SPECIAL_DIRS.PAGE_URL, replaceFsBadChars(info.pageUrl));
  const now = new Date();

  const date = [
    now.getFullYear(),
    (now.getMonth() + 1).toString().padStart(2, "0"),
    now
      .getDate()
      .toString()
      .padStart(2, "0")
  ].join("-");
  ret = ret.replace(SPECIAL_DIRS.DATE, date);

  const isodate = [
    now.getUTCFullYear(),
    (now.getUTCMonth() + 1).toString().padStart(2, "0"),
    now
      .getUTCDate()
      .toString()
      .padStart(2, "0"),
    "T",
    now
      .getUTCHours()
      .toString()
      .padStart(2, "0"),
    now
      .getUTCMinutes()
      .toString()
      .padStart(2, "0"),
    now
      .getUTCSeconds()
      .toString()
      .padStart(2, "0"),
    "Z"
  ].join("");

  ret = ret.replace(SPECIAL_DIRS.ISO8601_DATE, isodate);
  ret = ret.replace(SPECIAL_DIRS.UNIX_DATE, Date.parse(now) / 1000);

  ret = ret.replace(SPECIAL_DIRS.YEAR, now.getFullYear());
  ret = ret.replace(
    SPECIAL_DIRS.MONTH,
    (now.getMonth() + 1).toString().padStart(2, "0")
  );
  ret = ret.replace(
    SPECIAL_DIRS.DAY,
    now
      .getDate()
      .toString()
      .padStart(2, "0")
  );
  ret = ret.replace(
    SPECIAL_DIRS.HOUR,
    now
      .getHours()
      .toString()
      .padStart(2, "0")
  );
  ret = ret.replace(
    SPECIAL_DIRS.MINUTE,
    now
      .getMinutes()
      .toString()
      .padStart(2, "0")
  );
  ret = ret.replace(
    SPECIAL_DIRS.SECOND,
    now
      .getSeconds()
      .toString()
      .padStart(2, "0")
  );

  ret = ret.replace(
    SPECIAL_DIRS.PAGE_TITLE,
    (currentTab && currentTab.title) || ""
  );

  ret = ret.replace(SPECIAL_DIRS.LINK_TEXT, info.linkText);

  return ret;
};

// Handles rewriting FILENAME and regex captures
const rewriteFilename = (filename, filenamePatterns, url, info) => {
  if (!filenamePatterns || !url || !info) {
    return filename;
  }

  for (let i = 0; i < filenamePatterns.length; i += 1) {
    const p = filenamePatterns[i];
    const matches = p.filenameMatch.exec(filename);

    if (matches && url.match(p.urlMatch)) {
      let ret = p.replace.replace(SPECIAL_DIRS.FILENAME, filename);
      ret = ret.replace(SPECIAL_DIRS.LINK_TEXT, info.linkText);

      const fileExtensionMatches = filename.match(EXTENSION_REGEX);
      const fileExtension =
        (fileExtensionMatches && fileExtensionMatches[1]) || "";
      ret = ret.replace(SPECIAL_DIRS.FILE_EXTENSION, fileExtension);

      // Replace capture groups
      for (let j = 0; j < matches.length; j += 1) {
        ret = ret.split(`:$${j}:`).join(matches[j]);
      }

      ret = replaceSpecialDirs(ret, url, info);

      return ret;
    }
  }

  return filename;
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
        globalChromeRewriteOptions.url,
        globalChromeRewriteOptions.info
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
  }
  /* eslint-enable no-console */

  const {
    filenamePatterns,
    prompt,
    promptIfNoExtension,
    conflictAction
  } = options;

  const download = (filename, rewrite = true) => {
    const rewrittenFilename = rewrite
      ? rewriteFilename(
          suggestedFilename || filename,
          filenamePatterns,
          url,
          info
        )
      : suggestedFilename || filename;

    const hasExtension = rewrittenFilename.match(EXTENSION_REGEX);

    let fsSafeDirectory = replaceFsBadCharsInPath(path);
    const fsSafeFilename = replaceFsBadChars(rewrittenFilename);

    // https://github.com/gyng/save-in/issues/7
    // Firefox doesn't like saving into the default directory "./filename"
    // since 58a
    fsSafeDirectory = fsSafeDirectory.replace(/^\.[\\/\\\\]?/, "");
    const fsSafePath = fsSafeDirectory
      ? [fsSafeDirectory, fsSafeFilename].join("/")
      : fsSafeFilename;

    if (window.SI_DEBUG) {
      console.log("downloadInto filename", filename); // eslint-disable-line
      console.log("downloadInto fsSafeDirectory", fsSafeDirectory); // eslint-disable-line
      console.log("downloadInto fsSafeFilename", fsSafeFilename); // eslint-disable-line
      console.log("downloadInto fsSafePath", fsSafePath); // eslint-disable-line
      console.log("downloadInto conflictAction", conflictAction); // eslint-disable-line
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
    replaceFsBadCharsInPath,
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

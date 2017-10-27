/* eslint-disable no-unused-vars */

const DISPOSITION_FILENAME_REGEX = /filename[^;=\n]*=((['"])(.*)?\2|(.+'')?([^;\n]*))/i;

// TODO: Make this OS-aware instead of assuming Windows
const replaceFsBadChars = s => s.replace(/[<>:"/\\|?*\0]/g, "_");

const getFilenameFromUrl = url => {
  const remotePath = new URL(url).pathname;
  return decodeURIComponent(
    replaceFsBadChars(remotePath.substring(remotePath.lastIndexOf("/") + 1))
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
  let ret = path;

  ret = ret.replace(
    SPECIAL_DIRS.SOURCE_DOMAIN,
    replaceFsBadChars(new URL(url).hostname)
  );
  ret = ret.replace(
    SPECIAL_DIRS.PAGE_DOMAIN,
    replaceFsBadChars(new URL(info.pageUrl).hostname)
  );
  ret = ret.replace(SPECIAL_DIRS.PAGE_URL, replaceFsBadChars(info.pageUrl));
  const now = new Date();
  const formattedDate = `${now.getFullYear()}-${now.getMonth() +
    1}-${now.getDate()}`;
  ret = ret.replace(SPECIAL_DIRS.DATE, formattedDate);

  return ret;
};

// Handles rewriting FILENAME and regex captures
const rewriteFilename = (filename, patterns, url, info) => {
  if (!patterns || !url || !info) {
    return filename;
  }

  for (let i = 0; i < patterns.length; i += 1) {
    const p = patterns[i];
    const matches = p.match.exec(filename);

    if (matches) {
      let ret = replaceSpecialDirs(p.replace, url, info);
      ret = ret.replace(SPECIAL_DIRS.FILENAME, filename);

      // Replace capture groups
      for (let j = 0; j < matches.length; j += 1) {
        ret = ret.replace(`:$${j}:`, matches[j]);
      }

      // Abort after first match
      return ret;
    }
  }

  // Defaults to noop on filename
  return filename;
};

// CHROME
// Chrome has a nice API for this. Migrate to this once it's available on Firefox, since
// we wont't have to fire off another HEAD just to get Content-Disposition.
let globalChromePath = "."; // global variable: no other easy way around this
let globalChromeRewriteOptions = {};
if (chrome && chrome.downloads && chrome.downloads.onDeterminingFilename) {
  chrome.downloads.onDeterminingFilename.addListener(
    (downloadItem, suggest) => {
      // todo: check chrome
      const rewrittenFilename = rewriteFilename(
        downloadItem.filename,
        globalChromeRewriteOptions.patterns,
        globalChromeRewriteOptions.url,
        globalChromeRewriteOptions.info
      );

      suggest({
        filename: `${globalChromePath}/${replaceFsBadChars(rewrittenFilename)}`
      });
    }
  );
}

const downloadInto = (path, url, info, patterns, prompt) => {
  const download = (filename, rewrite = true) => {
    const rewrittenFilename = rewrite
      ? rewriteFilename(filename, patterns, url, info)
      : filename;

    browser.downloads.download({
      url,
      filename: `${path}/${replaceFsBadChars(rewrittenFilename)}`,
      saveAs: prompt
      // conflictAction: 'prompt', // Not supported in FF
    });
  };

  // CHROME
  if (
    browser === chrome &&
    chrome.downloads &&
    chrome.downloads.onDeterminingFilename
  ) {
    globalChromePath = path;
    globalChromeRewriteOptions = {
      patterns,
      url,
      info
    };
    download(url, "_overridden_by_listener", false);
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
        download(urlFilename);
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
    getFilenameFromUrl,
    getFilenameFromContentDisposition,
    replaceSpecialDirs,
    rewriteFilename
  };
}

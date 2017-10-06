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

const downloadInto = (path, url) => {
  const download = filename => {
    browser.downloads.download({
      url,
      filename: `${path}/${replaceFsBadChars(filename)}`
      // conflictAction: 'prompt', // Not supported in FF
    });
  };

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

// Export for testing
if (typeof module !== "undefined") {
  module.exports = {
    replaceFsBadChars,
    getFilenameFromUrl,
    getFilenameFromContentDisposition,
    replaceSpecialDirs
  };
}

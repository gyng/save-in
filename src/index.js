const MEDIA_TYPES = ["image", "video", "audio"];
const SPECIAL_DIRS = {
  SEPARATOR: "---",
  SOURCE_DOMAIN: ":sourcedomain:",
  PAGE_DOMAIN: ":pagedomain:",
  PAGE_URL: ":pageurl:",
  DATE: ":date:"
};

const replaceFsBadChars = s => s.replace(/[<>:"/\\|?*\0]/g, "_");

const downloadInto = (path, url) => {
  const download = filename => {
    browser.downloads.download({
      url,
      filename: `${path}/${replaceFsBadChars(filename)}`
      // conflictAction: 'prompt', // Not supported in FF
    });
  };

  const remotePath = new URL(url).pathname;
  const urlFilename = replaceFsBadChars(
    remotePath.substring(remotePath.lastIndexOf("/") + 1)
  );

  fetch(url, { method: "HEAD" })
    .then(res => {
      if (res.headers.has("Content-Disposition")) {
        const disposition = res.headers.get("Content-Disposition");
        const dispositionFilenames = disposition.match(
          /filename=['"]?(.+)['"]?/i
        );

        if (dispositionFilenames.length >= 2) {
          download(dispositionFilenames[1]);
        } else {
          download(urlFilename);
        }
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
  const formattedDate = `${now.getYear() + 1900}-${now.getMonth() +
    1}-${now.getDate()}`;
  ret = ret.replace(SPECIAL_DIRS.DATE, formattedDate);

  return ret;
};

browser.storage.local.get(["links", "paths"]).then(item => {
  const links = item.links || false;
  const paths = item.paths || ".";
  const pathsArray = paths.split("\n");
  const media = links ? MEDIA_TYPES.concat(["link"]) : MEDIA_TYPES;
  let separatorCounter = 0;

  pathsArray.forEach(dir => {
    if (!dir || dir === ".." || dir.startsWith("../") || dir.startsWith("/")) {
      return;
    }

    switch (dir) {
      case SPECIAL_DIRS.SEPARATOR:
        browser.contextMenus.create({
          id: `separator-${separatorCounter}`,
          type: "separator",
          contexts: media
        });

        separatorCounter += 1;
        break;
      case SPECIAL_DIRS.DOMAIN:
        browser.contextMenus.create({
          id: `save-in-${SPECIAL_DIRS.DOMAIN}`,
          title: dir,
          contexts: media
        });
        break;
      default:
        browser.contextMenus.create({
          id: `save-in-${dir}`,
          title: dir,
          contexts: media
        });
        break;
    }
  });

  browser.contextMenus.create({
    id: `separator-${separatorCounter}`,
    type: "separator",
    contexts: media
  });

  browser.contextMenus.create({
    id: "show-default-folder",
    title: browser.i18n.getMessage("contextMenuShowDefaultFolder"),
    contexts: media
  });

  browser.contextMenus.create({
    id: "options",
    title: browser.i18n.getMessage("contextMenuItemOptions"),
    contexts: media
  });
});

browser.contextMenus.onClicked.addListener(info => {
  const matchSave = info.menuItemId.match(/save-in-(.*)/);

  if (matchSave && matchSave.length === 2) {
    const url = MEDIA_TYPES.includes(info.mediaType)
      ? info.srcUrl
      : info.linkUrl;
    const actualPath = replaceSpecialDirs(matchSave[1], url, info);
    downloadInto(actualPath, url);
  }

  switch (info.menuItemId) {
    case "show-default-folder":
      browser.downloads.showDefaultFolder();
      break;
    case "options":
      browser.runtime.openOptionsPage();
      break;
    default:
      break; // noop
  }
});

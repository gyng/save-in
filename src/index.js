// defaults
const options = {
  links: true,
  prompt: false,
  paths: ".",
  notifyOnSuccess: false,
  notifyOnFailure: false
};

const setOption = (name, value) => {
  if (typeof value !== "undefined") {
    options[name] = value;
  }
};

browser.storage.local
  .get(["links", "paths", "prompt", "notifyOnSuccess", "notifyOnFailure"])
  .then(item => {
    // Options page has a different scope
    setOption("links", item.links);
    setOption("paths", item.paths);
    setOption("prompt", item.prompt);
    setOption("notifyOnSuccess", item.notifyOnSuccess);
    setOption("notifyOnFailure", item.notifyOnFailure);

    addNotifications({
      notifyOnSuccess: options.notifyOnSuccess,
      notifyOnFailure: options.notifyOnFailure
    });

    const pathsArray = options.paths.split("\n");
    const media = options.links ? MEDIA_TYPES.concat(["link"]) : MEDIA_TYPES;
    let separatorCounter = 0;

    pathsArray.forEach(dir => {
      if (
        !dir ||
        dir === ".." ||
        dir.startsWith("../") ||
        dir.startsWith("/")
      ) {
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
    downloadInto(actualPath, url, options.prompt);
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

// defaults
const options = {
  debug: false,
  links: true,
  selection: false,
  prompt: false,
  paths: ".",
  page: false,
  shortcut: false,
  shortcutType: SHORTCUT_TYPES.HTML_REDIRECT,
  notifyOnSuccess: false,
  notifyOnFailure: true,
  notifyDuration: 7000
};

const setOption = (name, value) => {
  if (typeof value !== "undefined") {
    options[name] = value;
  }
};

let lastUsedPath = null; // global variable

browser.storage.local
  .get([
    "debug",
    "links",
    "page",
    "shortcut",
    "shortcutType",
    "selection",
    "paths",
    "filenamePatterns",
    "prompt",
    "promptIfNoExtension",
    "notifyOnSuccess",
    "notifyOnFailure",
    "notifyDuration"
  ])
  .then(item => {
    if (item.debug) {
      window.SI_DEBUG = 1;
    }

    // Options page has a different scope
    setOption("links", item.links);
    setOption("selection", item.selection);
    setOption("page", item.page);
    setOption("paths", item.paths);
    setOption("prompt", item.prompt);
    setOption("promptIfNoExtension", item.promptIfNoExtension);
    setOption("notifyOnSuccess", item.notifyOnSuccess);
    setOption("notifyOnFailure", item.notifyOnFailure);
    setOption("notifyDuration", item.notifyDuration);
    setOption("shortcut", item.shortcut);
    setOption("shortcutType", item.shortcutType);

    // Parse filenamePatterns
    const filenamePatterns =
      item.filenamePatterns &&
      item.filenamePatterns
        .split("\n\n")
        .map(pairStr => pairStr.split("\n"))
        .map(pairArr => ({
          filenameMatch: new RegExp(pairArr[0]),
          replace: pairArr[1] || "",
          urlMatch: new RegExp(pairArr[2] || ".*") // defaults to match all URLs
        }));

    setOption("filenamePatterns", filenamePatterns || []);

    addNotifications({
      notifyOnSuccess: options.notifyOnSuccess,
      notifyOnFailure: options.notifyOnFailure,
      notifyDuration: options.notifyDuration
    });

    const pathsArray = options.paths.split("\n");
    let media = options.links ? MEDIA_TYPES.concat(["link"]) : MEDIA_TYPES;
    media = options.selection ? media.concat(["selection"]) : media;
    media = options.page ? media.concat(["page"]) : media;
    let separatorCounter = 0;

    const lastUsedMenuOptions = {
      id: `save-in-last-used`,
      title: "Last used",
      enabled: false,
      contexts: media
    };

    // Chrome, FF < 57 crash when icons is supplied
    // There is no easy way to detect support, so use a try/catch
    try {
      browser.contextMenus.create(
        Object.assign({}, lastUsedMenuOptions, {
          icons: {
            "16": "icons/ic_update_black_24px.svg"
          }
        })
      );
    } catch (e) {
      if (window.SI_DEBUG) {
        console.log("Failed to create last used menu item with icons"); // eslint-disable-line
      }

      browser.contextMenus.create(lastUsedMenuOptions);
    }

    browser.contextMenus.create({
      id: `separator-${separatorCounter}`,
      type: "separator",
      contexts: media
    });
    separatorCounter += 1;

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
    let url;
    let suggestedFilename = null;

    if (MEDIA_TYPES.includes(info.mediaType)) {
      url = info.srcUrl;
    } else if (options.links && info.linkUrl) {
      url = info.linkUrl;
    } else if (options.selection && info.selectionText) {
      url = makeObjectUrl(info.selectionText);
      suggestedFilename = info.pageUrl;
    } else if (options.page && info.pageUrl) {
      url = info.pageUrl;
      suggestedFilename = `${info.pageUrl}.html`;
    } else {
      if (window.SI_DEBUG) {
        console.log("failed to choose download", info); // eslint-disable-line
      }
      return;
    }

    const saveIntoPath =
      matchSave[1] === "last-used" ? lastUsedPath : matchSave[1];
    lastUsedPath = saveIntoPath;

    const actualPath = replaceSpecialDirs(saveIntoPath, url, info);

    browser.contextMenus.update("save-in-last-used", {
      title: `${lastUsedPath}`,
      enabled: true
    });

    if (options.shortcut) {
      url = makeShortcut(options.shortcutType, url);
      suggestedFilename = `${suggestedFilename ||
        info.srcUrl ||
        info.linkUrl ||
        info.pageUrl}.${SHORTCUT_EXTENSIONS[options.shortcutType]}`;
    }

    requestedDownloadFlag = true;
    downloadInto(actualPath, url, info, options, suggestedFilename);
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

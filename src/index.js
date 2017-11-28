// defaults
const options = {
  debug: false,
  conflictAction: "uniquify",
  links: true,
  selection: false,
  prompt: false,
  paths: ".",
  page: false,
  shortcutMedia: false,
  shortcutLink: false,
  shortcutPage: false,
  shortcutType: SHORTCUT_TYPES.HTML_REDIRECT,
  notifyOnSuccess: false,
  notifyOnFailure: true,
  notifyDuration: 7000,
  truncateLength: 240
};

const setOption = (name, value) => {
  if (typeof value !== "undefined") {
    options[name] = value;
  }
};

let lastUsedPath = null; // global variable
let currentTab = null; // global variable

browser.storage.local
  .get([
    "debug",
    "conflictAction",
    "links",
    "page",
    "shortcutMedia",
    "shortcutLink",
    "shortcutPage",
    "shortcutType",
    "selection",
    "paths",
    "filenamePatterns",
    "prompt",
    "promptIfNoExtension",
    "notifyOnSuccess",
    "notifyOnFailure",
    "notifyDuration",
    "truncateLength"
  ])
  .then(item => {
    if (item.debug) {
      window.SI_DEBUG = 1;
    }

    // Options page has a different scope
    setOption("links", item.links);
    setOption("conflictAction", item.conflictAction);
    setOption("selection", item.selection);
    setOption("page", item.page);
    setOption("paths", item.paths);
    setOption("prompt", item.prompt);
    setOption("promptIfNoExtension", item.promptIfNoExtension);
    setOption("notifyOnSuccess", item.notifyOnSuccess);
    setOption("notifyOnFailure", item.notifyOnFailure);
    setOption("notifyDuration", item.notifyDuration);
    setOption("shortcutMedia", item.shortcutMedia);
    setOption("shortcutLink", item.shortcutLink);
    setOption("shortcutPage", item.shortcutPage);
    setOption("shortcutType", item.shortcutType);
    setOption("truncateLength", item.truncateLength);

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
    let downloadType = DOWNLOAD_TYPES.UNKNOWN;

    if (MEDIA_TYPES.includes(info.mediaType)) {
      downloadType = DOWNLOAD_TYPES.MEDIA;
      url = info.srcUrl;
    } else if (options.links && info.linkUrl) {
      downloadType = DOWNLOAD_TYPES.LINK;
      url = info.linkUrl;
    } else if (options.selection && info.selectionText) {
      downloadType = DOWNLOAD_TYPES.SELECTION;
      url = makeObjectUrl(info.selectionText);
      suggestedFilename = `${currentTab.title}.selection.txt`;
    } else if (options.page && info.pageUrl) {
      downloadType = DOWNLOAD_TYPES.PAGE;
      url = info.pageUrl;
      suggestedFilename = `${(currentTab && currentTab.title) ||
        info.pageUrl}.html`;
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

    const saveAsShortcut =
      (downloadType === DOWNLOAD_TYPES.MEDIA && options.shortcutMedia) ||
      (downloadType === DOWNLOAD_TYPES.LINK && options.shortcutLink) ||
      (downloadType === DOWNLOAD_TYPES.PAGE && options.shortcutPage);

    if (window.SI_DEBUG) {
      console.log("shortcut", saveAsShortcut, downloadType, options, info); // eslint-disable-line
    }

    if (saveAsShortcut) {
      url = makeShortcut(
        options.shortcutType,
        url,
        currentTab && currentTab.title
      );

      suggestedFilename =
        downloadType === DOWNLOAD_TYPES.PAGE
          ? `${suggestedFilename ||
              (currentTab && currentTab.title) ||
              info.srcUrl ||
              info.linkUrl ||
              info.pageUrl}`
          : `${suggestedFilename ||
              info.linkText ||
              info.srcUrl ||
              info.linkUrl}`;

      suggestedFilename = `${truncateIfLongerThan(
        suggestedFilename,
        options.truncateLength - 5
      )}${SHORTCUT_EXTENSIONS[options.shortcutType] || ""}`;
    }

    suggestedFilename = truncateIfLongerThan(
      suggestedFilename,
      options.truncateLength
    );

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

browser.tabs.onActivated.addListener(info => {
  browser.tabs.get(info.tabId).then(t => {
    if (window.SI_DEBUG) {
      console.log("current tab", t); // eslint-disable-line
    }

    currentTab = t;
  });
});

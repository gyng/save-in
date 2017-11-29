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
  truncateLength: 240,
  routeFailurePrompt: false,
  routeExclusive: false
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
    "routeDownloadRules",
    "routeFailurePrompt",
    "routeExclusive",
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
    setOption("routeFailurePrompt", item.routeFailurePrompt);
    setOption("routeExclusive", item.routeExclusive);

    // Parse filenamePatterns
    const filenamePatterns =
      item.filenamePatterns &&
      item.filenamePatterns
        .split("\n\n")
        .map(pairStr => pairStr.split("\n"))
        .map(pairArr => {
          try {
            if (pairArr.length < 2) {
              throw new Error("missing filename replacement pattern");
            }

            const filenameMatch = new RegExp(pairArr[0]);
            const urlMatch = new RegExp(pairArr[2] || ".*"); // defaults to match all URLs

            return {
              filenameMatch,
              replace: pairArr[1] || "",
              urlMatch
            };
          } catch (e) {
            console.log(e); // eslint-disable-line
            createExtensionNotification(
              "Save In: Ignoring bad rewrite pattern",
              `${e.message}: ${pairArr}`,
              true
            );
            return null;
          }
        })
        .filter(f => f != null);
    setOption("filenamePatterns", filenamePatterns || []);

    const routeDownloadRules =
      item.routeDownloadRules && parseRules(item.routeDownloadRules);
    setOption("routeDownloadRules", routeDownloadRules || []);

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

    if (options.routeExclusive) {
      browser.contextMenus.create({
        id: "save-in-route-exclusive",
        title: "Save In route…",
        contexts: media
      });
      
      return;
    }

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

    if (options.routeDownloadRules.length > 0) {
      browser.contextMenus.create({
        id: `save-in-auto`,
        title: "Try to route",
        contexts: media
      });
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
  const matchRoute = matchRules(options.routeDownloadRules, info);
  console.log(options.routeDownloadRules, info)

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
      suggestedFilename = `${(currentTab && currentTab.title) ||
        info.selectionText}.selection.txt`;
    } else if (options.page && info.pageUrl) {
      downloadType = DOWNLOAD_TYPES.PAGE;
      url = info.pageUrl;
      const pageTitle = currentTab && currentTab.title;
      suggestedFilename = pageTitle ? `${pageTitle}.html` : info.pageUrl;
    } else {
      if (window.SI_DEBUG) {
        console.log("failed to choose download", info); // eslint-disable-line
      }
      return;
    }

    let saveIntoPath;

    if (matchSave[1] === "auto" || matchSave[1] === "route-exclusive") {
      saveIntoPath = matchRoute;

      if (!matchRoute) {
        if (options.routeFailurePrompt) {
          saveIntoPath = "";
        } else if (options.notifyOnFailure) {
          createExtensionNotification(
            "Save In: Failed to route download",
            `No matching rule found for ${url}`,
            true,
            options
          );
        } else {
          return;
        }
      }
    } else if (matchSave[1] === "last-used") {
      saveIntoPath = lastUsedPath;
      lastUsedPath = saveIntoPath;
    } else {
      saveIntoPath - matchSave[1];
      lastUsedPath = saveIntoPath;
    }

    const actualPath = replaceSpecialDirs(saveIntoPath, url, info);

    if (lastUsedPath) {
      browser.contextMenus.update("save-in-last-used", {
        title: `${lastUsedPath}`,
        enabled: true
      });
    }

    const saveAsShortcut =
      (downloadType === DOWNLOAD_TYPES.MEDIA && options.shortcutMedia) ||
      (downloadType === DOWNLOAD_TYPES.LINK && options.shortcutLink) ||
      (downloadType === DOWNLOAD_TYPES.PAGE && options.shortcutPage);

    if (window.SI_DEBUG) {
      console.log("shortcut", saveAsShortcut, downloadType, options, info); // eslint-disable-line
    }

    if (saveAsShortcut) {
      url = makeShortcut(options.shortcutType, url);

      suggestedFilename = suggestShortcutFilename(
        options.shortcutType,
        downloadType,
        info,
        suggestedFilename,
        options.truncateLength
      );
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

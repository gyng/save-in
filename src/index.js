let lastUsedPath = null; // global variable
let currentTab = null; // global variable

window.init = () => {
  // FIXME
  window.optionErrors = {
    paths: [],
    filenamePatterns: []
  };

  OptionsManagement.loadOptions().then(() => {
    Notification.addNotifications({
      notifyOnSuccess: options.notifyOnSuccess,
      notifyOnFailure: options.notifyOnFailure,
      notifyDuration: options.notifyDuration,
      promptOnFailure: options.promptOnFailure
    });

    const pathsArray = options.paths
      .split("\n")
      .map(p => p.trim())
      .filter(p => p && p.length > 0);

    let media = options.links ? MEDIA_TYPES.concat(["link"]) : MEDIA_TYPES;
    media = options.selection ? media.concat(["selection"]) : media;
    media = options.page ? media.concat(["page"]) : media;

    Menus.addTabMenus();

    // CHROME ONLY, FF does not support yet
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1320462
    const setAccesskey = (str, key) => {
      if (CURRENT_BROWSER !== BROWSERS.CHROME || !key) {
        return str;
      }

      if (str.includes(key)) {
        return str.replace(key, `&${key}`);
      } else {
        return `${str} (&${key})`;
      }
    };

    if (options.routeExclusive) {
      browser.contextMenus.create({
        id: "save-in-_-_-route-exclusive",
        title: setAccesskey(
          browser.i18n.getMessage("contextMenuExclusive"),
          options.keyRoot
        ),
        contexts: media
      });

      return;
    } else {
      browser.contextMenus.create({
        id: "save-in-_-_-root",
        title: setAccesskey(
          browser.i18n.getMessage("contextMenuRoot"),
          options.keyRoot
        ),
        contexts: media
      });
    }

    if (options.enableLastLocation) {
      const lastUsedTitle = lastUsedPath || browser.i18n.getMessage("contextMenuLastUsed");
      const lastUsedMenuOptions = {
        id: `save-in-_-_-last-used`,
        title: setAccesskey(lastUsedTitle, options.keyLastUsed),
        enabled: lastUsedPath ? true : false, // eslint-disable-line
        contexts: media,
        parentId: "save-in-_-_-root"
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
        browser.contextMenus.create(lastUsedMenuOptions);
      }

      Menus.makeSeparator(media);
    }

    let menuItemCounter = 0;
    pathsArray.forEach(dir => {
      const validation = new Path.Path(dir).validate();
      if (!validation.valid) {
        window.optionErrors.paths.push({
          message: validation.message,
          error: `${dir}`
        });

        return;
      }

      // HACK
      if (dir === SPECIAL_DIRS.SEPARATOR) {
        Menus.makeSeparator(media);
      } else {
        menuItemCounter += 1;

        const tokens = dir.split("//");
        const parsedDir = tokens[0].trim();
        const comment = (tokens[1] || "").trim();
        const title = `${parsedDir}${comment ? ` // ${comment}` : ""}`;

        browser.contextMenus.create({
          id: `save-in-${menuItemCounter}-${comment}-${parsedDir}`,
          title: options.enableNumberedItems
            ? setAccesskey(title, menuItemCounter)
            : title,
          contexts: media,
          parentId: "save-in-_-_-root"
        });
      }
    });

    Menus.makeSeparator(media);

    if (media.includes("link")) {
      browser.contextMenus.create({
        id: "download-context-media-link",
        title: browser.i18n.getMessage("contextMenuContextMediaOrLink"),
        enabled: false,
        contexts: MEDIA_TYPES.concat("link"),
        parentId: "save-in-_-_-root"
      });
    } else {
      browser.contextMenus.create({
        id: "download-context-media",
        title: browser.i18n.getMessage("contextMenuContextMedia"),
        enabled: false,
        contexts: MEDIA_TYPES,
        parentId: "save-in-_-_-root"
      });
    }

    if (media.includes("selection")) {
      browser.contextMenus.create({
        id: "download-context-selection",
        title: browser.i18n.getMessage("contextMenuContextSelection"),
        enabled: false,
        contexts: ["selection"],
        parentId: "save-in-_-_-root"
      });
    }

    if (media.includes("page")) {
      browser.contextMenus.create({
        id: "download-context-page",
        title: browser.i18n.getMessage("contextMenuContextPage"),
        enabled: false,
        contexts: ["page"],
        parentId: "save-in-_-_-root"
      });
    }

    browser.contextMenus.create({
      id: "show-default-folder",
      title: browser.i18n.getMessage("contextMenuShowDefaultFolder"),
      contexts: media,
      parentId: "save-in-_-_-root"
    });

    browser.contextMenus.create({
      id: "options",
      title: browser.i18n.getMessage("contextMenuItemOptions"),
      contexts: media,
      parentId: "save-in-_-_-root"
    });
  });
};

browser.contextMenus.onClicked.addListener(info => {
  if (Object.values(Menus.IDS.TABSTRIP).includes(info.menuItemId)) {
    return;
  }

  const matchSave = info.menuItemId.match(/save-in-(\d|_)+-(.*?)-(.*)/);

  if (matchSave && matchSave.length === 4) {
    let menuIndex = matchSave[1];
    let comment = matchSave[2];
    const matchedDir = matchSave[3];

    let url;
    let suggestedFilename = null;
    let downloadType = DOWNLOAD_TYPES.UNKNOWN;

    const hasLink = options.links && info.linkUrl;

    if (MEDIA_TYPES.includes(info.mediaType)) {
      downloadType = DOWNLOAD_TYPES.MEDIA;
      url = info.srcUrl;

      if (hasLink && options.preferLinks) {
        downloadType = DOWNLOAD_TYPES.LINK;
        url = info.linkUrl;
      }
    } else if (hasLink) {
      downloadType = DOWNLOAD_TYPES.LINK;
      url = info.linkUrl;
    } else if (options.selection && info.selectionText) {
      downloadType = DOWNLOAD_TYPES.SELECTION;
      url = Download.makeObjectUrl(info.selectionText);
      suggestedFilename = `${Path.truncateIfLongerThan(
        (currentTab && currentTab.title) || info.selectionText,
        options.truncateLength - 14
      )}.selection.txt`;
    } else if (options.page && info.pageUrl) {
      downloadType = DOWNLOAD_TYPES.PAGE;
      url = info.pageUrl;
      const pageTitle = currentTab && currentTab.title;
      suggestedFilename = pageTitle || info.pageUrl;
    } else {
      return;
    }

    let saveIntoPath;

    if (matchedDir === "route-exclusive") {
      saveIntoPath = ".";
    } else if (matchedDir === "last-used") {
      saveIntoPath = lastUsedPath;
      comment = window.lastDownloadState.info.comment;
      menuIndex = window.lastDownloadState.info.menuIndex;
    } else {
      saveIntoPath = matchedDir;
      lastUsedPath = saveIntoPath;
      const title = comment
        ? `${lastUsedPath}${comment ? ` // ${comment}` : ""}`
        : lastUsedPath;

      if (options.enableLastLocation) {
        browser.contextMenus.update("save-in-_-_-last-used", {
          title: CURRENT_BROWSER === BROWSERS.CHROME ? `${title} (&a)` : title,
          enabled: true
        });
      }
    }

    const parsedPath = new Path.Path(saveIntoPath);

    const saveAsShortcut =
      (downloadType === DOWNLOAD_TYPES.MEDIA && options.shortcutMedia) ||
      (downloadType === DOWNLOAD_TYPES.LINK && options.shortcutLink) ||
      (downloadType === DOWNLOAD_TYPES.PAGE && options.shortcutPage);

    if (saveAsShortcut) {
      url = Shortcut.makeShortcut(options.shortcutType, url);

      suggestedFilename = Shortcut.suggestShortcutFilename(
        options.shortcutType,
        downloadType,
        info,
        suggestedFilename,
        options.truncateLength
      );
    }

    if (suggestedFilename) {
      suggestedFilename = Path.sanitizeFilename(
        suggestedFilename,
        options.truncateLength
      );
    }

    // Organise things by flattening the info struct and only keeping needed info
    const opts = {
      currentTab, // Global
      linkText: info.linkText,
      now: new Date(),
      pageUrl: info.pageUrl,
      selectionText: info.selectionText,
      sourceUrl: info.srcUrl || info.url,
      url, // Changes based off context
      suggestedFilename, // wip: rename
      context: downloadType,
      menuIndex,
      comment,
      modifiers: info.modifiers,
      legacyDownloadInfo: info // wip, remove
    };

    // keeps track of state of the final path
    const state = {
      path: parsedPath,
      scratch: {},
      info: opts
    };

    requestedDownloadFlag = true; // Notifications.
    Download.renameAndDownload(state);
  }

  switch (info.menuItemId) {
    case "show-default-folder":
      browser.download.showDefaultFolder();
      break;
    case "options":
      browser.runtime.openOptionsPage();
      break;
    default:
      break; // noop
  }
});

window.reset = () => {
  browser.contextMenus.removeAll().then(() => {
    window.init();
  });
};

window.init();

browser.tabs.onActivated.addListener(info => {
  browser.tabs.get(info.tabId).then(t => {
    currentTab = t;
  });
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!currentTab) {
    browser.tabs.get(tabId).then(t => {
      currentTab = t;
    });
  } else if (currentTab.id === tabId && changeInfo.title) {
    currentTab.title = changeInfo.title;
  }
});

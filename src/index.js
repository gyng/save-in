// defaults, duplicate of those in options.js
const options = {
  debug: false,
  conflictAction: "uniquify",
  links: true,
  selection: true,
  prompt: false,
  paths: ".\nimages\nvideos",
  page: true,
  shortcutMedia: false,
  shortcutLink: false,
  shortcutPage: false,
  shortcutType: SHORTCUT_TYPES.HTML_REDIRECT,
  notifyOnSuccess: false,
  notifyOnRuleMatch: true,
  notifyOnFailure: true,
  notifyDuration: 7000,
  truncateLength: 240,
  routeFailurePrompt: false,
  routeExclusive: false,
  replacementChar: "_",
  keyRoot: "a",
  keyLastUsed: "a",
  enableNumberedItems: true
};

const setOption = (name, value) => {
  if (typeof value !== "undefined") {
    options[name] = value;
  }
};

let lastUsedPath = null; // global variable
let currentTab = null; // global variable

window.init = () => {
  window.optionErrors = {
    paths: [],
    filenamePatterns: [],
    testLastResult: null
  };

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
      "routeFailurePrompt",
      "routeExclusive",
      "prompt",
      "promptIfNoExtension",
      "notifyOnSuccess",
      "notifyOnRuleMatch",
      "notifyOnFailure",
      "notifyDuration",
      "truncateLength",
      "replacementChar",
      "keyRoot",
      "keyLastUsed",
      "enableNumberedItems"
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
      setOption("notifyOnRuleMatch", item.notifyOnRuleMatch);
      setOption("notifyOnFailure", item.notifyOnFailure);
      setOption("notifyDuration", item.notifyDuration);
      setOption("shortcutMedia", item.shortcutMedia);
      setOption("shortcutLink", item.shortcutLink);
      setOption("shortcutPage", item.shortcutPage);
      setOption("shortcutType", item.shortcutType);
      setOption("truncateLength", item.truncateLength);
      setOption("routeFailurePrompt", item.routeFailurePrompt);
      setOption("routeExclusive", item.routeExclusive);
      setOption(
        "replacementChar",
        replaceLeadingDots(replaceFsBadChars(item.replacementChar || "", "")) ||
          ""
      );

      setOption("keyRoot", item.keyRoot);
      setOption("keyLastUsed", item.keyLastUsed);
      setOption("enableNumberedItems", item.enableNumberedItems);

      const filenamePatterns =
        item.filenamePatterns && parseRules(item.filenamePatterns);
      setOption("filenamePatterns", filenamePatterns || []);

      if (window.lastDownload) {
        const last = window.lastDownload;
        const testLastResult = rewriteFilename(
          last.filename,
          filenamePatterns,
          last.info,
          last.url
        );
        window.optionErrors.testLastResult = testLastResult;
      }

      addNotifications({
        notifyOnSuccess: options.notifyOnSuccess,
        notifyOnFailure: options.notifyOnFailure,
        notifyDuration: options.notifyDuration
      });

      const pathsArray = [
        ...new Set(options.paths.split("\n").map(p => p.trim()))
      ];
      let media = options.links ? MEDIA_TYPES.concat(["link"]) : MEDIA_TYPES;
      media = options.selection ? media.concat(["selection"]) : media;
      media = options.page ? media.concat(["page"]) : media;
      let separatorCounter = 0;

      // CHROME ONLY, FF does not support yet
      // https://bugzilla.mozilla.org/show_bug.cgi?id=1320462
      const setAccesskey = (str, key) => {
        if (browser !== chrome || !key) {
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
          id: "save-in-route-exclusive",
          title: setAccesskey(
            browser.i18n.getMessage("contextMenuExclusive"),
            options.keyRoot
          ),
          contexts: media
        });

        return;
      } else {
        browser.contextMenus.create({
          id: "save-in-root",
          title: setAccesskey(
            browser.i18n.getMessage("contextMenuRoot"),
            options.keyRoot
          ),
          contexts: media
        });
      }

      const lastUsedMenuOptions = {
        id: `save-in-last-used`,
        title: browser.i18n.getMessage("contextMenuLastUsed"),
        enabled: false,
        contexts: media,
        parentId: "save-in-root"
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
        contexts: media,
        parentId: "save-in-root"
      });
      separatorCounter += 1;

      let menuItemCounter = 0;
      pathsArray.forEach(dir => {
        if (
          !dir ||
          dir === ".." ||
          dir.startsWith("../") ||
          dir.startsWith("/") ||
          dir.startsWith("//")
        ) {
          // Silently ignore blank lines
          if (dir !== "" && !dir.startsWith("//")) {
            window.optionErrors.paths.push({
              message: "Path cannot start with .. or",
              error: `${dir}`
            });
          }

          return;
        }

        if (
          dir !== "." &&
          !dir.startsWith("./") &&
          sanitizePath(removeSpecialDirs(dir)) !== removeSpecialDirs(dir)
        ) {
          window.optionErrors.paths.push({
            message: "Path contains invalid characters",
            error: `${dir}`
          });
        }

        switch (dir) {
          case SPECIAL_DIRS.SEPARATOR:
            browser.contextMenus.create({
              id: `separator-${separatorCounter}`,
              type: "separator",
              contexts: media,
              parentId: "save-in-root"
            });

            separatorCounter += 1;
            break;
          default:
            menuItemCounter += 1;
            browser.contextMenus.create({
              id: `save-in-${dir}`,
              title: options.enableNumberedItems
                ? setAccesskey(dir, menuItemCounter)
                : dir,
              contexts: media,
              parentId: "save-in-root"
            });
            break;
        }
      });

      browser.contextMenus.create({
        id: `separator-${separatorCounter}`,
        type: "separator",
        contexts: media,
        parentId: "save-in-root"
      });

      if (media.includes("link")) {
        browser.contextMenus.create({
          id: "download-context-media-link",
          title: browser.i18n.getMessage("contextMenuContextMediaOrLink"),
          enabled: false,
          contexts: MEDIA_TYPES.concat("link"),
          parentId: "save-in-root"
        });
      } else {
        browser.contextMenus.create({
          id: "download-context-media",
          title: browser.i18n.getMessage("contextMenuContextMedia"),
          enabled: false,
          contexts: MEDIA_TYPES,
          parentId: "save-in-root"
        });
      }

      if (media.includes("selection")) {
        browser.contextMenus.create({
          id: "download-context-selection",
          title: browser.i18n.getMessage("contextMenuContextSelection"),
          enabled: false,
          contexts: ["selection"],
          parentId: "save-in-root"
        });
      }

      if (media.includes("page")) {
        browser.contextMenus.create({
          id: "download-context-page",
          title: browser.i18n.getMessage("contextMenuContextPage"),
          enabled: false,
          contexts: ["page"],
          parentId: "save-in-root"
        });
      }

      browser.contextMenus.create({
        id: "show-default-folder",
        title: browser.i18n.getMessage("contextMenuShowDefaultFolder"),
        contexts: media,
        parentId: "save-in-root"
      });

      browser.contextMenus.create({
        id: "options",
        title: browser.i18n.getMessage("contextMenuItemOptions"),
        contexts: media,
        parentId: "save-in-root"
      });
    });
};

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

    if (matchSave[1] === "route-exclusive") {
      saveIntoPath = ".";
    } else if (matchSave[1] === "last-used") {
      saveIntoPath = lastUsedPath;
    } else {
      saveIntoPath = matchSave[1];
      lastUsedPath = saveIntoPath;

      browser.contextMenus.update("save-in-last-used", {
        title: browser === chrome ? `${lastUsedPath} (&a)` : lastUsedPath,
        enabled: true
      });
    }

    const actualPath = replaceSpecialDirs(saveIntoPath, url, info);

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

    if (suggestedFilename) {
      suggestedFilename = sanitizeFilename(
        suggestedFilename,
        options.truncateLength
      );
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

window.reset = () => {
  browser.contextMenus.removeAll().then(() => {
    window.init();
  });
};

window.init();

browser.tabs.onActivated.addListener(info => {
  browser.tabs.get(info.tabId).then(t => {
    if (window.SI_DEBUG) {
      console.log("current tab", t); // eslint-disable-line
    }

    currentTab = t;
  });
});

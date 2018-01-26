const T = {
  BOOL: "BOOL",
  VALUE: "VALUE"
};

const OPTION_KEYS = [
  { name: "conflictAction", type: T.VALUE, default: "uniquify" },
  { name: "contentClickToSave", type: T.BOOL, default: false },
  { name: "contentClickToSaveCombo", type: T.VALUE, default: 18 },
  { name: "debug", type: T.BOOL, fn: null, default: false },
  { name: "enableLastLocation", type: T.BOOL, default: true },
  { name: "enableNumberedItems", type: T.BOOL, default: true },
  {
    name: "filenamePatterns",
    type: T.VALUE,
    onSave: v => v.trim(),
    onLoad: v => parseRules(v),
    default: ""
  },
  { name: "keyLastUsed", type: T.VALUE, default: "a" },
  { name: "keyRoot", type: T.VALUE, default: "a" },
  { name: "links", type: T.BOOL, default: true },
  { name: "notifyDuration", type: T.VALUE, default: 7000 },
  { name: "notifyOnFailure", type: T.BOOL, default: true },
  { name: "notifyOnRuleMatch", type: T.BOOL, default: true },
  { name: "notifyOnSuccess", type: T.BOOL, default: false },
  { name: "page", type: T.BOOL, default: true },
  {
    name: "paths",
    type: T.VALUE,
    onSave: v => v.trim() || ".",
    default: ".\nimages\nvideos"
  },
  { name: "prompt", type: T.BOOL, default: false },
  { name: "promptIfNoExtension", type: T.BOOL, default: false },
  { name: "promptOnFailure", type: T.BOOL, default: true },
  { name: "promptOnShift", type: T.BOOL, default: true },
  { name: "replacementChar", type: T.VALUE, default: "_" },
  { name: "routeExclusive", type: T.BOOL, default: false },
  { name: "routeFailurePrompt", type: T.BOOL, default: false },
  { name: "selection", type: T.BOOL, default: true },
  { name: "shortcutLink", type: T.BOOL, default: false },
  { name: "shortcutMedia", type: T.BOOL, default: false },
  { name: "shortcutPage", type: T.BOOL, default: false },
  {
    name: "shortcutType",
    type: T.VALUE,
    default: SHORTCUT_TYPES.HTML_REDIRECT
  },
  { name: "truncateLength", type: T.VALUE, default: 240 }
];

window.OPTION_TYPES = T;
window.OPTION_KEYS = OPTION_KEYS;

// defaults, duplicate of those in options.js
const options = OPTION_KEYS.reduce((acc, val) =>
  Object.assign(acc, { [val.name]: val.default }, {})
);

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
    testLastResult: null,
    testLastCapture: null
  };

  const keys = OPTION_KEYS.reduce((acc, val) => acc.concat([val.name]), []);
  browser.storage.local.get(keys).then(loadedOptions => {
    if (loadedOptions.debug) {
      window.SI_DEBUG = 1;
    }

    const localKeys = Object.keys(loadedOptions);
    localKeys.forEach(k => {
      const optionType = OPTION_KEYS.find(ok => ok.name === k);
      const fn = optionType.onLoad || (x => x);
      setOption(k, fn(loadedOptions[k]));
    });

    if (window.lastDownload) {
      const last = window.lastDownload;
      const testLastResult = rewriteFilename(
        last.filename,
        options.filenamePatterns,
        last.info,
        last.url,
        last.context,
        last.menuIndex,
        last.comment
      );

      let testLastCapture;
      for (let i = 0; i < options.filenamePatterns.length; i += 1) {
        testLastCapture = getCaptureMatches(
          options.filenamePatterns[i],
          last.info,
          last.filename || last.url
        );

        if (testLastCapture) {
          break;
        }
      }

      window.optionErrors.testLastResult = testLastResult;
      window.optionErrors.testLastCapture = testLastCapture;
    }

    addNotifications({
      notifyOnSuccess: options.notifyOnSuccess,
      notifyOnFailure: options.notifyOnFailure,
      notifyDuration: options.notifyDuration,
      promptOnFailure: options.promptOnFailure
    });

    // HACK: Allow duplicate separators
    let separatorHackCounter = 0;
    const pathsArray = options.paths.split("\n").map(
      p =>
        p.trim() === SPECIAL_DIRS.SEPARATOR
          ? `:${SPECIAL_DIRS.SEPARATOR}-${separatorHackCounter++}` // eslint-disable-line
          : p.trim()
    );

    let media = options.links ? MEDIA_TYPES.concat(["link"]) : MEDIA_TYPES;
    media = options.selection ? media.concat(["selection"]) : media;
    media = options.page ? media.concat(["page"]) : media;

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
      const lastUsedMenuOptions = {
        id: `save-in-_-_-last-used`,
        title: lastUsedPath || browser.i18n.getMessage("contextMenuLastUsed"),
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
        if (window.SI_DEBUG) {
          console.log("Failed to create last used menu item with icons"); // eslint-disable-line
        }

        browser.contextMenus.create(lastUsedMenuOptions);
      }

      makeSeparator(media);
    }

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
        sanitizePath(removeSpecialDirs(dir)) !==
          removeSpecialDirs(dir).replace(new RegExp(/\\/, "g"), "/") &&
        !dir.startsWith(`:${SPECIAL_DIRS.SEPARATOR}`)
      ) {
        window.optionErrors.paths.push({
          message: "Path contains invalid characters",
          error: `${dir}`
        });
      }

      // HACK
      if (dir.startsWith(`:${SPECIAL_DIRS.SEPARATOR}`)) {
        makeSeparator(media);
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

    makeSeparator(media);

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
  const matchSave = info.menuItemId.match(/save-in-(\d|_)+-(.*?)-(.*)/);

  if (matchSave && matchSave.length === 4) {
    let menuIndex = matchSave[1];
    let comment = matchSave[2];
    const matchedDir = matchSave[3];

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
      suggestedFilename = pageTitle || info.pageUrl;
    } else {
      if (window.SI_DEBUG) {
        console.log("failed to choose download", info); // eslint-disable-line
      }
      return;
    }

    let saveIntoPath;

    if (matchedDir === "route-exclusive") {
      saveIntoPath = ".";
    } else if (matchedDir === "last-used") {
      saveIntoPath = lastUsedPath;
      comment = window.lastDownload.comment;
      menuIndex = window.lastDownload.menuIndex;
    } else {
      saveIntoPath = matchedDir;
      lastUsedPath = saveIntoPath;
      const title = comment
        ? `${lastUsedPath}${comment ? ` // ${comment}` : ""}`
        : lastUsedPath;

      if (options.enableLastLocation) {
        browser.contextMenus.update("save-in-_-_-last-used", {
          title: browser === chrome ? `${title} (&a)` : title,
          enabled: true
        });
      }
    }

    // const fixmedirs = [":sourcedomain:", ":filename:", ":naivefilename:"];
    const SPECIAL_DIRS_NEW = {
      UNIX_DATE: ":unixdate:"
    };
    const fixmedirs = Object.values(SPECIAL_DIRS_NEW);

    const fixmeregex = `(${fixmedirs.join("|")})`;

    console.log(fixmeregex);

    const PATH_SEGMENT_TYPES = {
      STRING: "STRING",
      VARIABLE: "VARIABLE",
      SEPARATOR: "SEPARATOR"
    };

    function PathSegment(type, val) {
      this.type = type;
      this.val = val;
    }
    PathSegment.prototype.toString = function toString() {
      return this.val;
    };

    const PATH_SEGMENT = {
      [PATH_SEGMENT_TYPES.STRING]: v =>
        new PathSegment(PATH_SEGMENT_TYPES.STRING, v),
      [PATH_SEGMENT_TYPES.VARIABLE]: v =>
        new PathSegment(PATH_SEGMENT_TYPES.VARIABLE, v),
      [PATH_SEGMENT_TYPES.SEPARATOR]: v =>
        new PathSegment(PATH_SEGMENT_TYPES.SEPARATOR, v)
    };

    const variableTransformers = {
      [SPECIAL_DIRS_NEW.FILENAME]: (tok, i, toks, opts) => opts.filename,
      [SPECIAL_DIRS_NEW.UNIX_DATE]: (tok, i, toks, opts) =>
        Date.parse(new Date()) / 1000
    };

    const tokenized = saveIntoPath
      .split(/([/\\])/)
      .map(c => c.split(new RegExp(fixmeregex)).filter(sub => sub.length > 0));
    const flattened = [].concat.apply([], tokenized); // eslint-disable-line

    const parsed = flattened.map(tok => {
      if (tok.match(/[/\\]/)) {
        return PATH_SEGMENT.SEPARATOR(tok);
      } else if (tok.match(fixmeregex)) {
        return PATH_SEGMENT.VARIABLE(tok);
      }
      return PATH_SEGMENT.STRING(tok);
    });

    const actualPath = replaceSpecialDirs(saveIntoPath, url, info);

    const transformation = toks =>
      toks.map((t, i, arr) => {
        if (t.type === PATH_SEGMENT_TYPES.VARIABLE) {
          const transformer = variableTransformers[t];
          if (transformer) {
            return transformer(t, i, arr);
          }
        }

        return t;
      });

    console.log(tokenized)
    console.log(parsed);

    const transformed = transformation(parsed);

    console.log(transformed, transformed.join(""));

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

    const downloadIntoOptions = {
      path: actualPath,
      url,
      downloadInfo: info,
      addonOptions: options,
      suggestedFilename,
      context: downloadType,
      menuIndex,
      comment
    };

    downloadInto(downloadIntoOptions);
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
      console.log("current tab activated", t); // eslint-disable-line
    }

    currentTab = t;
  });
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!currentTab) {
    browser.tabs.get(tabId).then(t => {
      currentTab = t;
    });
  } else if (currentTab.id === tabId && changeInfo.title) {
    if (window.SI_DEBUG) {
      console.log("current tab updated", tabId, changeInfo); // eslint-disable-line
    }

    currentTab.title = changeInfo.title;
  }
});

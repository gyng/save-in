// Click handling for the save-in context menu: routes clicks on path
// items (and last-used/route-exclusive) into Download.renameAndDownload.
// Extends the Menus object defined in menu-build.js via the shared
// global scope; tab-strip clicks are handled in menu-tabs.js.

// TODO: refactor this to handle only paths, add tests
Menus.addDownloadListener = () => {
  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (Object.values(Menus.IDS.TABSTRIP).includes(info.menuItemId)) {
      return;
    }

    if (info.menuItemId === "options") {
      browser.runtime.openOptionsPage();
      return;
    }

    if (info.menuItemId === "show-default-folder") {
      browser.downloads.showDefaultFolder();
      return;
    }

    // MV3 service workers restart between events: wait for options
    // and menus to be reinitialised before handling the click
    if (window.ready) {
      await window.ready;
    }

    // Prefer the tab the click happened in: the tracked global can lag
    // behind or belong to another window, and its title is mutated by
    // later tab updates (#172, #188)
    const clickTab = tab || currentTab;

    const menuInfo = Menus.pathMappings[info.menuItemId];

    if (menuInfo || [Menus.IDS.ROUTE_EXCLUSIVE, Menus.IDS.LAST_USED].includes(info.menuItemId)) {
      let menuIndex = menuInfo && menuInfo.menuIndex;
      let comment = menuInfo && menuInfo.comment;

      let url;
      let suggestedFilename = null;
      let downloadType = DOWNLOAD_TYPES.UNKNOWN;

      const hasLink = options.links && info.linkUrl;

      if (MEDIA_TYPES.includes(info.mediaType)) {
        downloadType = DOWNLOAD_TYPES.MEDIA;
        url = info.srcUrl;

        if (hasLink) {
          if (options.preferLinks) {
            downloadType = DOWNLOAD_TYPES.LINK;
            url = info.linkUrl;

            if (options.notifyOnLinkPreferred) {
              Notifier.createExtensionNotification(
                browser.i18n.getMessage("notificationLinkPreferred"),
                url,
              );
            }
          }

          if (options.preferLinksFilterEnabled && options.preferLinksFilter) {
            let overrideUrls = false;
            try {
              // splitLines drops empty lines: an empty pattern would compile to
              // `new RegExp("")` and match every page
              Util.splitLines(options.preferLinksFilter)
                .map((s) => new RegExp(s))
                .forEach((re) => {
                  if (info.pageUrl.match(re) != null) {
                    overrideUrls = true;
                  }
                });
            } catch (err) {
              Notifier.createExtensionNotification(
                browser.i18n.getMessage("notificationBadPreferLinksPattern"),
                err,
              );
            }

            if (overrideUrls) {
              downloadType = DOWNLOAD_TYPES.LINK;
              url = info.linkUrl;

              if (options.notifyOnLinkPreferred) {
                Notifier.createExtensionNotification(
                  browser.i18n.getMessage("notificationLinkPreferred"),
                  url,
                );
              }
            }
          }
        }
      } else if (hasLink) {
        downloadType = DOWNLOAD_TYPES.LINK;
        url = info.linkUrl;
      } else if (options.selection && info.selectionText) {
        downloadType = DOWNLOAD_TYPES.SELECTION;
        url = Download.makeObjectUrl(info.selectionText);
        suggestedFilename = `${Path.truncateIfLongerThan(
          (clickTab && clickTab.title) || info.selectionText,
          options.truncateLength - 14,
        )}.selection.txt`;
      } else if (options.page && info.pageUrl) {
        downloadType = DOWNLOAD_TYPES.PAGE;
        url = info.pageUrl;
        const pageTitle = clickTab && clickTab.title;
        suggestedFilename = pageTitle || info.pageUrl;
      } else {
        return;
      }

      let saveIntoPath;

      if (info.menuItemId === Menus.IDS.ROUTE_EXCLUSIVE) {
        saveIntoPath = ".";
      } else if (info.menuItemId === Menus.IDS.LAST_USED) {
        saveIntoPath = Menus.state.lastUsedPath;
        if (window.lastDownloadState && window.lastDownloadState.info) {
          comment = window.lastDownloadState.info.comment;
          menuIndex = window.lastDownloadState.info.menuIndex;
        } else if (Menus.state.lastUsedMeta) {
          // The in-memory lastDownloadState died with the service worker:
          // fall back to the persisted routing metadata so comment/menuindex
          // rules still match after a restart
          comment = Menus.state.lastUsedMeta.comment;
          menuIndex = Menus.state.lastUsedMeta.menuIndex;
        }
      } else {
        saveIntoPath = menuInfo.parsedDir;
        Menus.setLastUsed(saveIntoPath, { comment, menuIndex });
        const title = menuInfo.title || saveIntoPath;

        if (options.enableLastLocation) {
          browser.contextMenus.update(Menus.IDS.LAST_USED, {
            title: BROWSER_FEATURES.accessKeys ? `${title} (&a)` : title,
            enabled: true,
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
          options.truncateLength,
        );
      }

      if (suggestedFilename) {
        suggestedFilename = Path.sanitizeFilename(suggestedFilename, options.truncateLength);
      }

      // Organise things by flattening the info struct and only keeping needed info
      const opts = {
        currentTab: clickTab,
        linkText: info.linkText,
        now: new Date(),
        pageUrl: info.pageUrl,
        selectionText: info.selectionText,
        sourceUrl: info.srcUrl,
        url, // Changes based off context
        suggestedFilename,
        context: downloadType,
        menuIndex,
        comment,
        modifiers: info.modifiers,
      };

      // keeps track of state of the final path
      const state = {
        path: parsedPath,
        scratch: {},
        info: opts,
      };

      Notifier.expectDownload();
      // Fire-and-forget (renameAndDownload is async); Download.launch logs and
      // reports a terminal failure to the user
      Download.launch(state);

      // Close the tab a "save page" came from, mirroring the tab-strip
      // behavior (#115). Deliberately page-context only: closing the tab
      // under an image/link save would be a surprise.
      if (
        options.closeTabOnSave &&
        downloadType === DOWNLOAD_TYPES.PAGE &&
        clickTab &&
        clickTab.id != null
      ) {
        window.setTimeout(() => {
          browser.tabs.remove(clickTab.id);
        }, 500);
      }
    }
  });
};

// Export for testing
if (typeof module !== "undefined") {
  module.exports = Menus;
}

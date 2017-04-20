const MEDIA_TYPES = ['image', 'video', 'audio'];

browser.storage.local.get(['links', 'paths'])
  .then((item) => {
    const links = item.links || false;
    const paths = item.paths || '';
    const pathsArray = paths.split('\n');
    const media = links ? MEDIA_TYPES.concat(['link']) : MEDIA_TYPES;

    pathsArray.forEach((dir) => {
      if (!dir || dir === '..' || dir.startsWith('../') || dir.startsWith('/')) {
        return;
      }

      browser.contextMenus.create({
        id: `save-in-${dir}`,
        title: dir,
        contexts: media,
      });
    });

    browser.contextMenus.create({
      id: 'separator-0',
      type: 'separator',
      contexts: media,
    });

    browser.contextMenus.create({
      id: 'show-default-folder',
      title: browser.i18n.getMessage('contextMenuShowDefaultFolder'),
      contexts: media,
    });

    browser.contextMenus.create({
      id: 'options',
      title: browser.i18n.getMessage('contextMenuItemOptions'),
      contexts: media,
    });
  });

browser.contextMenus.onClicked.addListener((info) => {
  const matchSave = info.menuItemId.match(/save-in-(.*)/);

  if (matchSave && matchSave.length === 2) {
    const path = matchSave[1];
    const url = MEDIA_TYPES.includes('info.mediaType') ? info.srcUrl : info.linkUrl;
    const filename = url.substring(url.lastIndexOf('/') + 1);

    browser.downloads.download({
      url,
      filename: `${path}/${filename}`,
      // conflictAction: 'prompt', // Not supported in FF
    });
  }

  switch (info.menuItemId) {
    case 'show-default-folder':
      browser.downloads.showDefaultFolder();
      break;
    case 'options':
      browser.runtime.openOptionsPage();
      break;
    default:
      break; // noop
  }
});

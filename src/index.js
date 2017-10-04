const MEDIA_TYPES = ['image', 'video', 'audio'];

const replaceFsUnsafeChars = s => s.replace(/[<>:"/\\|?*\0]/g, '_');

const downloadInto = (path, url) => {
  const download = (filename) => {
    browser.downloads.download({
      url,
      filename: `${path}/${filename}`,
      // conflictAction: 'prompt', // Not supported in FF
    });
  };

  const remotePath = new URL(url).pathname;
  const urlFilename = replaceFsUnsafeChars(remotePath.substring(remotePath.lastIndexOf('/') + 1));

  fetch(url, { method: 'HEAD' })
    .then((res) => {
      if (res.headers.has('Content-Disposition')) {
        const disposition = res.headers.get('Content-Disposition');
        const dispositionFilenames = disposition.match(/filename=['"]?(.+)['"]?/i);

        if (dispositionFilenames.length >= 2) {
          download(replaceFsUnsafeChars(dispositionFilenames[1]));
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
    const url = MEDIA_TYPES.includes(info.mediaType) ? info.srcUrl : info.linkUrl;
    downloadInto(path, url);
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

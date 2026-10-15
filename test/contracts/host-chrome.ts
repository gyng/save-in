// These contracts compile under Chrome and its DOM-free worker project.

const checkChromeHost = (host: SaveInWebExtensionApi) => {
  const alias: typeof chrome = browser;
  void alias;
  // @ts-expect-error Firefox-only commands must not leak into Chrome's host.
  void host.commands.update({ name: "save" });
  // @ts-expect-error Chrome's browser alias must not acquire Firefox APIs.
  void browser.commands.update({ name: "save" });
  host.tabs.query({}, () => {});
  chrome.downloads.onDeterminingFilename.addListener((_item, suggest) => suggest());
};
void checkChromeHost;

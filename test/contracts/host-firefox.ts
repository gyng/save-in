// These contracts compile under Firefox and the combined source/test project.

const checkFirefoxHost = (host: SaveInWebExtensionApi) => {
  void host.commands.update({ name: "save" });
  void browser.commands.update({ name: "save" });
  // @ts-expect-error Firefox browser APIs are promise-only.
  browser.tabs.query({}, () => {});
  // @ts-expect-error The selected host must retain Firefox's promise-only API.
  host.tabs.query({}, () => {});
  // Content scripts use the callback namespace even on Firefox.
  chrome.tabs.query({}, () => {});
  chrome.downloads.onDeterminingFilename.addListener((_item, suggest) => suggest());
};
void checkFirefoxHost;

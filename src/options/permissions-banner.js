// Options-page host-permission banner. MV3 host permissions are revocable on
// Firefox (about:addons) and narrowable on Chrome ("on click" / specific
// sites). Without <all_urls>, click-to-save (the content script) and the
// Referer feature silently stop working. Detect the missing grant and offer a
// one-click request from the button's user gesture (permissions.request must be
// called synchronously inside a gesture handler, so no await precedes it).

const PermissionsBanner = {
  ORIGINS: ["<all_urls>"],

  // Resolves true when the extension currently holds the host access it needs.
  // Old browsers without the permissions API, or an errored check, resolve true
  // so the banner never nags when it can't actually determine the state.
  hasHostAccess: () =>
    new Promise((resolve) => {
      if (!browser.permissions || !browser.permissions.contains) {
        resolve(true);
        return;
      }
      browser.permissions.contains({ origins: PermissionsBanner.ORIGINS }).then(
        (granted) => resolve(granted),
        () => resolve(true),
      );
    }),

  // Wires the banner: shows/hides on the current grant, requests on click, and
  // reacts to grant/revoke while the page is open. Returns the initial refresh
  // promise (so tests and callers can await the first state).
  init: (banner, button) => {
    if (!banner || !button) {
      return Promise.resolve();
    }

    const refresh = () =>
      PermissionsBanner.hasHostAccess().then((granted) => {
        banner.hidden = granted;
      });

    button.addEventListener("click", () => {
      if (browser.permissions && browser.permissions.request) {
        // Synchronous in the gesture handler; refresh once it settles
        browser.permissions.request({ origins: PermissionsBanner.ORIGINS }).then(
          () => refresh(),
          () => {},
        );
      }
    });

    if (browser.permissions && browser.permissions.onAdded) {
      browser.permissions.onAdded.addListener(refresh);
    }
    if (browser.permissions && browser.permissions.onRemoved) {
      browser.permissions.onRemoved.addListener(refresh);
    }

    return refresh();
  },
};

if (typeof module !== "undefined") {
  module.exports = PermissionsBanner;
} else {
  document.addEventListener("DOMContentLoaded", () => {
    PermissionsBanner.init(
      document.querySelector("#host-permission-banner"),
      document.querySelector("#host-permission-grant"),
    );
  });
}

import { webExtensionApi } from "../web-extension-api.ts";

type PermissionBannerElement = { hidden: boolean | string };
type PermissionButtonElement = {
  addEventListener: (type: "click", listener: () => void) => void;
};

// Options-page host-permission banner. MV3 host permissions are revocable on
// Firefox (about:addons) and narrowable on Chrome ("on click" / specific
// sites). Without <all_urls>, click-to-save (the content script) and the
// Referer feature silently stop working. Detect the missing grant and offer a
// one-click request from the button's user gesture (permissions.request must be
// called synchronously inside a gesture handler, so no await precedes it).

export const PermissionsBanner = {
  ORIGINS: ["<all_urls>"],

  // Resolves true when the extension currently holds the host access it needs.
  // Old browsers without the permissions API, or an errored check, resolve true
  // so the banner never nags when it can't actually determine the state.
  hasHostAccess: (): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      if (!webExtensionApi.permissions || !webExtensionApi.permissions.contains) {
        resolve(true);
        return;
      }
      webExtensionApi.permissions.contains({ origins: PermissionsBanner.ORIGINS }).then(
        (granted) => resolve(granted),
        () => resolve(true),
      );
    }),

  // Wires the banner: shows/hides on the current grant, requests on click, and
  // reacts to grant/revoke while the page is open. Returns the initial refresh
  // promise (so tests and callers can await the first state).
  init: (
    banner: PermissionBannerElement | null,
    button: PermissionButtonElement | null,
  ): Promise<void> => {
    if (!banner || !button) {
      return Promise.resolve();
    }

    const refresh = () =>
      PermissionsBanner.hasHostAccess().then((granted) => {
        banner.hidden = granted;
      });

    button.addEventListener("click", () => {
      if (webExtensionApi.permissions && webExtensionApi.permissions.request) {
        // Synchronous in the gesture handler; refresh once it settles
        webExtensionApi.permissions.request({ origins: PermissionsBanner.ORIGINS }).then(
          () => refresh(),
          () => {},
        );
      }
    });

    if (webExtensionApi.permissions && webExtensionApi.permissions.onAdded) {
      webExtensionApi.permissions.onAdded.addListener(refresh);
    }
    if (webExtensionApi.permissions && webExtensionApi.permissions.onRemoved) {
      webExtensionApi.permissions.onRemoved.addListener(refresh);
    }

    return refresh();
  },
};

document.addEventListener("DOMContentLoaded", () => {
  PermissionsBanner.init(
    document.querySelector<HTMLElement>("#host-permission-banner"),
    document.querySelector<HTMLButtonElement>("#host-permission-grant"),
  );
});

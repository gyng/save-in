// Chrome MV3 service-worker side of the offscreen document (the page itself is
// src/offscreen.{html,js}). A service worker has no URL.createObjectURL, so
// fetched download bytes are turned into a blob object URL inside a hidden
// offscreen document instead of being base64'd into a data URL (which also has
// a size cap). At most one offscreen document exists; it is created lazily and
// reused. The Firefox event page has createObjectURL and never uses any of this.

import { MESSAGE_TYPES } from "../shared/constants.ts";
import { isOffscreenFetchResponse } from "../downloads/content-fetch-types.ts";

type OffscreenClientApi = {
  canUse: () => boolean;
  ensure: () => Promise<void | null>;
  fetch: (url: string) => Promise<string>;
};

export const OffscreenClient: OffscreenClientApi = {
  // Gated on a worker with no createObjectURL AND chrome.offscreen present, so
  // the Firefox event page (which has createObjectURL) never takes this path.
  canUse: () =>
    typeof URL.createObjectURL !== "function" &&
    typeof chrome !== "undefined" &&
    Boolean(chrome.offscreen),

  // At most one offscreen document exists; create it lazily and reuse it
  ensure: () => {
    const has = chrome.offscreen.hasDocument
      ? chrome.offscreen.hasDocument()
      : Promise.resolve(false);
    return Promise.resolve(has).then((exists) => {
      if (exists) {
        return null;
      }
      return chrome.offscreen
        .createDocument({
          url: "src/offscreen.html",
          reasons: ["BLOBS"],
          justification:
            "Create object URLs for fetched downloads (service workers have no URL.createObjectURL)",
        })
        .catch((e) => {
          // A concurrent createDocument races to "only one document" — tolerate
          if (!/single|only one|already/i.test(String(e))) {
            throw e;
          }
        });
    });
  },

  // Fetch a URL in the offscreen document and resolve to its blob object URL
  fetch: (url) =>
    OffscreenClient.ensure()
      .then(() => chrome.runtime.sendMessage({ type: MESSAGE_TYPES.OFFSCREEN_FETCH, url }))
      .then((res: unknown) => {
        if (!isOffscreenFetchResponse(res) || !res.blobUrl) {
          throw new Error((isOffscreenFetchResponse(res) && res.error) || "offscreen fetch failed");
        }
        return res.blobUrl;
      }),
};

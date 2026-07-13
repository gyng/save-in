// Chrome MV3 service-worker side of the offscreen document (the page itself is
// src/offscreen.{html,js}). A service worker has no URL.createObjectURL, so
// fetched download bytes are turned into a blob object URL inside a hidden
// offscreen document instead of being base64'd into a data URL (which also has
// a size cap). At most one offscreen document exists; it is created lazily and
// reused. The Firefox event page has createObjectURL and never uses any of this.

import { MESSAGE_TYPES } from "../shared/constants.ts";
import { isOffscreenFetchResponse } from "../shared/content-fetch-types.ts";
import type { ContentFetchResult } from "../shared/content-fetch-types.ts";
import type { ExtensionFetchCredentials } from "../config/fetch-credentials.ts";

type OffscreenClientApi = {
  canUse: () => boolean;
  ensure: () => Promise<void | null>;
  fetch: (url: string, credentials?: ExtensionFetchCredentials) => Promise<string>;
  fetchContent: (
    url: string,
    credentials?: ExtensionFetchCredentials,
    options?: { requestId?: string; hash?: boolean; signal?: AbortSignal },
  ) => Promise<ContentFetchResult>;
  cancel: (requestId: string) => Promise<unknown>;
  release: (requestId: string) => Promise<unknown>;
};

let ensurePromise: Promise<void | null> | null = null;

const hasOffscreenDocument = async (): Promise<boolean> => {
  const runtime = chrome.runtime as typeof chrome.runtime & {
    getContexts?: (filter: {
      contextTypes: string[];
      documentUrls: string[];
    }) => Promise<unknown[]>;
  };
  if (typeof runtime.getContexts === "function") {
    const contexts = await runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL("src/offscreen.html")],
    });
    return contexts.length > 0;
  }
  // hasDocument was added much later than offscreen documents. Keep this
  // compatibility path for unusual Chromium hosts, but prefer getContexts on
  // every supported Chrome version.
  return typeof chrome.offscreen.hasDocument === "function"
    ? chrome.offscreen.hasDocument()
    : false;
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
    if (ensurePromise) return ensurePromise;
    ensurePromise = hasOffscreenDocument()
      .then(async (exists) => {
        if (exists) return null;
        try {
          await chrome.offscreen.createDocument({
            url: "src/offscreen.html",
            reasons: ["BLOBS"],
            justification:
              "Create object URLs for fetched downloads (service workers have no URL.createObjectURL)",
          });
        } catch (error) {
          // Do not depend on browser error text. A racing extension context is
          // successful exactly when the capability probe now sees the document.
          if (!(await hasOffscreenDocument())) throw error;
        }
        return undefined;
      })
      .finally(() => {
        ensurePromise = null;
      });
    return ensurePromise;
  },

  // Fetch a URL in the offscreen document and resolve to its blob object URL
  fetch: (url, credentials = "include") =>
    OffscreenClient.fetchContent(url, credentials).then((content) => content.downloadUrl),

  fetchContent: (url, credentials = "include", options = {}) => {
    const requestId = options.requestId ?? crypto.randomUUID();
    const cancel = () => void OffscreenClient.cancel(requestId).catch(() => {});
    if (options.signal?.aborted) cancel();
    else options.signal?.addEventListener("abort", cancel, { once: true });
    return OffscreenClient.ensure()
      .then(() => {
        if (options.signal?.aborted) {
          throw (
            options.signal.reason ?? new DOMException("The operation was aborted", "AbortError")
          );
        }
        return chrome.runtime.sendMessage({
          type: MESSAGE_TYPES.OFFSCREEN_FETCH,
          url,
          credentials,
          requestId,
          ...(options.hash ? { hash: "SHA-256" } : {}),
        });
      })
      .then((res: unknown) => {
        if (options.signal?.aborted) {
          void OffscreenClient.release(requestId).catch(() => {});
          throw (
            options.signal.reason ?? new DOMException("The operation was aborted", "AbortError")
          );
        }
        if (!isOffscreenFetchResponse(res) || !res.blobUrl) {
          throw new Error((isOffscreenFetchResponse(res) && res.error) || "offscreen fetch failed");
        }
        return {
          sha256: res.hash ?? "",
          downloadUrl: res.blobUrl,
          offscreenRequestId: requestId,
        };
      })
      .finally(() => options.signal?.removeEventListener("abort", cancel));
  },

  cancel: (requestId) =>
    chrome.runtime.sendMessage({ type: MESSAGE_TYPES.OFFSCREEN_FETCH_CANCEL, requestId }),

  release: (requestId) =>
    chrome.runtime.sendMessage({ type: MESSAGE_TYPES.OFFSCREEN_BLOB_RELEASE, requestId }),
};

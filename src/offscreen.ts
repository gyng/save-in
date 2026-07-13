// Chrome offscreen document (Chrome-only). A service worker has no
// URL.createObjectURL, so fetched downloads would otherwise be base64-encoded
// into a data: URL in memory (1.33x size + Chrome's data-URL cap). This page
// has a DOM: it fetches the URL and returns a blob object URL the service
// worker can hand to chrome.downloads.download — no base64, no size cap.
//
// When message.hash is set (e.g. "SHA-256"), it also digests the SAME fetched
// bytes and returns the hex hash, so a :sha256: download is fetched once here
// for both the filename and the save rather than fetched again by the worker.

import {
  isOffscreenFetchCancelRequest,
  isOffscreenFetchRequest,
  type OffscreenFetchResponse,
} from "./shared/content-fetch-types.ts";
import {
  DEFAULT_FETCH_RESPONSE_TIMEOUT_MS,
  fetchFollowingRedirects,
} from "./shared/redirect-fetch.ts";
import { readResponseContent } from "./shared/streaming-content.ts";

const OFFSCREEN_BLOB_TTL_MS = 5 * 60 * 1000;

const activeFetches = new Map<string, AbortController>();

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: OffscreenFetchResponse | { canceled: boolean }) => void,
  ) => {
    if (isOffscreenFetchCancelRequest(message)) {
      const controller = activeFetches.get(message.requestId);
      controller?.abort();
      sendResponse({ canceled: Boolean(controller) });
      return false;
    }
    if (!isOffscreenFetchRequest(message)) {
      return false;
    }

    const requestId = message.requestId ?? `${Date.now()}-${Math.random()}`;
    const controller = new AbortController();
    activeFetches.set(requestId, controller);

    // Missing credentials preserves compatibility with an older background
    // that survived an update long enough to message this document.
    fetchFollowingRedirects(
      message.url,
      { credentials: message.credentials ?? "include", signal: controller.signal },
      DEFAULT_FETCH_RESPONSE_TIMEOUT_MS,
    )
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return readResponseContent(res, Boolean(message.hash), controller.signal);
      })
      .then(({ blob, sha256 }) => {
        const blobUrl = URL.createObjectURL(blob);
        // Free the blob once the download has had time to read it. The blob lives
        // here (as a Blob, 1x size), not as base64 in the worker.
        setTimeout(() => URL.revokeObjectURL(blobUrl), OFFSCREEN_BLOB_TTL_MS);

        sendResponse({ blobUrl, ...(message.hash ? { hash: sha256 } : {}) });
      })
      .catch((e) => sendResponse({ error: String((e && e.message) || e) }))
      .finally(() => activeFetches.delete(requestId));

    return true; // sendResponse is called asynchronously
  },
);

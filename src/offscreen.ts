// Chrome offscreen document (Chrome-only). A service worker has no
// URL.createObjectURL, so fetched downloads would otherwise be base64-encoded
// into a data: URL in memory (1.33x size + Chrome's data-URL cap). This page
// has a DOM: it fetches the URL and returns a blob object URL the service
// worker can hand to chrome.downloads.download — no base64, no size cap.
//
// When message.hash is set (e.g. "SHA-256"), it also digests the SAME fetched
// bytes and returns the hex hash, so a :sha256: download is fetched once here
// for both the filename and the save rather than fetched again by the worker.

import { MESSAGE_TYPES } from "./constants.ts";
import { OffscreenFetchRequest, OffscreenFetchResponse } from "./content-fetch-types.ts";

const OFFSCREEN_BLOB_TTL_MS = 5 * 60 * 1000;

const toHex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

chrome.runtime.onMessage.addListener(
  (
    message: OffscreenFetchRequest,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: OffscreenFetchResponse) => void,
  ) => {
    if (!message || message.type !== MESSAGE_TYPES.OFFSCREEN_FETCH) {
      return false;
    }

    fetch(message.url, { credentials: "include" })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.blob();
      })
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        // Free the blob once the download has had time to read it. The blob lives
        // here (as a Blob, 1x size), not as base64 in the worker.
        setTimeout(() => URL.revokeObjectURL(blobUrl), OFFSCREEN_BLOB_TTL_MS);

        // No hash requested, or the file is too large to buffer a second copy for
        // digesting: return the blob URL alone (the download still proceeds; the
        // hash just resolves empty).
        if (!message.hash || (message.maxBytes && blob.size > message.maxBytes)) {
          sendResponse({ blobUrl });
          return;
        }

        blob
          .arrayBuffer()
          .then((buf) => crypto.subtle.digest(message.hash, buf))
          .then((digest) => sendResponse({ blobUrl, hash: toHex(digest) }))
          // Hashing failed but the blob is fine — let the download go ahead
          .catch(() => sendResponse({ blobUrl }));
      })
      .catch((e) => sendResponse({ error: String((e && e.message) || e) }));

    return true; // sendResponse is called asynchronously
  },
);

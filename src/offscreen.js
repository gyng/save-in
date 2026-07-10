// Chrome offscreen document (Chrome-only). A service worker has no
// URL.createObjectURL, so fetched downloads would otherwise be base64-encoded
// into a data: URL in memory (1.33x size + Chrome's data-URL cap). This page
// has a DOM: it fetches the URL and returns a blob object URL the service
// worker can hand to chrome.downloads.download — no base64, no size cap.

const OFFSCREEN_BLOB_TTL_MS = 5 * 60 * 1000;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
      sendResponse({ blobUrl });
    })
    .catch((e) => sendResponse({ error: String((e && e.message) || e) }));

  return true; // sendResponse is called asynchronously
});

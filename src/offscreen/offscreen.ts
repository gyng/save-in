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
  isOffscreenBlobReleaseRequest,
  isOffscreenFetchRequest,
  type OffscreenFetchResponse,
} from "../shared/content-fetch-types.ts";
import {
  DEFAULT_FETCH_RESPONSE_TIMEOUT_MS,
  fetchFollowingRedirects,
} from "../shared/redirect-fetch.ts";
import { readResponseContent } from "../shared/streaming-content.ts";
import { isOffscreenPromptRequest } from "../shared/prompt-message-types.ts";
import type { OffscreenPromptResponse } from "../shared/prompt-message-types.ts";
import { runPrompt } from "../platform/prompt-api.ts";

const activeFetches = new Map<string, AbortController>();
const blobUrls = new Map<string, string>();

// The service worker cannot observe redirect hops itself, so an HTTP failure
// reports the redirected final URL back for Referer-rule extension (#193).
class HttpFailure extends Error {
  status: number;
  finalUrl: string;
  constructor(status: number, finalUrl: string) {
    super(`HTTP ${status}`);
    this.status = status;
    this.finalUrl = finalUrl;
  }
}

const releaseBlob = (requestId: string): boolean => {
  const blobUrl = blobUrls.get(requestId);
  if (!blobUrl) return false;
  blobUrls.delete(requestId);
  URL.revokeObjectURL(blobUrl);
  return true;
};

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (
      response: OffscreenFetchResponse | OffscreenPromptResponse | { canceled: boolean },
    ) => void,
  ) => {
    if (isOffscreenFetchCancelRequest(message)) {
      const controller = activeFetches.get(message.requestId);
      controller?.abort();
      sendResponse({ canceled: Boolean(controller) || releaseBlob(message.requestId) });
      return false;
    }
    if (isOffscreenBlobReleaseRequest(message)) {
      sendResponse({ canceled: releaseBlob(message.requestId) });
      return false;
    }
    if (isOffscreenPromptRequest(message)) {
      runPrompt(message.input).then(
        (output) => sendResponse({ output }),
        (error: unknown) => sendResponse({ error: String(error) }),
      );
      return true;
    }
    if (!isOffscreenFetchRequest(message)) {
      return false;
    }

    const requestId = message.requestId;
    const controller = new AbortController();
    activeFetches.set(requestId, controller);

    // Missing credentials preserves compatibility with an older background
    // that survived an update long enough to message this document.
    fetchFollowingRedirects(
      message.url,
      { credentials: message.credentials ?? "include", signal: controller.signal },
      DEFAULT_FETCH_RESPONSE_TIMEOUT_MS,
    )
      .then(async (res) => {
        if (!res.ok) {
          // The failure body must not keep its connection alive across a retry.
          if (res.body) await res.body.cancel().catch(() => {});
          throw new HttpFailure(res.status, res.url || "");
        }
        return readResponseContent(res, Boolean(message.hash), controller.signal);
      })
      .then(({ blob, sha256 }) => {
        if (controller.signal.aborted) {
          throw (
            controller.signal.reason ?? new DOMException("The operation was aborted", "AbortError")
          );
        }
        const blobUrl = URL.createObjectURL(blob);
        // Ownership is explicit: the background releases this URL after a
        // terminal downloads event. A fixed timer can revoke a very large or
        // paused download while Chrome is still consuming it.
        blobUrls.set(requestId, blobUrl);

        sendResponse({ blobUrl, ...(message.hash ? { hash: sha256 } : {}) });
      })
      .catch((e) =>
        sendResponse(
          e instanceof HttpFailure
            ? {
                error: e.message,
                status: e.status,
                ...(e.finalUrl ? { finalUrl: e.finalUrl } : {}),
              }
            : { error: String((e && e.message) || e) },
        ),
      )
      .finally(() => activeFetches.delete(requestId));

    return true; // sendResponse is called asynchronously
  },
);

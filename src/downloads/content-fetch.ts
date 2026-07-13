import { MESSAGE_TYPES } from "../shared/constants.ts";
import { OffscreenClient } from "../platform/offscreen-client.ts";
import { getExtensionFetchCredentials } from "../config/fetch-credentials.ts";
import { fetchFollowingRedirects } from "../shared/redirect-fetch.ts";
import { readResponseContent } from "../shared/streaming-content.ts";
import type {
  BlobContent,
  ContentFetchResult,
  OffscreenFetchResponse,
} from "../shared/content-fetch-types.ts";

export const HASH_FETCH_TIMEOUT_MS = 30000;

export const makeUrlFromBlob = (blob: BlobContent): Promise<string> => {
  if (typeof URL.createObjectURL === "function") {
    return Promise.resolve(URL.createObjectURL(blob as Blob));
  }

  return blob.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf);
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    const mime = blob.type || "application/octet-stream";
    return `data:${mime};base64,${btoa(binary)}`;
  });
};

export const resolveContent = (
  url: string,
  privateContext = false,
  signal?: AbortSignal,
): Promise<ContentFetchResult | null> => {
  const credentials = getExtensionFetchCredentials(privateContext);
  if (OffscreenClient.canUse()) {
    const requestId = `${Date.now()}-${Math.random()}`;
    const cancel = () => {
      void chrome.runtime
        .sendMessage({ type: MESSAGE_TYPES.OFFSCREEN_FETCH_CANCEL, requestId })
        .catch(() => {});
    };
    if (signal?.aborted) cancel();
    else signal?.addEventListener("abort", cancel, { once: true });
    return OffscreenClient.ensure()
      .then(() => {
        if (signal?.aborted) {
          throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
        }
        return chrome.runtime.sendMessage({
          type: MESSAGE_TYPES.OFFSCREEN_FETCH,
          url,
          requestId,
          hash: "SHA-256",
          credentials,
        });
      })
      .then((res: OffscreenFetchResponse) => {
        if (signal?.aborted) {
          throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
        }
        return res && res.blobUrl ? { sha256: res.hash || "", downloadUrl: res.blobUrl } : null;
      })
      .catch((error): ContentFetchResult | null => {
        if (signal?.aborted) throw error;
        return null;
      })
      .finally(() => signal?.removeEventListener("abort", cancel));
  }

  return fetchFollowingRedirects(
    url,
    { credentials, ...(signal ? { signal } : {}) },
    HASH_FETCH_TIMEOUT_MS,
  )
    .then(async (res) => {
      if (!res.ok) return null;
      const content = await readResponseContent(res, true, signal);
      const downloadUrl = URL.createObjectURL(content.blob);
      return {
        sha256: content.sha256,
        downloadUrl,
        ownedObjectUrl: downloadUrl,
      };
    })
    .catch((error): ContentFetchResult | null => {
      if (signal?.aborted) throw error;
      return null;
    });
};

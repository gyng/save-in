import { OffscreenClient } from "../platform/offscreen-client.ts";
import { getExtensionFetchCredentials } from "../config/fetch-credentials.ts";
import { fetchFollowingRedirects } from "../shared/redirect-fetch.ts";
import { readResponseContent } from "../shared/streaming-content.ts";
import type { BlobContent, ContentFetchResult } from "../shared/content-fetch-types.ts";
import { ChromeRefererRules } from "./chrome-referer-rules.ts";

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
  requestId: string = crypto.randomUUID(),
  referer?: string,
): Promise<ContentFetchResult | null> => {
  const credentials = getExtensionFetchCredentials(privateContext);
  const fetchContent = async (): Promise<ContentFetchResult> => {
    if (OffscreenClient.canUse()) {
      return OffscreenClient.fetchContent(url, credentials, {
        requestId,
        hash: true,
        ...(signal ? { signal } : {}),
      });
    }

    const res = await fetchFollowingRedirects(
      url,
      { credentials, ...(signal ? { signal } : {}) },
      HASH_FETCH_TIMEOUT_MS,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const content = await readResponseContent(res, true, signal);
    const downloadUrl = URL.createObjectURL(content.blob);
    return {
      sha256: content.sha256,
      downloadUrl,
      ownedObjectUrl: downloadUrl,
    };
  };

  const task = referer
    ? ChromeRefererRules.withReferer(url, referer, fetchContent)
    : fetchContent();
  return task.catch((error): ContentFetchResult | null => {
    if (signal?.aborted) throw error;
    return null;
  });
};

export const fetchUrlForDownload = async (
  url: string,
  privateContext = false,
  signal?: AbortSignal,
  requestId: string = crypto.randomUUID(),
  referer?: string,
): Promise<ContentFetchResult> => {
  const credentials = getExtensionFetchCredentials(privateContext);
  const fetchContent = async (): Promise<ContentFetchResult> => {
    if (OffscreenClient.canUse()) {
      return OffscreenClient.fetchContent(url, credentials, {
        requestId,
        ...(signal ? { signal } : {}),
      });
    }
    const response = await fetchFollowingRedirects(
      url,
      { credentials, ...(signal ? { signal } : {}) },
      HASH_FETCH_TIMEOUT_MS,
    );
    if (response.ok === false) throw new Error(`HTTP ${response.status}`);
    const content = await readResponseContent(response, false, signal);
    const downloadUrl = await makeUrlFromBlob(content.blob);
    return {
      sha256: "",
      downloadUrl,
      ...(downloadUrl.startsWith("blob:") ? { ownedObjectUrl: downloadUrl } : {}),
    };
  };
  return referer ? ChromeRefererRules.withReferer(url, referer, fetchContent) : fetchContent();
};

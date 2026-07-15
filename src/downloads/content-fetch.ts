import { OffscreenClient, OffscreenHttpError } from "../platform/offscreen-client.ts";
import {
  getExtensionFetchCredentials,
  type ExtensionFetchCredentials,
} from "../config/fetch-credentials.ts";
import {
  fetchProtected,
  MAX_PROTECTED_URL_EXTENSIONS,
  type RefererProtection,
} from "../shared/protected-fetch.ts";
import { fetchFollowingRedirects } from "../shared/redirect-fetch.ts";
import { readResponseContent } from "../shared/streaming-content.ts";
import type { BlobContent, ContentFetchResult } from "../shared/content-fetch-types.ts";
import { withRequestReferer } from "./referer-rules.ts";

export const HASH_FETCH_TIMEOUT_MS = 30000;

// The offscreen document reports an HTTP failure's redirected final URL;
// extending the Referer rule to that target lets a retry match it (#193).
// The requestId is reused so ActiveTransfers cancellation stays wired to the
// live attempt (a failed attempt retains no blob to release).
const offscreenFetchProtected = async (
  url: string,
  credentials: ExtensionFetchCredentials,
  options: { requestId: string; hash?: boolean; signal?: AbortSignal },
  protection?: RefererProtection,
): Promise<ContentFetchResult> => {
  for (let extensions = 0; ; extensions += 1) {
    try {
      return await OffscreenClient.fetchContent(url, credentials, options);
    } catch (error) {
      const target = error instanceof OffscreenHttpError ? error.finalUrl : undefined;
      if (!protection || !target || extensions >= MAX_PROTECTED_URL_EXTENSIONS) throw error;
      if (!(await protection.extend(target))) throw error;
    }
  }
};

export const makeUrlFromBlob = (blob: BlobContent): Promise<string> => {
  if (typeof URL.createObjectURL === "function") {
    if (!(blob instanceof Blob)) {
      return Promise.reject(new TypeError("Object URL creation requires a Blob"));
    }
    return Promise.resolve(URL.createObjectURL(blob));
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
  const fetchContent = async (protection?: RefererProtection): Promise<ContentFetchResult> => {
    if (OffscreenClient.canUse()) {
      return offscreenFetchProtected(
        url,
        credentials,
        { requestId, hash: true, ...(signal ? { signal } : {}) },
        protection,
      );
    }

    const res = await fetchProtected(
      () =>
        fetchFollowingRedirects(
          url,
          { credentials, ...(signal ? { signal } : {}) },
          HASH_FETCH_TIMEOUT_MS,
        ),
      protection,
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

  const task = referer ? withRequestReferer(url, referer, fetchContent) : fetchContent();
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
  const fetchContent = async (protection?: RefererProtection): Promise<ContentFetchResult> => {
    if (OffscreenClient.canUse()) {
      return offscreenFetchProtected(
        url,
        credentials,
        { requestId, ...(signal ? { signal } : {}) },
        protection,
      );
    }
    const response = await fetchProtected(
      () =>
        fetchFollowingRedirects(
          url,
          { credentials, ...(signal ? { signal } : {}) },
          HASH_FETCH_TIMEOUT_MS,
        ),
      protection,
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
  return referer ? withRequestReferer(url, referer, fetchContent) : fetchContent();
};

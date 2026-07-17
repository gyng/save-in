import { OffscreenClient, OffscreenHttpError } from "../platform/offscreen-client.ts";
import { getExtensionFetchCredentials } from "../config/fetch-credentials.ts";
import type { ExtensionFetchCredentials } from "../shared/content-fetch-types.ts";
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

// resolveContent (hashing) and fetchUrlForDownload (direct) share the same
// offscreen-vs-fetchProtected dispatch and Referer plumbing; only hashing, the
// sha, and the object-URL strategy differ. One fetcher keeps the two protected
// paths from drifting and reintroducing the unprotected-redirect bug (#193).
const makeContentFetcher =
  (
    url: string,
    credentials: ExtensionFetchCredentials,
    requestId: string,
    signal: AbortSignal | undefined,
    hash: boolean,
  ) =>
  async (protection?: RefererProtection): Promise<ContentFetchResult> => {
    if (OffscreenClient.canUse()) {
      return offscreenFetchProtected(
        url,
        credentials,
        { requestId, ...(hash ? { hash: true } : {}), ...(signal ? { signal } : {}) },
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
    const content = await readResponseContent(response, hash, signal);
    const downloadUrl = await makeUrlFromBlob(content.blob);
    return {
      sha256: hash ? content.sha256 : "",
      downloadUrl,
      ...(downloadUrl.startsWith("blob:") ? { ownedObjectUrl: downloadUrl } : {}),
    };
  };

export const resolveContent = (
  url: string,
  privateContext = false,
  signal?: AbortSignal,
  requestId: string = crypto.randomUUID(),
  referer?: string,
): Promise<ContentFetchResult | null> => {
  const credentials = getExtensionFetchCredentials(privateContext);
  const fetchContent = makeContentFetcher(url, credentials, requestId, signal, true);
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
  const fetchContent = makeContentFetcher(url, credentials, requestId, signal, false);
  return referer ? withRequestReferer(url, referer, fetchContent) : fetchContent();
};

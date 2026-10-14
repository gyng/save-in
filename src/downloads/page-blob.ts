import { webExtensionApi } from "../platform/web-extension-api.ts";
import {
  isPageBlobUrl,
  PAGE_BLOB_CHUNK_BYTES,
  PAGE_BLOB_PORT,
  PAGE_BLOB_TIMEOUT_MS,
  PAGE_BLOB_UNAVAILABLE,
} from "../shared/page-blob.ts";
import { getMessage } from "../platform/localization.ts";
import { Sha256 } from "../shared/sha256.ts";
import type { ContentFetchResult } from "../shared/content-fetch-types.ts";
import { mimeToExtension } from "../routing/variable.ts";
import { OffscreenClient } from "../platform/offscreen-client.ts";
import { makeUrlFromBlob } from "./content-fetch.ts";
import type { DownloadPipelineState } from "./download-types.ts";

export type PageBlobMetadata = { size: number; mime: string };

type PageBlobTarget = { tabId: number; frameId: number; url: string };

// The detail stays on cause for the log; the user sees what they can do.
const copyFailed = (detail: string) =>
  new Error(getMessage("pageBlobCopyFailed"), { cause: detail });

// Without onChunk only the metadata is read: the content script fetches its
// own blob locally, and no bytes cross the port until a save needs them.
export const readPageBlob = (
  { tabId, frameId, url }: PageBlobTarget,
  signal?: AbortSignal,
  onChunk?: (bytes: Uint8Array<ArrayBuffer>, data: string) => void | Promise<void>,
): Promise<PageBlobMetadata> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const port = webExtensionApi.tabs.connect(tabId, { name: PAGE_BLOB_PORT, frameId });
    let metadata: PageBlobMetadata | undefined;
    let received = 0;
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      port.onMessage.removeListener(onMessage);
      port.onDisconnect.removeListener(onDisconnect);
      port.disconnect();
    };
    const fail = (error: unknown) => {
      cleanup();
      reject(error);
    };
    const onAbort = () => fail(signal?.reason);
    const onDisconnect = () => {
      void webExtensionApi.runtime.lastError;
      // Chrome reports a frame without a listener as an immediate disconnect;
      // so does a content script left from before an extension update.
      fail(new Error(getMessage("pageBlobReloadPage")));
    };
    const request = (message: object) => {
      clearTimeout(timer);
      timer = setTimeout(
        () => fail(new Error(getMessage("pageBlobTimedOut"))),
        PAGE_BLOB_TIMEOUT_MS,
      );
      port.postMessage(message);
    };
    const receive = async (message: unknown) => {
      if (!message || typeof message !== "object") throw copyFailed("Invalid blob response");
      const type: unknown = Reflect.get(message, "type");
      if (type === "error") {
        throw Reflect.get(message, "reason") === PAGE_BLOB_UNAVAILABLE
          ? new Error(getMessage("pageBlobUnavailable"))
          : copyFailed("Page refused the blob request");
      }
      if (metadata === undefined && type === "metadata") {
        const length: unknown = Reflect.get(message, "size");
        const contentType: unknown = Reflect.get(message, "mime");
        if (
          typeof length !== "number" ||
          !Number.isSafeInteger(length) ||
          length < 0 ||
          typeof contentType !== "string" ||
          contentType.length > 255
        )
          throw copyFailed("Invalid blob metadata");
        metadata = { size: length, mime: contentType };
        if (!onChunk) {
          cleanup();
          resolve(metadata);
          return;
        }
      } else if (onChunk && metadata !== undefined && type === "chunk") {
        const data: unknown = Reflect.get(message, "data");
        if (typeof data !== "string" || data.length > Math.ceil(PAGE_BLOB_CHUNK_BYTES / 3) * 4) {
          throw copyFailed("Invalid blob chunk");
        }
        const binary = atob(data);
        if (
          !binary.length ||
          binary.length > PAGE_BLOB_CHUNK_BYTES ||
          received + binary.length > metadata.size
        ) {
          throw copyFailed("Invalid blob length");
        }
        received += binary.length;
        await onChunk(
          Uint8Array.from(binary, (character) => character.charCodeAt(0)),
          data,
        );
      } else if (metadata !== undefined && type === "done" && received === metadata.size) {
        cleanup();
        resolve(metadata);
        return;
      } else throw copyFailed("Incomplete page image transfer");
      request({ type: "read" });
    };
    // One request is outstanding at a time, so a chunk is fully consumed
    // before the next is requested.
    const onMessage = (message: unknown) => {
      receive(message).catch(fail);
    };
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      request({ type: "open", url });
    } catch (error) {
      fail(error);
    }
  });

const loadPageBlob = async (
  target: PageBlobTarget,
  hash: boolean,
  signal?: AbortSignal,
): Promise<ContentFetchResult> => {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const sha256 = hash ? new Sha256() : undefined;
  if (OffscreenClient.canUse()) {
    // Chrome's worker has no object URLs, and a whole-file data URL would
    // copy the blob again at 4/3 size into one string. Assemble it in the
    // offscreen document, as fetched downloads are.
    const offscreenRequestId = crypto.randomUUID();
    try {
      const { mime } = await readPageBlob(target, signal, (bytes, data) => {
        sha256?.update(bytes);
        return OffscreenClient.appendBlob(offscreenRequestId, data);
      });
      const downloadUrl = await OffscreenClient.completeBlob(offscreenRequestId, mime);
      return { downloadUrl, sha256: sha256?.hex() ?? "", offscreenRequestId };
    } catch (error) {
      void OffscreenClient.cancel(offscreenRequestId).catch(() => {});
      throw error;
    }
  }
  const { mime } = await readPageBlob(target, signal, (bytes) => {
    sha256?.update(bytes);
    chunks.push(bytes);
  });
  const downloadUrl = await makeUrlFromBlob(new Blob(chunks, { type: mime }));
  return {
    downloadUrl,
    sha256: sha256?.hex() ?? "",
    ...(downloadUrl.startsWith("blob:") ? { ownedObjectUrl: downloadUrl } : {}),
  };
};

export const preparePageBlob = (state: DownloadPipelineState): Promise<void> | undefined => {
  const { info } = state;
  const url = info.url;
  // Extension-generated object URLs never have an HTTP(S) origin.
  if (!url || !isPageBlobUrl(url) || info.contentPromise || info.loadContent) return;
  const tabId = info.currentTab?.id;
  if (tabId === undefined || !Number.isSafeInteger(tabId) || tabId < 0) return;
  const frameId =
    typeof info.frameId === "number" && Number.isSafeInteger(info.frameId) && info.frameId >= 0
      ? info.frameId
      : 0;
  const target = { tabId, frameId, url };
  // Routing needs only the type. The bytes are requested again, from the same
  // immutable blob, once a matched save or a :sha256: template needs them.
  return readPageBlob(target, info.abortSignal).then(({ mime }) => {
    info.loadContent = (_requestId, hash) => loadPageBlob(target, hash, info.abortSignal);
    info.resolvedHead = { contentType: mime, finalUrl: url };
    info.mime = mime;
    const extension = mimeToExtension(mime);
    if (!info.suggestedFilename && extension) {
      info.suggestedFilename = `${url.slice(url.lastIndexOf("/") + 1)}.${extension}`;
      state.scratch.syntheticSuggestedFilename = true;
    }
  });
};

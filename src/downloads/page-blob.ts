import { webExtensionApi } from "../platform/web-extension-api.ts";
import {
  isPageBlobUrl,
  PAGE_BLOB_CHUNK_BYTES,
  PAGE_BLOB_PORT,
  PAGE_BLOB_TIMEOUT_MS,
} from "../shared/page-blob.ts";
import { Sha256 } from "../shared/sha256.ts";
import { mimeToExtension } from "../routing/variable.ts";
import { makeUrlFromBlob } from "./content-fetch.ts";
import { downloadRuntime } from "./download-runtime-instance.ts";
import type { DownloadPipelineState } from "./download-types.ts";

export const readPageBlob = (
  tabId: number,
  frameId: number,
  url: string,
  signal?: AbortSignal,
): Promise<{ blob: Blob; sha256: string }> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const port = webExtensionApi.tabs.connect(tabId, { name: PAGE_BLOB_PORT, frameId });
    const chunks: ArrayBuffer[] = [];
    const hash = new Sha256();
    let size: number | undefined;
    let received = 0;
    let mime = "";
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
      fail(new Error("Page image is no longer available. Reload the page and try again."));
    };
    const request = (message: object) => {
      clearTimeout(timer);
      timer = setTimeout(
        () => fail(new Error("Page image transfer timed out")),
        PAGE_BLOB_TIMEOUT_MS,
      );
      port.postMessage(message);
    };
    const onMessage = (message: unknown) => {
      try {
        if (!message || typeof message !== "object") throw new Error("Invalid blob response");
        const type: unknown = Reflect.get(message, "type");
        if (size === undefined && type === "metadata") {
          const length: unknown = Reflect.get(message, "size");
          const contentType: unknown = Reflect.get(message, "mime");
          if (
            typeof length !== "number" ||
            !Number.isSafeInteger(length) ||
            length < 0 ||
            typeof contentType !== "string" ||
            contentType.length > 255
          )
            throw new Error("Invalid blob metadata");
          size = length;
          mime = contentType;
        } else if (size !== undefined && type === "chunk") {
          const data: unknown = Reflect.get(message, "data");
          if (typeof data !== "string" || data.length > Math.ceil(PAGE_BLOB_CHUNK_BYTES / 3) * 4) {
            throw new Error("Invalid blob chunk");
          }
          const binary = atob(data);
          if (
            !binary.length ||
            binary.length > PAGE_BLOB_CHUNK_BYTES ||
            received + binary.length > size
          ) {
            throw new Error("Invalid blob length");
          }
          const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
          received += bytes.length;
          hash.update(bytes);
          chunks.push(bytes.buffer);
        } else if (size !== undefined && type === "done" && received === size) {
          cleanup();
          resolve({ blob: new Blob(chunks, { type: mime }), sha256: hash.hex() });
          return;
        } else throw new Error("Incomplete page image transfer");
        request({ type: "read" });
      } catch (error) {
        fail(error);
      }
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

export const preparePageBlob = (state: DownloadPipelineState): Promise<void> | undefined => {
  const { info } = state;
  const url = info.url;
  if (
    !url ||
    !isPageBlobUrl(url) ||
    info.contentPromise ||
    downloadRuntime.generatedObjectUrls.has(url)
  )
    return;
  const tabId = info.currentTab?.id;
  if (tabId === undefined || !Number.isSafeInteger(tabId) || tabId < 0) return;
  const frameId =
    typeof info.frameId === "number" && Number.isSafeInteger(info.frameId) && info.frameId >= 0
      ? info.frameId
      : 0;
  info.onContentFetchStart?.(crypto.randomUUID());
  return readPageBlob(tabId, frameId, url, info.abortSignal).then(async (content) => {
    if (info.abortSignal?.aborted) throw info.abortSignal.reason;
    const downloadUrl = await makeUrlFromBlob(content.blob);
    info.contentPromise = Promise.resolve({
      downloadUrl,
      sha256: content.sha256,
      ...(downloadUrl.startsWith("blob:") ? { ownedObjectUrl: downloadUrl } : {}),
    });
    info.resolvedHead = { contentType: content.blob.type, finalUrl: url };
    info.mime = content.blob.type;
    info.sha256 = content.sha256;
    const extension = mimeToExtension(content.blob.type);
    if (!info.suggestedFilename && extension) {
      info.suggestedFilename = `${url.slice(url.lastIndexOf("/") + 1)}.${extension}`;
    }
  });
};

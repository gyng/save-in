import {
  isPageBlobUrl,
  PAGE_BLOB_CHUNK_BYTES,
  PAGE_BLOB_PORT,
  PAGE_BLOB_TIMEOUT_MS,
  PAGE_BLOB_UNAVAILABLE,
} from "../shared/page-blob.ts";

// A revoked blob and a MediaSource URL both fail here; the page still holds
// neither as readable bytes, so reloading cannot help.
class UnreadableBlob extends Error {}
const unreadable = (error: unknown): never => {
  throw new UnreadableBlob(String(error));
};

export const servePageBlob = (port: chrome.runtime.Port): void => {
  if (port.name !== PAGE_BLOB_PORT) return;
  if (port.sender?.id !== chrome.runtime.id || port.sender.tab) {
    port.disconnect();
    return;
  }
  const controller = new AbortController();
  let blob: Blob | undefined;
  let offset = 0;
  let started = false;
  let busy = false;
  let closed = false;
  let timer: ReturnType<typeof setTimeout>;
  const cleanup = () => {
    closed = true;
    clearTimeout(timer);
    controller.abort();
    blob = undefined;
    port.onMessage.removeListener(onMessage);
    port.onDisconnect.removeListener(onDisconnect);
  };
  const onDisconnect = () => {
    void chrome.runtime.lastError;
    cleanup();
  };
  const close = () => {
    cleanup();
    port.disconnect();
  };
  const resetTimeout = () => {
    clearTimeout(timer);
    timer = setTimeout(close, PAGE_BLOB_TIMEOUT_MS);
  };
  const reply = (message: object) => {
    busy = false;
    port.postMessage(message);
  };
  const read = async (message: unknown) => {
    if (!message || typeof message !== "object") throw new Error("Invalid blob request");
    const type: unknown = Reflect.get(message, "type");
    if (!started && type === "open") {
      const url: unknown = Reflect.get(message, "url");
      if (typeof url !== "string" || !isPageBlobUrl(url, location.origin)) {
        throw new Error("Blob does not belong to this page");
      }
      started = true;
      // Fetch in the isolated content script: Firefox's background principal
      // cannot read the page's blob, even with host permission. Never revoke
      // the original URL; the page still owns and displays it.
      const content = await fetch(url, { signal: controller.signal, credentials: "omit" })
        .then((response) => response.blob())
        .catch(unreadable);
      if (closed) return;
      blob = content;
      reply({ type: "metadata", size: blob.size, mime: blob.type });
    } else if (blob && type === "read") {
      if (offset === blob.size) {
        reply({ type: "done" });
        return;
      }
      const bytes = new Uint8Array(
        await blob
          .slice(offset, offset + PAGE_BLOB_CHUNK_BYTES)
          .arrayBuffer()
          .catch(unreadable),
      );
      if (closed) return;
      offset += bytes.length;
      // A pull per chunk bounds the port queue and avoids a whole-file base64
      // string. Chrome ports serialize JSON rather than structured-clone Blob.
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      reply({ type: "chunk", data: btoa(binary) });
    } else throw new Error("Unexpected blob request");
  };
  const onMessage = (message: unknown) => {
    if (busy || closed) {
      close();
      return;
    }
    busy = true;
    resetTimeout();
    void read(message).catch((error: unknown) => {
      if (closed) return;
      // The background can only explain a failure this script reports; a bare
      // disconnect means no current content script answered. It disconnects
      // on receipt, so the report never races this side's own disconnect.
      cleanup();
      try {
        port.postMessage({
          type: "error",
          ...(error instanceof UnreadableBlob ? { reason: PAGE_BLOB_UNAVAILABLE } : {}),
        });
      } catch {
        port.disconnect();
      }
    });
  };
  port.onMessage.addListener(onMessage);
  port.onDisconnect.addListener(onDisconnect);
  resetTimeout();
};

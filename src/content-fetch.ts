import { MESSAGE_TYPES } from "./constants.ts";
import { OffscreenClient } from "./offscreen-client.ts";

export const HASH_MAX_BYTES = 256 * 1024 * 1024;
export const HASH_FETCH_TIMEOUT_MS = 30000;

export const makeUrlFromBlob = (blob) => {
  if (typeof URL.createObjectURL === "function") {
    return Promise.resolve(URL.createObjectURL(blob));
  }

  return blob.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf);
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    const mime = blob.type || "application/octet-stream";
    return `data:${mime};base64,${btoa(binary)}`;
  });
};

export const resolveContent = (url) => {
  if (OffscreenClient.canUse()) {
    return OffscreenClient.ensure()
      .then(() =>
        chrome.runtime.sendMessage({
          type: MESSAGE_TYPES.OFFSCREEN_FETCH,
          url,
          hash: "SHA-256",
          maxBytes: HASH_MAX_BYTES,
        }),
      )
      .then((res) =>
        res && res.blobUrl ? { sha256: res.hash || "", downloadUrl: res.blobUrl } : null,
      )
      .catch(() => null);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HASH_FETCH_TIMEOUT_MS);
  return fetch(url, { credentials: "include", signal: controller.signal })
    .then((res) => {
      if (!res.ok || Number(res.headers.get("Content-Length")) > HASH_MAX_BYTES) return null;
      return res.blob();
    })
    .then((blob) => {
      if (!blob || blob.size > HASH_MAX_BYTES) return null;
      return blob.arrayBuffer().then((buf) =>
        crypto.subtle.digest("SHA-256", buf).then((digest) => ({
          sha256: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""),
          downloadUrl: URL.createObjectURL(blob),
        })),
      );
    })
    .catch(() => null)
    .finally(() => clearTimeout(timer));
};

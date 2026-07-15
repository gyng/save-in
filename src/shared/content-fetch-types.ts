import { MESSAGE_TYPES } from "./constants.ts";

export type ContentFetchResult = {
  sha256: string;
  downloadUrl: string;
  ownedObjectUrl?: string;
  offscreenRequestId?: string;
};

export type BlobContent = Pick<Blob, "type" | "size" | "arrayBuffer">;

export type OffscreenFetchRequest = {
  type: typeof MESSAGE_TYPES.OFFSCREEN_FETCH;
  url: string;
  requestId?: string;
  hash?: string;
  // Accepted for compatibility with a background from an older extension
  // instance. Streaming hashing no longer applies this limit.
  maxBytes?: number;
  credentials?: "include" | "omit";
};

export type OffscreenFetchCancelRequest = {
  type: typeof MESSAGE_TYPES.OFFSCREEN_FETCH_CANCEL;
  requestId: string;
};

export type OffscreenBlobReleaseRequest = {
  type: typeof MESSAGE_TYPES.OFFSCREEN_BLOB_RELEASE;
  requestId: string;
};

export type OffscreenFetchResponse = {
  blobUrl?: string;
  hash?: string;
  error?: string;
  // HTTP failure detail lets the background extend Referer protection to the
  // redirected target and retry (#193). Optional so responses from an
  // offscreen document of an older extension instance stay valid.
  status?: number;
  finalUrl?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isOffscreenFetchRequest = (value: unknown): value is OffscreenFetchRequest =>
  isRecord(value) &&
  value.type === MESSAGE_TYPES.OFFSCREEN_FETCH &&
  typeof value.url === "string" &&
  (typeof value.requestId === "undefined" || typeof value.requestId === "string") &&
  (typeof value.hash === "undefined" || typeof value.hash === "string") &&
  (typeof value.credentials === "undefined" ||
    value.credentials === "include" ||
    value.credentials === "omit") &&
  (typeof value.maxBytes === "undefined" ||
    (typeof value.maxBytes === "number" &&
      Number.isSafeInteger(value.maxBytes) &&
      value.maxBytes >= 0));

export const isOffscreenFetchCancelRequest = (
  value: unknown,
): value is OffscreenFetchCancelRequest =>
  isRecord(value) &&
  value.type === MESSAGE_TYPES.OFFSCREEN_FETCH_CANCEL &&
  typeof value.requestId === "string";

export const isOffscreenBlobReleaseRequest = (
  value: unknown,
): value is OffscreenBlobReleaseRequest =>
  isRecord(value) &&
  value.type === MESSAGE_TYPES.OFFSCREEN_BLOB_RELEASE &&
  typeof value.requestId === "string";

export const isOffscreenFetchResponse = (value: unknown): value is OffscreenFetchResponse =>
  isRecord(value) &&
  ["blobUrl", "hash", "error", "finalUrl"].every(
    (key) => typeof value[key] === "undefined" || typeof value[key] === "string",
  ) &&
  (typeof value.status === "undefined" || typeof value.status === "number");

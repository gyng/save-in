export type ContentFetchResult = {
  sha256: string;
  downloadUrl: string;
};

export type BlobContent = {
  type: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

export type OffscreenFetchRequest = {
  type: typeof MESSAGE_TYPES.OFFSCREEN_FETCH;
  url: string;
  hash?: string;
  maxBytes?: number;
};

export type OffscreenFetchResponse = {
  blobUrl?: string;
  hash?: string;
  error?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isOffscreenFetchRequest = (value: unknown): value is OffscreenFetchRequest =>
  isRecord(value) &&
  value.type === MESSAGE_TYPES.OFFSCREEN_FETCH &&
  typeof value.url === "string" &&
  (typeof value.hash === "undefined" || typeof value.hash === "string") &&
  (typeof value.maxBytes === "undefined" ||
    (typeof value.maxBytes === "number" && Number.isFinite(value.maxBytes) && value.maxBytes >= 0));

export const isOffscreenFetchResponse = (value: unknown): value is OffscreenFetchResponse =>
  isRecord(value) &&
  ["blobUrl", "hash", "error"].every(
    (key) => typeof value[key] === "undefined" || typeof value[key] === "string",
  );
import { MESSAGE_TYPES } from "./constants.ts";

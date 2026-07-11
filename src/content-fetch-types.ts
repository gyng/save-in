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
  type: string;
  url: string;
  hash?: string;
  maxBytes?: number;
};

export type OffscreenFetchResponse = {
  blobUrl?: string;
  hash?: string;
  error?: string;
};

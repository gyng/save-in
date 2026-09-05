// The content reader and download acquisition live in separate execution
// contexts. Only this bounded, JSON-compatible transport contract is shared.
export const PAGE_BLOB_PORT = "SAVE_IN_PAGE_BLOB";
export const PAGE_BLOB_CHUNK_BYTES = 64 * 1024;
export const PAGE_BLOB_TIMEOUT_MS = 30_000;

export const isPageBlobUrl = (value: string, origin?: string): boolean => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "blob:" &&
      /^https?:\/\//.test(url.origin) &&
      (origin === undefined || url.origin === origin)
    );
  } catch {
    return false;
  }
};

import type { ContentFetchResult } from "./content-fetch-types.ts";

export type HeadMetadata = {
  contentType: string;
  finalUrl: string;
  contentDisposition?: string | undefined;
};

export type LazyDownloadMetadata<Content extends ContentFetchResult = ContentFetchResult> = {
  headPromise?: Promise<HeadMetadata> | undefined;
  resolvedHead?: HeadMetadata | undefined;
  contentPromise?: Promise<Content | null> | undefined;
  sha256?: string | undefined;
  // Chrome uses this sanitized value only around exact extension-owned
  // metadata/content requests; it is not serialized into persisted state.
  protectedFetchReferer?: string | undefined;
};

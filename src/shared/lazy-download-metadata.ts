import type { ContentFetchResult } from "./content-fetch-types.ts";

export type HeadMetadata = {
  contentType: string;
  finalUrl: string;
};

export type LazyDownloadMetadata<Content extends ContentFetchResult = ContentFetchResult> = {
  headPromise?: Promise<HeadMetadata> | undefined;
  resolvedHead?: HeadMetadata | undefined;
  contentPromise?: Promise<Content | null> | undefined;
  sha256?: string | undefined;
};

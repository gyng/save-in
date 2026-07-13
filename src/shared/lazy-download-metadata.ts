import type { ContentFetchResult } from "./content-fetch-types.ts";

export type HeadMetadata = {
  contentType: string;
  finalUrl: string;
};

export type LazyDownloadMetadata<Content extends ContentFetchResult = ContentFetchResult> = {
  headPromise?: Promise<HeadMetadata>;
  resolvedHead?: HeadMetadata;
  contentPromise?: Promise<Content | null>;
  sha256?: string;
};

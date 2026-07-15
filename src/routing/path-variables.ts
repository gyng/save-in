import { SPECIAL_DIRS } from "../shared/constants.ts";

export type UnknownPathVariable = {
  value: string;
  start: number;
  end: number;
};

const knownPathVariables = new Set<string>(Object.values(SPECIAL_DIRS));

export const findUnknownPathVariables = (path: string): UnknownPathVariable[] =>
  [...path.matchAll(/:[A-Za-z][A-Za-z0-9_]*:/g)]
    .filter((match) => !knownPathVariables.has(match[0]))
    .map((match) => ({
      value: match[0],
      start: match.index,
      end: match.index + match[0].length,
    }));

// These variables trigger a metadata or content fetch of the current download
// URL. A fetch: template exists to CHOOSE that URL, so allowing them would
// fetch the original resource in order to compute its replacement — circular,
// slow, and immediately invalidated by the rewrite.
export const FETCH_URL_BANNED_VARIABLES: ReadonlySet<string> = new Set<string>([
  SPECIAL_DIRS.MIME,
  SPECIAL_DIRS.CONTENT_TYPE,
  SPECIAL_DIRS.MIME_EXT,
  SPECIAL_DIRS.SHA256,
  SPECIAL_DIRS.SHA256_FULL,
  SPECIAL_DIRS.FINAL_URL,
  SPECIAL_DIRS.REDIRECT_URL,
]);

export const findBannedFetchVariables = (template: string): UnknownPathVariable[] =>
  [...template.matchAll(/:[A-Za-z][A-Za-z0-9_]*:/g)]
    .filter((match) => FETCH_URL_BANNED_VARIABLES.has(match[0]))
    .map((match) => ({
      value: match[0],
      start: match.index,
      end: match.index + match[0].length,
    }));

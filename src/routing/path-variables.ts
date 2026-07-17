import { SPECIAL_DIRS } from "../shared/constants.ts";

export type UnknownPathVariable = {
  value: string;
  start: number;
  end: number;
};

const knownPathVariables = new Set<string>(Object.values(SPECIAL_DIRS));

const isInsideBracketedHost = (value: string, index: number): boolean =>
  value.lastIndexOf("[", index) > value.lastIndexOf("]", index);

const isKnownVariableBody = (body: string): boolean =>
  knownPathVariables.has(`:${body}:`) || /^\$\d+$/.test(body);

export const findUnknownPathVariables = (path: string): UnknownPathVariable[] => {
  const completeOrTerminal = [...path.matchAll(/:[A-Za-z$][A-Za-z0-9_$-]*(?::|(?=[/\\]|$))/g)]
    .filter(
      (match) =>
        !isInsideBracketedHost(path, match.index) &&
        !knownPathVariables.has(match[0]) &&
        !/^:\$\d+:$/.test(match[0]),
    )
    .map((match) => ({
      value: match[0],
      start: match.index,
      end: match.index + match[0].length,
    }));
  const missingClosers = [...path.matchAll(/:([A-Za-z$][A-Za-z0-9_$-]*)/g)]
    .filter((match) => {
      const body = match[1];
      const end = match.index + match[0].length;
      return (
        body !== undefined &&
        path[end] !== ":" &&
        !isInsideBracketedHost(path, match.index) &&
        isKnownVariableBody(body)
      );
    })
    .map((match) => ({
      value: match[0],
      start: match.index,
      end: match.index + match[0].length,
    }));
  return [...completeOrTerminal, ...missingClosers]
    .filter(
      (candidate, index, all) =>
        all.findIndex((other) => other.start === candidate.start && other.end === candidate.end) ===
        index,
    )
    .toSorted((left, right) => left.start - right.start);
};

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

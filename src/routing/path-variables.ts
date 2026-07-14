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

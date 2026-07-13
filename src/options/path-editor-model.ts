import {
  parsePathLine,
  parsePathMetadata,
  serializePathLine,
  setPathMetadata,
  type PathRow,
} from "../config/path-lines.ts";

export { parsePathLine, serializePathLine };
export type { PathRow };

export const pathLinesToRows = (text: string): PathRow[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parsePathLine);

export const pathRowsToLines = (rows: PathRow[]): string[] => rows.map(serializePathLine);

export const getPathAlias = (comment: string): string =>
  parsePathMetadata(comment || "").alias ?? "";

export const setPathAlias = (comment: string, alias: string): string =>
  setPathMetadata(comment || "", "alias", alias);

export const getPathSourceRange = (
  text: string,
  sourceIndex: number,
): { start: number; end: number } | null => {
  let offset = 0;
  let currentSourceIndex = 0;
  for (const line of text.split("\n")) {
    const leadingWhitespace = line.length - line.trimStart().length;
    const trimmed = line.trim();
    if (trimmed) {
      if (currentSourceIndex === sourceIndex) {
        return {
          start: offset + leadingWhitespace,
          end: offset + leadingWhitespace + trimmed.length,
        };
      }
      currentSourceIndex += 1;
    }
    offset += line.length + 1;
  }
  return null;
};

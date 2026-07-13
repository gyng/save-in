import { parsePathLine, serializePathLine, type PathRow } from "../config/path-lines.ts";

export { parsePathLine, serializePathLine };
export type { PathRow };

export const pathLinesToRows = (text: string): PathRow[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parsePathLine);

export const pathRowsToLines = (rows: PathRow[]): string[] => rows.map(serializePathLine);

export const getPathAlias = (comment: string): string => {
  const match = (comment || "").match(/\(alias:\s*([^)]*)\)/);
  return match?.[1]?.trim() ?? "";
};

export const setPathAlias = (comment: string, alias: string): string => {
  const cleaned = (comment || "").replace(/\s*\(alias:\s*[^)]*\)/, "").trim();
  if (!alias) return cleaned;
  return cleaned ? `${cleaned} (alias: ${alias})` : `(alias: ${alias})`;
};

import {
  getDirectoryMetadata,
  parsePathLineAst,
  serializeDirectoryLine,
  updateDirectoryLine,
  updateDirectoryMetadata,
  type DirectoryLineNode,
  type DirectoryLineUpdate,
} from "../config/path-lines.ts";

export { serializeDirectoryLine, updateDirectoryLine };
export type { DirectoryLineNode, DirectoryLineUpdate };

export const parseDirectoryLine = (line: string): DirectoryLineNode => parsePathLineAst(line).ast;

export const pathLinesToNodes = (text: string): DirectoryLineNode[] =>
  text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map(parseDirectoryLine);

export const pathNodesToLines = (nodes: DirectoryLineNode[]): string[] =>
  nodes.map(serializeDirectoryLine);

export const getPathAlias = (node: DirectoryLineNode): string =>
  getDirectoryMetadata(node, "alias");

export const setPathAlias = (node: DirectoryLineNode, alias: string): DirectoryLineNode =>
  updateDirectoryMetadata(node, "alias", alias);

export const getPathEnabled = (node: DirectoryLineNode): boolean =>
  getDirectoryMetadata(node, "disabled").toLowerCase() !== "true";

export const setPathEnabled = (node: DirectoryLineNode, enabled: boolean): DirectoryLineNode => {
  const updated = updateDirectoryMetadata(node, "disabled", enabled ? "" : "true");
  return enabled && updated.comment === null ? parsePathLineAst(updated.raw.trimEnd()).ast : updated;
};

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

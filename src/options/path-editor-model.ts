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

export type PathDropPlacement = "before" | "after" | "inside";

export const normalizePathHierarchy = (
  nodes: readonly DirectoryLineNode[],
): DirectoryLineNode[] => {
  const normalized: DirectoryLineNode[] = [];
  nodes.forEach((node, index) => {
    const previousDepth = normalized[index - 1]?.depth ?? 0;
    normalized.push(
      updateDirectoryLine(node, {
        depth: index === 0 ? 0 : Math.min(node.depth, previousDepth + 1),
      }),
    );
  });
  return normalized;
};

export const reorderPathNode = (
  nodes: readonly DirectoryLineNode[],
  from: number,
  destination: number,
): DirectoryLineNode[] => {
  if (from === destination || !nodes[from] || destination < 0 || destination >= nodes.length) {
    return [...nodes];
  }
  const reordered = [...nodes];
  const [moved] = reordered.splice(from, 1);
  if (!moved) return reordered;
  reordered.splice(destination, 0, moved);
  return normalizePathHierarchy(reordered);
};

export const dropPathNode = (
  nodes: readonly DirectoryLineNode[],
  from: number,
  targetIndex: number,
  placement: PathDropPlacement,
): DirectoryLineNode[] => {
  const target = nodes[targetIndex];
  const moved = nodes[from];
  if (!target || !moved || from === targetIndex) return [...nodes];

  const reordered = [...nodes];
  reordered.splice(from, 1);
  const adjustedTarget = from < targetIndex ? targetIndex - 1 : targetIndex;
  const currentTargetIndex = reordered.indexOf(target);
  const destination =
    placement === "inside"
      ? currentTargetIndex + 1
      : adjustedTarget + (placement === "after" ? 1 : 0);
  reordered.splice(
    destination,
    0,
    updateDirectoryLine(moved, {
      depth: placement === "inside" ? target.depth + 1 : target.depth,
    }),
  );
  return normalizePathHierarchy(reordered);
};

export const deletePathNode = (
  nodes: readonly DirectoryLineNode[],
  index: number,
): DirectoryLineNode[] => {
  const deleted = nodes[index];
  if (!deleted) return [...nodes];
  const remaining = [...nodes];
  remaining.splice(index, 1);
  for (let child = index; child < remaining.length; child++) {
    const childNode = remaining[child];
    if (!childNode || childNode.depth <= deleted.depth) break;
    remaining[child] = updateDirectoryLine(childNode, { depth: childNode.depth - 1 });
  }
  return remaining;
};

export const getPathAlias = (node: DirectoryLineNode): string =>
  getDirectoryMetadata(node, "alias");

export const setPathAlias = (node: DirectoryLineNode, alias: string): DirectoryLineNode =>
  updateDirectoryMetadata(node, "alias", alias);

export const getPathEnabled = (node: DirectoryLineNode): boolean =>
  getDirectoryMetadata(node, "disabled").toLowerCase() !== "true";

export const setPathEnabled = (node: DirectoryLineNode, enabled: boolean): DirectoryLineNode => {
  const updated = updateDirectoryMetadata(node, "disabled", enabled ? "" : "true");
  return enabled && updated.comment === null
    ? parsePathLineAst(updated.raw.trimEnd()).ast
    : updated;
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

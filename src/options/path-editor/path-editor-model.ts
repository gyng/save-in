import {
  getDirectoryMetadata,
  parsePathLineAst,
  serializeDirectoryLine,
  updateDirectoryLine,
  updateDirectoryMetadata,
  type DirectoryLineNode,
  type DirectoryLineUpdate,
} from "../../config/path-lines.ts";

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

const normalizePathHierarchy = (
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

const pathSubtreeEnd = (nodes: readonly DirectoryLineNode[], start: number): number => {
  const root = nodes[start];
  /* v8 ignore next -- Application callers pass dense arrays produced by pathLinesToNodes. */
  if (!root) return start;
  let end = start + 1;
  while (end < nodes.length) {
    const node = nodes[end];
    if (!node || node.depth <= root.depth) break;
    end += 1;
  }
  return end;
};

export const reorderPathNode = (
  nodes: readonly DirectoryLineNode[],
  from: number,
  destination: number,
): DirectoryLineNode[] => {
  const moved = nodes[from];
  if (from === destination || !moved || destination < 0 || destination >= nodes.length) {
    return [...nodes];
  }
  const sourceEnd = pathSubtreeEnd(nodes, from);
  const source = nodes.slice(from, sourceEnd);
  if (destination > from) {
    // An adjacent destination can be inside the selected parent's subtree;
    // skip past it so moving the parent never silently reparents its children.
    const targetStart = Math.max(destination, sourceEnd);
    if (targetStart >= nodes.length) return [...nodes];
    const targetEnd = pathSubtreeEnd(nodes, targetStart);
    return normalizePathHierarchy([
      ...nodes.slice(0, from),
      ...nodes.slice(sourceEnd, targetEnd),
      ...source,
      ...nodes.slice(targetEnd),
    ]);
  }

  const sourceDepth = moved.depth;
  let targetStart = destination;
  while (targetStart > 0) {
    const target = nodes[targetStart];
    /* v8 ignore next -- Application callers pass dense arrays produced by pathLinesToNodes. */
    if (!target || target.depth <= sourceDepth) break;
    targetStart -= 1;
  }
  return normalizePathHierarchy([
    ...nodes.slice(0, targetStart),
    ...source,
    ...nodes.slice(targetStart, from),
    ...nodes.slice(sourceEnd),
  ]);
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

  const sourceEnd = pathSubtreeEnd(nodes, from);
  if (targetIndex > from && targetIndex < sourceEnd) return [...nodes];
  const source = nodes.slice(from, sourceEnd);

  const reordered = [...nodes.slice(0, from), ...nodes.slice(sourceEnd)];
  const currentTargetIndex = reordered.indexOf(target);
  const destination = placement === "inside" ? currentTargetIndex + 1 : currentTargetIndex;
  const insertAt = placement === "after" ? pathSubtreeEnd(reordered, destination) : destination;
  const destinationDepth = placement === "inside" ? target.depth + 1 : target.depth;
  const depthOffset = destinationDepth - moved.depth;
  reordered.splice(
    insertAt,
    0,
    ...source.map((node) => updateDirectoryLine(node, { depth: node.depth + depthOffset })),
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

export const getPathAccessKey = (node: DirectoryLineNode): string =>
  getDirectoryMetadata(node, "key");

export const setPathAccessKey = (node: DirectoryLineNode, key: string): DirectoryLineNode => {
  const updated = updateDirectoryMetadata(node, "key", key);
  return key === "" && updated.comment === null
    ? parsePathLineAst(updated.raw.trimEnd()).ast
    : updated;
};

export const getPathDialog = (node: DirectoryLineNode): boolean =>
  getDirectoryMetadata(node, "dialog").toLowerCase() === "true";

export const setPathDialog = (node: DirectoryLineNode, dialog: boolean): DirectoryLineNode => {
  const updated = updateDirectoryMetadata(node, "dialog", dialog ? "true" : "");
  return !dialog && updated.comment === null
    ? parsePathLineAst(updated.raw.trimEnd()).ast
    : updated;
};

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

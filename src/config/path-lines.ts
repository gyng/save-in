export type PathRow = { depth: number; body: string; comment: string };

export const parsePathLine = (line: string): PathRow => {
  const commentIdx = line.indexOf("//");
  const rawBody = commentIdx === -1 ? line : line.slice(0, commentIdx);
  const comment = commentIdx === -1 ? "" : line.slice(commentIdx + 2).trim();
  const depthMatch = rawBody.trim().match(/^(>*)\s*(.*)$/);
  return {
    depth: depthMatch?.[1]?.length ?? 0,
    body: depthMatch?.[2]?.trim() ?? "",
    comment,
  };
};

export const serializePathLine = (row: PathRow): string =>
  `${">".repeat(row.depth)}${row.body}${row.comment ? ` // ${row.comment}` : ""}`;

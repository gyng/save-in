export const DIRECTORY_LINE_GRAMMAR = String.raw`
directory-line = nesting, path, [ comment ] ;
nesting        = { ">" }, { whitespace } ;
path           = character, { character } ;
comment        = "//", { character } ;

metadata       = "(", metadata-key, ":", metadata-value, ")" ;
metadata-key   = metadata-character, { metadata-character } ;
metadata-value = { character | "(", metadata-value, ")" } ;
`;

export type PathRow = { depth: number; body: string; comment: string };
export type PathMetadataEntry = {
  key: string;
  value: string;
  start: number;
  end: number;
};
export type PathSyntaxIssue = {
  code: "missing-path";
  column: number;
  source: string;
};
export type ParsedPathLine = {
  row: PathRow;
  issues: PathSyntaxIssue[];
};

export const parsePathLineSyntax = (line: string): ParsedPathLine => {
  const commentIdx = line.indexOf("//");
  const rawBody = commentIdx === -1 ? line : line.slice(0, commentIdx);
  const comment = commentIdx === -1 ? "" : line.slice(commentIdx + 2).trim();
  const depthMatch = rawBody.trim().match(/^(>*)\s*(.*)$/);
  const row = {
    depth: depthMatch?.[1]?.length ?? 0,
    body: depthMatch?.[2]?.trim() ?? "",
    comment,
  };
  return {
    row,
    issues: row.body ? [] : [{ code: "missing-path", column: rawBody.length, source: line }],
  };
};

export const parsePathLine = (line: string): PathRow => parsePathLineSyntax(line).row;

export const validatePathLineSyntax = (line: string): PathSyntaxIssue[] =>
  parsePathLineSyntax(line).issues;

export const serializePathLine = (row: PathRow): string =>
  `${">".repeat(row.depth)}${row.body}${row.comment ? ` // ${row.comment}` : ""}`;

export const parsePathMetadataEntries = (comment: string): PathMetadataEntry[] => {
  const entries: PathMetadataEntry[] = [];
  let cursor = 0;

  while (cursor < comment.length) {
    const start = comment.indexOf("(", cursor);
    if (start === -1) break;

    let separator = -1;
    for (let index = start + 1; index < comment.length; index += 1) {
      const char = comment[index];
      if (char === ":") {
        separator = index;
        break;
      }
      if (char === "(" || char === ")") break;
    }

    const key = separator === -1 ? "" : comment.slice(start + 1, separator).trim();
    if (!key) {
      cursor = start + 1;
      continue;
    }

    let depth = 1;
    let closing = -1;
    for (let index = separator + 1; index < comment.length; index += 1) {
      if (comment[index] === "(") depth += 1;
      if (comment[index] === ")") {
        depth -= 1;
        if (depth === 0) {
          closing = index;
          break;
        }
      }
    }
    if (closing === -1) {
      cursor = start + 1;
      continue;
    }

    entries.push({
      key,
      value: comment.slice(separator + 1, closing).trim(),
      start,
      end: closing + 1,
    });
    cursor = closing + 1;
  }

  return entries;
};

export const parsePathMetadata = (comment: string): Record<string, string> =>
  Object.fromEntries(parsePathMetadataEntries(comment).map(({ key, value }) => [key, value]));

export const setPathMetadata = (comment: string, key: string, value: string): string => {
  const matching = parsePathMetadataEntries(comment).filter((entry) => entry.key === key);
  let cleaned = comment;
  for (const entry of matching.toReversed()) {
    const before = cleaned.slice(0, entry.start).trimEnd();
    const after = cleaned.slice(entry.end).trimStart();
    cleaned = before && after ? `${before} ${after}` : before || after;
  }
  cleaned = cleaned.trim();
  if (!value) return cleaned;
  const metadata = `(${key}: ${value})`;
  return cleaned ? `${cleaned} ${metadata}` : metadata;
};

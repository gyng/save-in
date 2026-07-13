import {
  defineGrammar,
  located,
  map,
  parseSyntax,
  rest,
  sequence,
  sourceSpan,
  token,
  type SourceSpan,
} from "../shared/syntax-parser.ts";

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

export type DirectoryMetadataNode = {
  kind: "metadata";
  key: string;
  value: string;
  span: SourceSpan;
};

export type DirectoryLineNode = {
  kind: "directory-line";
  raw: string;
  depth: number;
  path: { kind: "path"; value: string; span: SourceSpan };
  comment: {
    kind: "comment";
    value: string;
    span: SourceSpan;
    contentSpan: SourceSpan;
  } | null;
  metadata: DirectoryMetadataNode[];
  span: SourceSpan;
};

export type ParsedDirectoryAst = {
  ast: DirectoryLineNode;
  issues: PathSyntaxIssue[];
};

const directoryLineParser = defineGrammar(
  map(
    sequence(
      located(token(/>*/, "directory nesting")),
      token(/\s*/, "whitespace"),
      located(rest()),
    ),
    ([nesting, , path]) => ({ nesting, path }),
  ),
);

const trimmedBounds = (value: string): { start: number; end: number } => {
  const start = value.length - value.trimStart().length;
  const end = value.trimEnd().length;
  return { start, end: Math.max(start, end) };
};

const commentNode = (line: string, commentIndex: number): DirectoryLineNode["comment"] => {
  if (commentIndex < 0) return null;
  const rawComment = line.slice(commentIndex + 2);
  const bounds = trimmedBounds(rawComment);
  const start = commentIndex + 2 + bounds.start;
  const end = commentIndex + 2 + bounds.end;
  return {
    kind: "comment",
    value: line.slice(start, end),
    span: sourceSpan(line, commentIndex, line.length),
    contentSpan: sourceSpan(line, start, end),
  };
};

export const parsePathLineAst = (line: string): ParsedDirectoryAst => {
  const commentIndex = line.indexOf("//");
  const rawBody = commentIndex === -1 ? line : line.slice(0, commentIndex);
  const bounds = trimmedBounds(rawBody);
  const parsed = parseSyntax(directoryLineParser, line, {
    offset: bounds.start,
    limit: bounds.end,
  });
  if (!parsed.ok) throw new Error("Directory grammar must accept every bounded line");
  const comment = commentNode(line, commentIndex);
  const metadata = comment
    ? parsePathMetadataEntries(comment.value).map((entry) => ({
        kind: "metadata" as const,
        key: entry.key,
        value: entry.value,
        span: sourceSpan(
          line,
          comment.contentSpan.start.offset + entry.start,
          comment.contentSpan.start.offset + entry.end,
        ),
      }))
    : [];
  const ast: DirectoryLineNode = {
    kind: "directory-line",
    raw: line,
    depth: parsed.value.nesting.value.length,
    path: {
      kind: "path",
      value: parsed.value.path.value,
      span: parsed.value.path.span,
    },
    comment,
    metadata,
    span: sourceSpan(line, 0, line.length),
  };
  return {
    ast,
    issues: ast.path.value ? [] : [{ code: "missing-path", column: rawBody.length, source: line }],
  };
};

export const parsePathLineSyntax = (line: string): ParsedPathLine => {
  const { ast, issues } = parsePathLineAst(line);
  const row = {
    depth: ast.depth,
    body: ast.path.value,
    comment: ast.comment?.value ?? "",
  };
  return { row, issues };
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

import {
  choice,
  defineGrammar,
  end as endOfInput,
  lazy,
  literal,
  located,
  map,
  parseSyntax,
  repeat,
  sequence,
  sourceSpan,
  token,
  type SyntaxParser,
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
      located(token(/[^\n\r\u2028\u2029]*/, "path")),
      endOfInput(),
    ),
    ([nesting, , path]) => ({ nesting, path }),
  ),
);

const metadataValueParser: SyntaxParser<string> = lazy(() =>
  map(
    repeat(
      choice(
        token(/[^()]+/, "metadata text"),
        map(
          sequence(literal("("), metadataValueParser, literal(")")),
          ([open, value, close]) => `${open}${value}${close}`,
        ),
      ),
    ),
    (parts) => parts.join(""),
  ),
);

const metadataParser = defineGrammar(
  map(
    sequence(
      literal("("),
      located(token(/[^:()]*/, "metadata key")),
      literal(":"),
      located(metadataValueParser),
      literal(")"),
    ),
    ([, key, , value], span) => ({ key, value, span }),
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
    depth: parsed.ok ? parsed.value.nesting.value.length : 0,
    path: {
      kind: "path",
      value: parsed.ok ? parsed.value.path.value : "",
      span: parsed.ok ? parsed.value.path.span : sourceSpan(line, bounds.start, bounds.start),
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

const pathRowFromAst = (ast: DirectoryLineNode): PathRow => ({
  depth: ast.depth,
  body: ast.path.value,
  comment: ast.comment?.value ?? "",
});

export const parsePathLine = (line: string): PathRow => pathRowFromAst(parsePathLineAst(line).ast);

export const validatePathLineSyntax = (line: string): PathSyntaxIssue[] =>
  parsePathLineAst(line).issues;

export const serializePathLine = (row: PathRow): string =>
  `${">".repeat(row.depth)}${row.body}${row.comment ? ` // ${row.comment}` : ""}`;

export const parsePathMetadataEntries = (comment: string): PathMetadataEntry[] => {
  const entries: PathMetadataEntry[] = [];
  let cursor = 0;

  while (cursor < comment.length) {
    const start = comment.indexOf("(", cursor);
    if (start === -1) break;
    const parsed = parseSyntax(metadataParser, comment, { offset: start });
    const key = parsed.ok ? parsed.value.key.value.trim() : "";
    if (!parsed.ok || !key) {
      cursor = start + 1;
      continue;
    }
    entries.push({
      key,
      value: parsed.value.value.value.trim(),
      start: parsed.span.start.offset,
      end: parsed.span.end.offset,
    });
    cursor = parsed.span.end.offset;
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

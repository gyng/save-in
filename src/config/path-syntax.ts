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

type ParsedMetadataEntry = {
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
  readonly kind: "metadata";
  readonly key: string;
  readonly value: string;
  readonly span: SourceSpan;
};

export type DirectoryLineNode = {
  readonly kind: "directory-line";
  readonly raw: string;
  readonly depth: number;
  readonly path: { readonly kind: "path"; readonly value: string; readonly span: SourceSpan };
  readonly comment: {
    readonly kind: "comment";
    readonly value: string;
    readonly span: SourceSpan;
    readonly contentSpan: SourceSpan;
  } | null;
  readonly metadata: readonly DirectoryMetadataNode[];
  readonly span: SourceSpan;
};

export type ParsedDirectoryAst = {
  readonly ast: DirectoryLineNode;
  readonly issues: readonly PathSyntaxIssue[];
};

export type DirectoryLineUpdate = {
  readonly depth?: number;
  readonly path?: string;
  readonly comment?: string;
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
    ? parseMetadataEntries(comment.value).map((entry) => ({
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

export const validatePathLineSyntax = (line: string): readonly PathSyntaxIssue[] =>
  parsePathLineAst(line).issues;

export const serializeDirectoryLine = (node: DirectoryLineNode): string => {
  const comment = node.comment?.value ?? "";
  return `${">".repeat(node.depth)}${node.path.value}${comment ? ` // ${comment}` : ""}`;
};

export const updateDirectoryLine = (
  node: DirectoryLineNode,
  update: DirectoryLineUpdate,
): DirectoryLineNode => {
  const depth = update.depth ?? node.depth;
  const path = update.path ?? node.path.value;
  const comment = update.comment ?? node.comment?.value ?? "";
  return parsePathLineAst(`${">".repeat(depth)}${path}${comment ? ` // ${comment}` : ""}`).ast;
};

const parseMetadataEntries = (comment: string): ParsedMetadataEntry[] => {
  const entries: ParsedMetadataEntry[] = [];
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

export const getDirectoryMetadata = (node: DirectoryLineNode, key: string): string =>
  node.metadata.findLast((entry) => entry.key === key)?.value ?? "";

export const updateDirectoryMetadata = (
  node: DirectoryLineNode,
  key: string,
  value: string,
): DirectoryLineNode => {
  const commentAst = node.comment;
  let comment = commentAst?.value ?? "";
  const contentStart = commentAst?.contentSpan.start.offset ?? 0;
  const matching = node.metadata.filter((entry) => entry.key === key).toReversed();
  for (const entry of matching) {
    const start = entry.span.start.offset - contentStart;
    const end = entry.span.end.offset - contentStart;
    const before = comment.slice(0, start).trimEnd();
    const after = comment.slice(end).trimStart();
    comment = before && after ? `${before} ${after}` : before || after;
  }
  comment = comment.trim();
  if (value) {
    const metadata = `(${key}: ${value})`;
    comment = comment ? `${comment} ${metadata}` : metadata;
  }
  return updateDirectoryLine(node, { comment });
};

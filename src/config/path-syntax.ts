import {
  applySourceEdits,
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
  sourceFragment,
  sourceSpan,
  token,
  type SourceEdit,
  type SyntaxParser,
  type SourceFragment,
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

export type DirectoryCommentCst = {
  readonly kind: "comment-cst";
  readonly delimiter: SourceFragment<"comment-delimiter">;
  readonly leadingTrivia: SourceFragment<"comment-leading-trivia">;
  readonly content: SourceFragment<"comment-content">;
  readonly trailingTrivia: SourceFragment<"comment-trailing-trivia">;
};

export type DirectoryLineCst = {
  readonly kind: "directory-line-cst";
  readonly valid: boolean;
  readonly body: SourceFragment<"directory-body">;
  readonly leadingTrivia: SourceFragment<"line-leading-trivia">;
  readonly nesting: SourceFragment<"nesting-token">;
  readonly pathLeadingTrivia: SourceFragment<"path-leading-trivia">;
  readonly pathTrailingTrivia: SourceFragment<"path-trailing-trivia">;
  readonly comment: DirectoryCommentCst | null;
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
  readonly cst: DirectoryLineCst;
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
      located(token(/\s*/, "whitespace")),
      located(token(/[^\n\r\u2028\u2029]*/, "path")),
      endOfInput(),
    ),
    ([nesting, whitespace, path]) => ({ nesting, whitespace, path }),
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

const commentCst = (
  line: string,
  commentIndex: number,
  comment: NonNullable<DirectoryLineNode["comment"]>,
): DirectoryCommentCst => ({
  kind: "comment-cst",
  delimiter: sourceFragment(line, "comment-delimiter", commentIndex, commentIndex + 2),
  leadingTrivia: sourceFragment(
    line,
    "comment-leading-trivia",
    commentIndex + 2,
    comment.contentSpan.start.offset,
  ),
  content: sourceFragment(
    line,
    "comment-content",
    comment.contentSpan.start.offset,
    comment.contentSpan.end.offset,
  ),
  trailingTrivia: sourceFragment(
    line,
    "comment-trailing-trivia",
    comment.contentSpan.end.offset,
    line.length,
  ),
});

export const parsePathLineAst = (line: string): ParsedDirectoryAst => {
  const commentIndex = line.indexOf("//");
  const rawBody = commentIndex === -1 ? line : line.slice(0, commentIndex);
  const bounds = trimmedBounds(rawBody);
  const parsed = parseSyntax(directoryLineParser, line, {
    offset: bounds.start,
    limit: bounds.end,
  });
  const comment = commentNode(line, commentIndex);
  const bodyEnd = commentIndex < 0 ? line.length : commentIndex;
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
    cst: {
      kind: "directory-line-cst",
      valid: parsed.ok,
      body: sourceFragment(line, "directory-body", 0, bodyEnd),
      leadingTrivia: sourceFragment(
        line,
        "line-leading-trivia",
        0,
        parsed.ok ? parsed.value.nesting.span.start.offset : bounds.start,
      ),
      nesting: sourceFragment(
        line,
        "nesting-token",
        parsed.ok ? parsed.value.nesting.span.start.offset : bounds.start,
        parsed.ok ? parsed.value.nesting.span.end.offset : bounds.start,
      ),
      pathLeadingTrivia: sourceFragment(
        line,
        "path-leading-trivia",
        parsed.ok ? parsed.value.whitespace.span.start.offset : bounds.start,
        parsed.ok ? parsed.value.whitespace.span.end.offset : bounds.start,
      ),
      pathTrailingTrivia: sourceFragment(
        line,
        "path-trailing-trivia",
        parsed.ok ? parsed.value.path.span.end.offset : bounds.start,
        bodyEnd,
      ),
      comment: comment && commentIndex >= 0 ? commentCst(line, commentIndex, comment) : null,
    },
    span: sourceSpan(line, 0, line.length),
  };
  return {
    ast,
    issues: ast.path.value ? [] : [{ code: "missing-path", column: rawBody.length, source: line }],
  };
};

export const validatePathLineSyntax = (line: string): readonly PathSyntaxIssue[] =>
  parsePathLineAst(line).issues;

export const serializeDirectoryLine = (node: DirectoryLineNode): string => node.raw;

const canonicalDirectoryLine = (node: DirectoryLineNode, update: DirectoryLineUpdate): string => {
  const depth = update.depth ?? node.depth;
  const path = update.path ?? node.path.value;
  const comment = update.comment ?? node.comment?.value ?? "";
  return `${">".repeat(depth)}${path}${comment ? ` // ${comment}` : ""}`;
};

export const updateDirectoryLine = (
  node: DirectoryLineNode,
  update: DirectoryLineUpdate,
): DirectoryLineNode => {
  if (!node.cst.valid) return parsePathLineAst(canonicalDirectoryLine(node, update)).ast;
  const edits: SourceEdit[] = [];
  if (update.depth !== undefined && update.depth !== node.depth) {
    edits.push({ span: node.cst.nesting.span, text: ">".repeat(update.depth) });
  }
  if (update.path !== undefined && update.path !== node.path.value) {
    edits.push({ span: node.path.span, text: update.path });
  }
  if (update.comment !== undefined && update.comment !== (node.comment?.value ?? "")) {
    if (node.cst.comment) {
      edits.push(
        update.comment
          ? { span: node.cst.comment.content.span, text: update.comment }
          : {
              span: sourceSpan(
                node.raw,
                node.cst.comment.delimiter.span.start.offset,
                node.raw.length,
              ),
              text: "",
            },
      );
    } else if (update.comment) {
      const separator = node.cst.pathTrailingTrivia.raw ? "" : " ";
      edits.push({
        span: sourceSpan(node.raw, node.raw.length, node.raw.length),
        text: `${separator}// ${update.comment}`,
      });
    }
  }
  return parsePathLineAst(applySourceEdits(node.raw, edits)).ast;
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

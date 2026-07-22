import { parsePathLineAst } from "../../config/path-syntax.ts";
import { FETCH_URL_BANNED_VARIABLES } from "../../routing/path-variables.ts";
import { RENAME_SEPARATOR } from "../../routing/rename.ts";
import { parseRoutingRuleAst, type RoutingLineNode } from "../../routing/rule-syntax.ts";
import { parseMatchPatternList } from "../../shared/match-pattern.ts";
import { parseRegularExpressionList, type PatternListIssue } from "../../shared/pattern-list.ts";
import { parseWebhookEndpoints, webhookEndpointReason } from "../../shared/webhook.ts";

export type SyntaxEditorLanguage =
  | "directories"
  | "routing"
  | "match-patterns"
  | "regular-expressions"
  | "webhook-endpoints";

// A dialect whose grammar depends on a setting reads it from here. The other
// four do not need one, so this stays optional and defaults to the safe answer:
// an analysis with no options rejects plaintext endpoints.
export type SyntaxAnalysisOptions = { readonly webhookAllowInsecure?: boolean | undefined };

export type SyntaxTokenKind =
  | "nesting"
  | "path"
  | "separator"
  | "variable"
  | "comment-delimiter"
  | "comment"
  | "metadata"
  | "matcher"
  | "capture"
  | "destination"
  | "action"
  | "flags"
  | "punctuation"
  | "regex"
  | "capture-value"
  | "destination-value"
  | "action-value"
  | "invalid";

export type SyntaxToken = {
  readonly kind: SyntaxTokenKind;
  readonly start: number;
  readonly end: number;
};

export type SyntaxLine = {
  readonly number: number;
  readonly start: number;
  readonly end: number;
};

export type SyntaxEditorDiagnostic = {
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
  readonly message: string;
  readonly severity: "error" | "warning";
};

export type SyntaxSnapshot = {
  readonly source: string;
  readonly lines: readonly SyntaxLine[];
  readonly tokens: readonly SyntaxToken[];
  readonly diagnostics: readonly SyntaxEditorDiagnostic[];
};

export type SyntaxCompletion = {
  readonly start: number;
  readonly end: number;
  readonly suggestions: readonly string[];
  readonly suffix: string;
};

export type EditorValidationError = {
  readonly message: string;
  readonly error: string;
  readonly warning?: boolean;
  readonly sourceIndex?: number;
  readonly sourceRange?: { readonly start: number; readonly end: number };
  readonly location?: {
    readonly start: number;
    readonly end: number;
    readonly line: number;
    readonly column: number;
  };
};

type CompletionVocabulary = {
  readonly matchers: readonly string[];
  readonly variables: readonly string[];
};

const sourceLines = (source: string): SyntaxLine[] => {
  let start = 0;
  return source.split("\n").map((line, index) => {
    const result = { number: index + 1, start, end: start + line.length };
    start = result.end + 1;
    return result;
  });
};

const token = (kind: SyntaxTokenKind, start: number, end: number): SyntaxToken => ({
  kind,
  start,
  end,
});

const addVariableTokens = (
  source: string,
  start: number,
  end: number,
  tokens: SyntaxToken[],
): void => {
  for (const match of source.slice(start, end).matchAll(/:[a-zA-Z0-9$]+:/g)) {
    const offset = start + match.index;
    tokens.push(token("variable", offset, offset + match[0].length));
  }
};

const visibleDiagnosticRange = (
  start: number,
  end: number,
  line: SyntaxLine,
): { start: number; end: number } => {
  if (end > start) return { start, end };
  const bounded = Math.min(Math.max(start, line.start), line.end - 1);
  return { start: bounded, end: bounded + 1 };
};

const directorySnapshot = (source: string, lines: readonly SyntaxLine[]): SyntaxSnapshot => {
  const tokens: SyntaxToken[] = [];
  const diagnostics: SyntaxEditorDiagnostic[] = [];
  for (const line of lines) {
    const raw = source.slice(line.start, line.end);
    if (!raw.trim()) continue;
    const parsed = parsePathLineAst(raw);
    const { ast } = parsed;
    const absolute = (offset: number) => line.start + offset;
    if (ast.cst.nesting.raw) {
      tokens.push(
        token(
          "nesting",
          absolute(ast.cst.nesting.span.start.offset),
          absolute(ast.cst.nesting.span.end.offset),
        ),
      );
    }
    if (ast.path.value) {
      const pathKind = ast.path.value === "---" ? "separator" : "path";
      tokens.push(
        token(pathKind, absolute(ast.path.span.start.offset), absolute(ast.path.span.end.offset)),
      );
      addVariableTokens(
        source,
        absolute(ast.path.span.start.offset),
        absolute(ast.path.span.end.offset),
        tokens,
      );
    }
    if (ast.cst.comment) {
      tokens.push(
        token(
          "comment-delimiter",
          absolute(ast.cst.comment.delimiter.span.start.offset),
          absolute(ast.cst.comment.delimiter.span.end.offset),
        ),
        token(
          "comment",
          absolute(ast.cst.comment.leadingTrivia.span.start.offset),
          absolute(ast.cst.comment.trailingTrivia.span.end.offset),
        ),
      );
      ast.metadata.forEach((metadata) => {
        tokens.push(
          token(
            "metadata",
            absolute(metadata.span.start.offset),
            absolute(metadata.span.end.offset),
          ),
        );
      });
    }
    parsed.issues.forEach(() => {
      const range = visibleDiagnosticRange(
        absolute(ast.path.span.start.offset),
        absolute(ast.path.span.end.offset),
        line,
      );
      diagnostics.push({
        ...range,
        line: line.number,
        column: ast.path.span.start.column,
        message: "html_required",
        severity: "error",
      });
    });
  }
  return { source, lines, tokens, diagnostics };
};

const addRoutingClauseTokens = (
  source: string,
  line: Extract<RoutingLineNode, { kind: "clause" }>,
  tokens: SyntaxToken[],
): void => {
  // fetch: is a URL template with the same variable-expansion behaviour as
  // into:, so it reuses the destination highlighting rather than a bespoke
  // token. rename: produces output too, so its name shares that kind.
  const nameKind =
    line.clauseKind === "destination" || line.clauseKind === "fetch" || line.clauseKind === "rename"
      ? "destination"
      : line.clauseKind === "action"
        ? "action"
        : line.clauseKind === "capture"
          ? "capture"
          : "matcher";
  tokens.push(token(nameKind, line.nameSpan.start.offset, line.nameSpan.end.offset));
  if (line.cst.flagsSeparator) {
    tokens.push(
      token(
        "punctuation",
        line.cst.flagsSeparator.span.start.offset,
        line.cst.flagsSeparator.span.end.offset,
      ),
    );
  }
  if (line.flagsSpan)
    tokens.push(token("flags", line.flagsSpan.start.offset, line.flagsSpan.end.offset));
  tokens.push(
    token("punctuation", line.cst.colon.span.start.offset, line.cst.colon.span.end.offset),
  );

  if (line.clauseKind === "rename") {
    // The value is two-sided: a regex before the first " -> " separator and a
    // literal replacement (with variable expansion) after it.
    const valueStart = line.valueSpan.start.offset;
    const separator = line.value.indexOf(RENAME_SEPARATOR);
    if (separator < 0) {
      tokens.push(token("regex", valueStart, line.valueSpan.end.offset));
      return;
    }
    const separatorStart = valueStart + separator;
    const replacementStart = separatorStart + RENAME_SEPARATOR.length;
    tokens.push(
      token("regex", valueStart, separatorStart),
      token("punctuation", separatorStart, replacementStart),
      token("destination-value", replacementStart, line.valueSpan.end.offset),
    );
    addVariableTokens(source, replacementStart, line.valueSpan.end.offset, tokens);
    return;
  }

  const valueKind =
    line.clauseKind === "destination" || line.clauseKind === "fetch"
      ? "destination-value"
      : line.clauseKind === "action"
        ? "action-value"
        : line.clauseKind === "capture"
          ? "capture-value"
          : "regex";
  tokens.push(token(valueKind, line.valueSpan.start.offset, line.valueSpan.end.offset));
  if (line.clauseKind === "destination" || line.clauseKind === "fetch") {
    addVariableTokens(source, line.valueSpan.start.offset, line.valueSpan.end.offset, tokens);
  }
};

const routingSnapshot = (source: string, lines: readonly SyntaxLine[]): SyntaxSnapshot => {
  const parsed = parseRoutingRuleAst(source);
  const tokens: SyntaxToken[] = [];
  for (const line of parsed.ast.lines) {
    if (line.kind === "clause") {
      addRoutingClauseTokens(source, line, tokens);
    } else if (line.kind === "comment") {
      const delimiter = line.cst.delimiter as NonNullable<typeof line.cst.delimiter>;
      const content = line.cst.content as NonNullable<typeof line.cst.content>;
      tokens.push(
        token("comment-delimiter", delimiter.span.start.offset, delimiter.span.end.offset),
      );
      tokens.push(token("comment", content.span.start.offset, content.span.end.offset));
    } else if (line.kind === "invalid") {
      tokens.push(
        token("invalid", line.cst.content.span.start.offset, line.cst.content.span.end.offset),
      );
    }
  }
  const diagnostics = parsed.issues.map((issue) => {
    const line = lines[issue.line - 1] as SyntaxLine;
    const range = visibleDiagnosticRange(issue.span.start.offset, issue.span.end.offset, line);
    return {
      ...range,
      line: issue.line,
      column: issue.column,
      message: "ruleBadClause",
      severity: "error" as const,
    };
  });
  return { source, lines, tokens, diagnostics };
};

const patternDiagnostics = (
  issues: readonly PatternListIssue[],
  message: string,
): SyntaxEditorDiagnostic[] =>
  issues.map((issue) => ({
    start: issue.start,
    end: issue.end,
    line: issue.line,
    column: issue.column,
    message,
    severity: "error",
  }));

const matchPatternSnapshot = (source: string, lines: readonly SyntaxLine[]): SyntaxSnapshot => {
  const parsed = parseMatchPatternList(source);
  const tokens: SyntaxToken[] = [];
  parsed.entries.forEach((entry) => {
    const { scheme, host, path } = entry.value;
    const separatorStart = entry.start + scheme.length;
    const hostStart = separatorStart + 3;
    const pathStart = hostStart + host.length;
    tokens.push(
      token("matcher", entry.start, separatorStart),
      token("punctuation", separatorStart, hostStart),
    );
    if (host) tokens.push(token("destination-value", hostStart, pathStart));
    tokens.push(token("regex", pathStart, pathStart + path.length));
  });
  parsed.issues.forEach((issue) => tokens.push(token("invalid", issue.start, issue.end)));
  return {
    source,
    lines,
    tokens,
    diagnostics: patternDiagnostics(parsed.issues, "matchPatternInvalid"),
  };
};

const regularExpressionSnapshot = (
  source: string,
  lines: readonly SyntaxLine[],
): SyntaxSnapshot => {
  const parsed = parseRegularExpressionList(source);
  const tokens = parsed.entries.map((entry) => token("regex", entry.start, entry.end));
  parsed.issues.forEach((issue) => tokens.push(token("invalid", issue.start, issue.end)));
  return {
    source,
    lines,
    tokens,
    diagnostics: patternDiagnostics(parsed.issues, "regularExpressionInvalid"),
  };
};

const webhookEndpointSnapshot = (
  source: string,
  lines: readonly SyntaxLine[],
  options: SyntaxAnalysisOptions,
): SyntaxSnapshot => {
  const parsed = parseWebhookEndpoints(source, {
    allowInsecure: options.webhookAllowInsecure === true,
  });
  const tokens: SyntaxToken[] = [];
  parsed.entries.forEach((entry) => {
    // An accepted endpoint always writes its authority out, so the separator is
    // there to split on -- validateWebhookUrl rejects "https:/host" rather than
    // letting new URL() repair it.
    const separator = entry.source.indexOf("://");
    const separatorStart = entry.start + separator;
    const hostStart = separatorStart + 3;
    const slash = entry.source.indexOf("/", separator + 3);
    const pathStart = slash === -1 ? entry.end : entry.start + slash;
    tokens.push(
      token("matcher", entry.start, separatorStart),
      token("punctuation", separatorStart, hostStart),
      token("destination-value", hostStart, pathStart),
    );
    if (pathStart < entry.end) tokens.push(token("path", pathStart, entry.end));
  });
  parsed.issues.forEach((issue) => tokens.push(token("invalid", issue.start, issue.end)));
  return {
    source,
    lines,
    tokens,
    // Unlike the other list dialects, each line names why it was rejected: the
    // reason is the message key.
    diagnostics: parsed.issues.map((issue) => ({
      start: issue.start,
      end: issue.end,
      line: issue.line,
      column: issue.column,
      message: webhookEndpointReason(issue.error),
      severity: "error" as const,
    })),
  };
};

export const analyzeSyntax = (
  language: SyntaxEditorLanguage,
  source: string,
  options: SyntaxAnalysisOptions = {},
): SyntaxSnapshot => {
  const lines = sourceLines(source);
  switch (language) {
    case "directories":
      return directorySnapshot(source, lines);
    case "routing":
      return routingSnapshot(source, lines);
    case "match-patterns":
      return matchPatternSnapshot(source, lines);
    case "regular-expressions":
      return regularExpressionSnapshot(source, lines);
    case "webhook-endpoints":
      return webhookEndpointSnapshot(source, lines, options);
  }
};

const directorySourceRange = (
  source: string,
  sourceIndex: number,
): { start: number; end: number } | null => {
  let offset = 0;
  let current = 0;
  for (const line of source.split("\n")) {
    const leading = line.length - line.trimStart().length;
    const trimmed = line.trim();
    if (trimmed) {
      if (current === sourceIndex) {
        return { start: offset + leading, end: offset + leading + trimmed.length };
      }
      current += 1;
    }
    offset += line.length + 1;
  }
  return null;
};

export const directoryValidationLocation = (
  source: string,
  sourceIndex: number,
  sourceRange?: { readonly start: number; readonly end: number },
): { start: number; end: number; line: number; column: number } | null => {
  const lineRange = directorySourceRange(source, sourceIndex);
  if (!lineRange) return null;
  const start = lineRange.start + (sourceRange?.start ?? 0);
  const end = sourceRange ? lineRange.start + sourceRange.end : lineRange.end;
  const lineStart = source.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  return {
    start,
    end,
    line: source.slice(0, start).split("\n").length,
    column: start - lineStart,
  };
};

export const validationErrorsToDiagnostics = (
  language: SyntaxEditorLanguage,
  source: string,
  errors: readonly EditorValidationError[],
): SyntaxEditorDiagnostic[] =>
  errors.flatMap((error): SyntaxEditorDiagnostic[] => {
    const range =
      language === "directories"
        ? error.sourceIndex === undefined
          ? null
          : directoryValidationLocation(source, error.sourceIndex, error.sourceRange)
        : error.location
          ? { start: error.location.start, end: error.location.end }
          : null;
    if (!range) return [];
    const line = "line" in range ? range.line : source.slice(0, range.start).split("\n").length;
    const column =
      "column" in range
        ? range.column
        : range.start - (source.lastIndexOf("\n", Math.max(0, range.start - 1)) + 1);
    return [
      {
        start: range.start,
        end: range.end,
        line,
        column,
        message: error.error ? `${error.message}: ${error.error}` : error.message,
        severity: error.warning ? "warning" : "error",
      },
    ];
  });

const lineAt = (source: string, caret: number): { start: number; end: number } => {
  const bounded = Math.max(0, Math.min(caret, source.length));
  const start = source.lastIndexOf("\n", Math.max(0, bounded - 1)) + 1;
  const nextBreak = source.indexOf("\n", bounded);
  return { start, end: nextBreak < 0 ? source.length : nextBreak };
};

const variableCompletion = (
  source: string,
  caret: number,
  lowerBound: number,
  variables: readonly string[],
): SyntaxCompletion | null => {
  const before = source.slice(lowerBound, caret);
  const match = before.match(/(?<![a-zA-Z0-9]):[a-zA-Z0-9$]*$/);
  if (!match) return null;
  const prefix = match[0].toLocaleLowerCase();
  const suggestions = variables.filter((name) => name.toLocaleLowerCase().startsWith(prefix));
  return suggestions.length
    ? { start: caret - match[0].length, end: caret, suggestions, suffix: "" }
    : null;
};

export const completeDirectorySyntax = (
  source: string,
  caret: number,
  variables: readonly string[],
): SyntaxCompletion | null => {
  const currentLine = lineAt(source, caret);
  const parsed = parsePathLineAst(source.slice(currentLine.start, currentLine.end)).ast;
  const localCaret = caret - currentLine.start;
  if (parsed.comment && localCaret >= parsed.comment.span.start.offset) return null;
  if (localCaret < parsed.path.span.start.offset) return null;
  return variableCompletion(
    source,
    caret,
    currentLine.start + parsed.path.span.start.offset,
    variables,
  );
};

const matcherCompletion = (
  source: string,
  caret: number,
  lineStart: number,
  matchers: readonly string[],
  explicit: boolean,
): SyntaxCompletion | null => {
  const rawPrefix = source.slice(lineStart, caret);
  const leading = rawPrefix.length - rawPrefix.trimStart().length;
  const prefix = rawPrefix.slice(leading);
  if (!/^[a-z]*$/i.test(prefix) || (!prefix && !explicit)) return null;
  const normalized = prefix.toLocaleLowerCase();
  const suggestions = matchers.filter((name) => name.toLocaleLowerCase().startsWith(normalized));
  return suggestions.length
    ? { start: lineStart + leading, end: caret, suggestions, suffix: ": " }
    : null;
};

const captureMatcherCompletion = (
  source: string,
  caret: number,
  valueStart: number,
  matchers: readonly string[],
  explicit: boolean,
): SyntaxCompletion | null => {
  const before = source.slice(valueStart, caret);
  const prefix = before.match(/(?:^|,\s*)([a-z]*)$/i)?.[1];
  if (prefix === undefined || (!prefix && !explicit)) return null;
  const suggestions = matchers.filter((name) =>
    name.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase()),
  );
  return suggestions.length
    ? { start: caret - prefix.length, end: caret, suggestions, suffix: "" }
    : null;
};

export const completeRoutingSyntax = (
  source: string,
  caret: number,
  vocabulary: CompletionVocabulary,
  explicit = false,
): SyntaxCompletion | null => {
  const currentLine = lineAt(source, caret);
  const parsed = parseRoutingRuleAst(source).ast;
  const node = parsed.lines.find(
    (line) =>
      line.cst.line.span.start.offset === currentLine.start &&
      line.cst.line.span.end.offset === currentLine.end,
  );
  if (!node || node.kind === "comment") return null;
  if (node.kind !== "clause" || caret <= node.cst.colon.span.start.offset) {
    return matcherCompletion(source, caret, currentLine.start, vocabulary.matchers, explicit);
  }
  if (node.name === "into") {
    return variableCompletion(source, caret, node.valueSpan.start.offset, vocabulary.variables);
  }
  if (node.name === "fetch") {
    // A fetch: template rewrites the download URL, so variables that would
    // fetch the original resource to compute their value are unavailable here.
    return variableCompletion(
      source,
      caret,
      node.valueSpan.start.offset,
      vocabulary.variables.filter((name) => !FETCH_URL_BANNED_VARIABLES.has(name)),
    );
  }
  if (node.name === "rename") {
    // Only the replacement side (after " -> ") expands variables; before the
    // separator the value is a regex where ":name:" is ordinary pattern text.
    const separator = node.value.indexOf(RENAME_SEPARATOR);
    if (separator < 0) return null;
    const replacementStart = node.valueSpan.start.offset + separator + RENAME_SEPARATOR.length;
    if (caret < replacementStart) return null;
    return variableCompletion(source, caret, replacementStart, vocabulary.variables);
  }
  if (node.name === "capture" || node.name === "capturegroups") {
    return captureMatcherCompletion(
      source,
      caret,
      node.valueSpan.start.offset,
      vocabulary.matchers.filter((name) => name !== "into" && !name.startsWith("capture")),
      explicit,
    );
  }
  return null;
};

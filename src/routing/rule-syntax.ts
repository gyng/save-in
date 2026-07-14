import {
  defineGrammar,
  literal,
  located,
  map,
  optional,
  parseSyntax,
  sequence,
  sourceFragment,
  sourcePointAt,
  sourceSpan,
  token,
  type SourceFragment,
  type SourceSpan,
} from "../shared/syntax-parser.ts";
export const ROUTING_RULE_GRAMMAR = String.raw`
routing-document = { ignored-line | rule } ;
rule             = clause, { clause } ;
clause           = clause-name, [ "/", regex-flags ], ":", [ " " ], value ;
clause-name      = { non-whitespace } ;
regex-flags      = { non-whitespace } ;
value            = { character } ;
ignored-line     = blank-line | optional-whitespace, "//", { character } ;
`;

export type RuleSyntaxIssue = {
  code: "bad-clause";
  line: number;
  column: number;
  source: string;
  span: SourceSpan;
};

export type RoutingLineEnvelopeCst = {
  readonly line: SourceFragment<"routing-line">;
  readonly terminator: SourceFragment<"line-terminator">;
};

export type RoutingClauseCst = RoutingLineEnvelopeCst & {
  readonly kind: "routing-clause-cst";
  readonly leadingTrivia: SourceFragment<"clause-leading-trivia">;
  readonly rawName: SourceFragment<"clause-name-token">;
  readonly flagsSeparator: SourceFragment<"flags-separator"> | null;
  readonly colon: SourceFragment<"clause-colon">;
  readonly valueLeadingTrivia: SourceFragment<"value-leading-trivia">;
  readonly value: SourceFragment<"clause-value-token">;
  readonly trailingTrivia: SourceFragment<"clause-trailing-trivia">;
};

export type RoutingTriviaCst = RoutingLineEnvelopeCst & {
  readonly kind: "routing-trivia-cst";
  readonly leadingTrivia: SourceFragment<"trivia-leading-whitespace">;
  readonly delimiter: SourceFragment<"comment-delimiter"> | null;
  readonly content: SourceFragment<"comment-content"> | null;
};

export type RoutingInvalidCst = RoutingLineEnvelopeCst & {
  readonly kind: "routing-invalid-cst";
  readonly leadingTrivia: SourceFragment<"invalid-leading-trivia">;
  readonly content: SourceFragment<"invalid-content">;
  readonly trailingTrivia: SourceFragment<"invalid-trailing-trivia">;
};

export type RoutingClauseNode = {
  kind: "clause";
  clauseKind: "matcher" | "capture" | "destination";
  raw: string;
  rawName: string;
  name: string;
  flags: string;
  value: string;
  span: SourceSpan;
  nameSpan: SourceSpan;
  flagsSpan: SourceSpan | null;
  valueSpan: SourceSpan;
  cst: RoutingClauseCst;
};

export type RoutingTriviaNode = {
  kind: "blank" | "comment";
  raw: string;
  span: SourceSpan;
  cst: RoutingTriviaCst;
};

export type RoutingInvalidNode = {
  kind: "invalid";
  raw: string;
  span: SourceSpan;
  cst: RoutingInvalidCst;
};

export type RoutingLineNode = RoutingClauseNode | RoutingTriviaNode | RoutingInvalidNode;

export type RoutingRuleNode = {
  kind: "rule";
  clauses: RoutingClauseNode[];
  span: SourceSpan;
};

export type RoutingDocumentNode = {
  kind: "routing-document";
  source: string;
  lines: RoutingLineNode[];
  rules: RoutingRuleNode[];
  span: SourceSpan;
};

export type ParsedRoutingAst = {
  ast: RoutingDocumentNode;
  issues: RuleSyntaxIssue[];
};

type SourceLine = {
  raw: string;
  line: number;
  start: number;
  end: number;
  parseStart: number;
  parseEnd: number;
  terminatorEnd: number;
};

const clauseParser = defineGrammar(
  map(
    sequence(
      located(token(/\S*(?=:)/, "clause name")),
      located(literal(":")),
      located(optional(literal(" "))),
      located(token(/.*/, "clause value")),
    ),
    ([rawName, colon, valueLeadingTrivia, value], span) => ({
      rawName,
      colon,
      valueLeadingTrivia,
      value,
      span,
    }),
  ),
);

const sourceLines = (source: string): SourceLine[] => {
  let offset = 0;
  const rawLines = source.split("\n");
  return rawLines.map((raw, index) => {
    const start = offset;
    const end = start + raw.length;
    const terminatorEnd = end + (index < rawLines.length - 1 ? 1 : 0);
    offset = terminatorEnd;
    return {
      raw,
      line: index + 1,
      start,
      end,
      parseStart: start,
      parseEnd: end,
      terminatorEnd,
    };
  });
};

const clauseKind = (name: string): RoutingClauseNode["clauseKind"] =>
  name === "into"
    ? "destination"
    : name === "capture" || name === "capturegroups"
      ? "capture"
      : "matcher";

const lineEnvelope = (source: string, line: SourceLine): RoutingLineEnvelopeCst => ({
  line: sourceFragment(source, "routing-line", line.start, line.end),
  terminator: sourceFragment(source, "line-terminator", line.end, line.terminatorEnd),
});

const parseClauseNode = (
  source: string,
  sourceLine: SourceLine,
): { node: RoutingClauseNode | null; issue: RuleSyntaxIssue | null } => {
  const parsed = parseSyntax(clauseParser, source, {
    offset: sourceLine.parseStart,
    limit: sourceLine.parseEnd,
  });
  if (!parsed.ok) {
    const consumed = /^\S*/.exec(source.slice(sourceLine.parseStart, sourceLine.parseEnd));
    /* v8 ignore next -- The zero-or-more expression always matches. */
    const consumedName = consumed?.[0].length ?? 0;
    // The clause grammar backtracks failed alternatives to the line start;
    // report after the consumed token so malformed clauses remain actionable.
    const position = sourcePointAt(source, sourceLine.parseStart + consumedName);
    return {
      node: null,
      issue: {
        code: "bad-clause",
        line: position.line,
        column: position.column,
        source: source.slice(sourceLine.parseStart, sourceLine.parseEnd),
        span: sourceSpan(source, sourceLine.parseStart, sourceLine.parseEnd),
      },
    };
  }

  const rawName = parsed.value.rawName.value;
  const separator = rawName.lastIndexOf("/");
  const name = (separator > 0 ? rawName.slice(0, separator) : rawName).toLowerCase();
  const flags = separator > 0 ? rawName.slice(separator + 1) : "";
  const nameEnd =
    parsed.value.rawName.span.start.offset + (separator > 0 ? separator : rawName.length);
  const flagsSpan =
    separator > 0 ? sourceSpan(source, nameEnd + 1, parsed.value.rawName.span.end.offset) : null;
  const raw = source.slice(parsed.span.start.offset, parsed.span.end.offset);
  const value = parsed.value.value.value;
  return {
    node: {
      kind: "clause",
      clauseKind: clauseKind(name),
      raw,
      rawName,
      name,
      flags,
      value,
      span: parsed.span,
      nameSpan: sourceSpan(source, parsed.value.rawName.span.start.offset, nameEnd),
      flagsSpan,
      valueSpan: parsed.value.value.span,
      cst: {
        kind: "routing-clause-cst",
        ...lineEnvelope(source, sourceLine),
        leadingTrivia: sourceFragment(
          source,
          "clause-leading-trivia",
          sourceLine.start,
          parsed.span.start.offset,
        ),
        rawName: sourceFragment(
          source,
          "clause-name-token",
          parsed.value.rawName.span.start.offset,
          parsed.value.rawName.span.end.offset,
        ),
        flagsSeparator:
          separator > 0 ? sourceFragment(source, "flags-separator", nameEnd, nameEnd + 1) : null,
        colon: sourceFragment(
          source,
          "clause-colon",
          parsed.value.colon.span.start.offset,
          parsed.value.colon.span.end.offset,
        ),
        valueLeadingTrivia: sourceFragment(
          source,
          "value-leading-trivia",
          parsed.value.valueLeadingTrivia.span.start.offset,
          parsed.value.valueLeadingTrivia.span.end.offset,
        ),
        value: sourceFragment(
          source,
          "clause-value-token",
          parsed.value.value.span.start.offset,
          parsed.value.value.span.end.offset,
        ),
        trailingTrivia: sourceFragment(
          source,
          "clause-trailing-trivia",
          parsed.span.end.offset,
          sourceLine.end,
        ),
      },
    },
    issue: null,
  };
};

const triviaNode = (source: string, line: SourceLine): RoutingTriviaNode => {
  const comment = line.raw.trimStart().startsWith("//");
  const delimiterStart = comment
    ? line.start + (line.raw.length - line.raw.trimStart().length)
    : line.end;
  return {
    kind: comment ? "comment" : "blank",
    raw: line.raw,
    span: sourceSpan(source, line.start, line.end),
    cst: {
      kind: "routing-trivia-cst",
      ...lineEnvelope(source, line),
      leadingTrivia: sourceFragment(
        source,
        "trivia-leading-whitespace",
        line.start,
        delimiterStart,
      ),
      delimiter: comment
        ? sourceFragment(source, "comment-delimiter", delimiterStart, delimiterStart + 2)
        : null,
      content: comment
        ? sourceFragment(source, "comment-content", delimiterStart + 2, line.end)
        : null,
    },
  };
};

export const parseRoutingRuleAst = (source: string): ParsedRoutingAst => {
  const lines = sourceLines(source);
  const astLines: RoutingLineNode[] = lines
    .filter((line) => !line.raw.trim() || line.raw.trimStart().startsWith("//"))
    .map((line) => triviaNode(source, line));
  const active = lines.filter((line) => !line.raw.trimStart().startsWith("//"));
  while (active[0] && !active[0].raw.trim()) active.shift();
  while (true) {
    const last = active.at(-1);
    if (!last || last.raw.trim()) break;
    active.pop();
  }
  const first = active[0];
  if (first) {
    const leading = first.raw.length - first.raw.trimStart().length;
    first.parseStart += leading;
  }
  const last = active.at(-1);
  if (last) {
    const trailing = last.raw.length - last.raw.trimEnd().length;
    last.parseEnd -= trailing;
  }

  const rules: RoutingRuleNode[] = [];
  const issues: RuleSyntaxIssue[] = [];
  let clauses: RoutingClauseNode[] = [];
  let ruleStart = -1;
  let ruleEnd = -1;

  const flush = () => {
    if (ruleStart < 0) return;
    rules.push({
      kind: "rule",
      clauses,
      span: sourceSpan(source, ruleStart, ruleEnd),
    });
    clauses = [];
    ruleStart = -1;
    ruleEnd = -1;
  };

  active.forEach((line) => {
    if (!line.raw.trim()) {
      flush();
      return;
    }
    if (ruleStart < 0) ruleStart = line.parseStart;
    ruleEnd = line.parseEnd;
    const parsed = parseClauseNode(source, line);
    if (parsed.node) {
      clauses.push(parsed.node);
      astLines.push(parsed.node);
    }
    if (parsed.issue) {
      issues.push(parsed.issue);
      astLines.push({
        kind: "invalid",
        raw: source.slice(line.parseStart, line.parseEnd),
        span: sourceSpan(source, line.parseStart, line.parseEnd),
        cst: {
          kind: "routing-invalid-cst",
          ...lineEnvelope(source, line),
          leadingTrivia: sourceFragment(
            source,
            "invalid-leading-trivia",
            line.start,
            line.parseStart,
          ),
          content: sourceFragment(source, "invalid-content", line.parseStart, line.parseEnd),
          trailingTrivia: sourceFragment(
            source,
            "invalid-trailing-trivia",
            line.parseEnd,
            line.end,
          ),
        },
      });
    }
  });
  flush();
  astLines.sort((left, right) => left.span.start.offset - right.span.start.offset);

  return {
    ast: {
      kind: "routing-document",
      source,
      lines: astLines,
      rules,
      span: sourceSpan(source, 0, source.length),
    },
    issues,
  };
};

export const validateRoutingRuleSyntax = (source: string): RuleSyntaxIssue[] =>
  parseRoutingRuleAst(source).issues;

export const serializeRoutingDocument = (node: RoutingDocumentNode): string => node.source;

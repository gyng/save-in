import {
  defineGrammar,
  literal,
  located,
  map,
  optional,
  parseSyntax,
  rest,
  sequence,
  sourcePointAt,
  sourceSpan,
  token,
  type SourceSpan,
} from "../shared/syntax-parser.ts";
import type { RuleToken } from "./rule-types.ts";

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
};

export type RoutingClauseNode = {
  kind: "clause";
  clauseKind: "matcher" | "capture" | "destination";
  raw: string;
  rawName: string;
  name: string;
  flags: string;
  value: string;
  token: RuleToken;
  span: SourceSpan;
  nameSpan: SourceSpan;
  flagsSpan: SourceSpan | null;
  valueSpan: SourceSpan;
};

export type RoutingTriviaNode = {
  kind: "blank" | "comment";
  raw: string;
  span: SourceSpan;
};

export type RoutingInvalidNode = {
  kind: "invalid";
  raw: string;
  span: SourceSpan;
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

export type ParsedRuleSyntax = {
  rules: RuleToken[][];
  issues: RuleSyntaxIssue[];
};

type SourceLine = {
  raw: string;
  line: number;
  start: number;
  end: number;
  parseStart: number;
  parseEnd: number;
};

const clauseParser = defineGrammar(
  map(
    sequence(
      located(token(/\S*(?=:)/, "clause name")),
      literal(":"),
      optional(literal(" ")),
      located(rest("clause value")),
    ),
    ([rawName, , , value], span) => ({ rawName, value, span }),
  ),
);

const sourceLines = (source: string): SourceLine[] => {
  let offset = 0;
  return source.split("\n").map((raw, index) => {
    const start = offset;
    const end = start + raw.length;
    offset = end + 1;
    return { raw, line: index + 1, start, end, parseStart: start, parseEnd: end };
  });
};

const clauseKind = (name: string): RoutingClauseNode["clauseKind"] =>
  name === "into"
    ? "destination"
    : name === "capture" || name === "capturegroups"
      ? "capture"
      : "matcher";

const parseClauseNode = (
  source: string,
  sourceLine: SourceLine,
): { node: RoutingClauseNode | null; issue: RuleSyntaxIssue | null } => {
  const parsed = parseSyntax(clauseParser, source, {
    offset: sourceLine.parseStart,
    limit: sourceLine.parseEnd,
  });
  if (!parsed.ok) {
    const consumedName = source
      .slice(sourceLine.parseStart, sourceLine.parseEnd)
      .match(/^\S*/)?.[0].length;
    const position = sourcePointAt(
      source,
      parsed.offset === sourceLine.parseStart
        ? sourceLine.parseStart + (consumedName ?? 0)
        : parsed.offset,
    );
    return {
      node: null,
      issue: {
        code: "bad-clause",
        line: position.line,
        column: position.column,
        source: source.slice(sourceLine.parseStart, sourceLine.parseEnd),
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
      token: [raw, rawName, value],
      span: parsed.span,
      nameSpan: sourceSpan(source, parsed.value.rawName.span.start.offset, nameEnd),
      flagsSpan,
      valueSpan: parsed.value.value.span,
    },
    issue: null,
  };
};

const triviaNode = (source: string, line: SourceLine): RoutingTriviaNode => ({
  kind: line.raw.trimStart().startsWith("//") ? "comment" : "blank",
  raw: line.raw,
  span: sourceSpan(source, line.start, line.end),
});

export const parseRoutingRuleAst = (source: string): ParsedRoutingAst => {
  const lines = sourceLines(source);
  const astLines: RoutingLineNode[] = lines
    .filter((line) => !line.raw.trim() || line.raw.trimStart().startsWith("//"))
    .map((line) => triviaNode(source, line));
  const active = lines.filter((line) => !line.raw.trimStart().startsWith("//"));
  while (active[0] && !active[0].raw.trim()) active.shift();
  while (active.at(-1) && !active.at(-1)!.raw.trim()) active.pop();
  if (active[0]) {
    const leading = active[0].raw.length - active[0].raw.trimStart().length;
    active[0].parseStart += leading;
  }
  if (active.at(-1)) {
    const trailing = active.at(-1)!.raw.length - active.at(-1)!.raw.trimEnd().length;
    active.at(-1)!.parseEnd -= trailing;
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

export const tokenizeRuleLines = (
  source: string,
): { tokens: RuleToken[]; issues: RuleSyntaxIssue[] } => {
  const tokens: RuleToken[] = [];
  const issues: RuleSyntaxIssue[] = [];
  sourceLines(source).forEach((line) => {
    const parsed = parseClauseNode(source, line);
    if (parsed.node) tokens.push(parsed.node.token);
    if (parsed.issue) issues.push(parsed.issue);
  });
  return { tokens, issues };
};

export const parseRoutingRuleSyntax = (source: string): ParsedRuleSyntax => {
  const parsed = parseRoutingRuleAst(source);
  return {
    rules: parsed.ast.rules.map((rule) => rule.clauses.map((clause) => clause.token)),
    issues: parsed.issues,
  };
};

export const validateRoutingRuleSyntax = (source: string): RuleSyntaxIssue[] =>
  parseRoutingRuleAst(source).issues;

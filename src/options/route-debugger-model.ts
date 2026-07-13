import { parseRoutingRuleAst } from "../routing/rule-syntax.ts";
import type { ValidationInfo } from "../shared/message-protocol.ts";
import { isStringKeyedRecord } from "../shared/message-protocol.ts";

export type RouteDebuggerClause = {
  name: string;
  pattern: string;
  matched: boolean;
  source?: { start: number; end: number; line: number } | undefined;
};

export type RouteDebuggerRule = {
  index: number;
  matched: boolean;
  destination: string;
  source?: { start: number; end: number; line: number } | undefined;
  clauses: RouteDebuggerClause[];
};

export type RouteDebuggerTrace = {
  selectedRule: number | null;
  destination: string | null;
  expandedDestination: string | null;
  sanitizedDestination: string | null;
  finalPath: string | null;
  rules: RouteDebuggerRule[];
};

export type RouteDebuggerFields = {
  filename: string;
  sourceUrl: string;
  pageUrl: string;
  mime: string;
  context: string;
  pageTitle?: string | undefined;
  referrerUrl?: string | undefined;
  frameUrl?: string | undefined;
  linkText?: string | undefined;
  selectionText?: string | undefined;
  mediaType?: string | undefined;
};

export type RouteSourceSummary = {
  lines: number;
  rules: number;
  matchers: number;
};

const nullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

export const parseRouteDebuggerTrace = (value: unknown): RouteDebuggerTrace | null => {
  if (
    !isStringKeyedRecord(value) ||
    !(value.selectedRule === null || typeof value.selectedRule === "number") ||
    !nullableString(value.destination) ||
    !nullableString(value.expandedDestination) ||
    !nullableString(value.sanitizedDestination) ||
    !nullableString(value.finalPath) ||
    !Array.isArray(value.rules)
  ) {
    return null;
  }

  const rules: RouteDebuggerRule[] = [];
  for (const candidate of value.rules) {
    if (
      !isStringKeyedRecord(candidate) ||
      typeof candidate.index !== "number" ||
      typeof candidate.matched !== "boolean" ||
      typeof candidate.destination !== "string" ||
      !Array.isArray(candidate.clauses)
    ) {
      return null;
    }
    const clauses: RouteDebuggerClause[] = [];
    for (const clause of candidate.clauses) {
      if (
        !isStringKeyedRecord(clause) ||
        typeof clause.name !== "string" ||
        typeof clause.pattern !== "string" ||
        typeof clause.matched !== "boolean"
      ) {
        return null;
      }
      clauses.push({ name: clause.name, pattern: clause.pattern, matched: clause.matched });
    }
    rules.push({
      index: candidate.index,
      matched: candidate.matched,
      destination: candidate.destination,
      clauses,
    });
  }

  return {
    selectedRule: value.selectedRule,
    destination: value.destination,
    expandedDestination: value.expandedDestination,
    sanitizedDestination: value.sanitizedDestination,
    finalPath: value.finalPath,
    rules,
  };
};

export const mapRouteTraceToSource = (
  source: string,
  trace: RouteDebuggerTrace,
): RouteDebuggerTrace => {
  const sourceRules = parseRoutingRuleAst(source).ast.rules;
  return {
    ...trace,
    rules: trace.rules.map((rule) => {
      const sourceRule = sourceRules[rule.index - 1];
      const matcherClauses = sourceRule?.clauses.filter(
        (clause) => clause.clauseKind === "matcher",
      );
      return {
        ...rule,
        ...(sourceRule
          ? {
              source: {
                start: sourceRule.span.start.offset,
                end: sourceRule.span.end.offset,
                line: sourceRule.span.start.line,
              },
            }
          : {}),
        clauses: rule.clauses.map((clause, index) => {
          const sourceClause = matcherClauses?.[index];
          return {
            ...clause,
            ...(sourceClause
              ? {
                  source: {
                    start: sourceClause.span.start.offset,
                    end: sourceClause.span.end.offset,
                    line: sourceClause.span.start.line,
                  },
                }
              : {}),
          };
        }),
      };
    }),
  };
};

export const routeDebuggerInfo = (fields: RouteDebuggerFields): ValidationInfo => {
  const info: ValidationInfo = {};
  if (fields.filename) {
    info.filename = fields.filename;
    info.initialFilename = fields.filename;
    info.resolvedFilename = fields.filename;
  }
  if (fields.sourceUrl) {
    info.sourceUrl = fields.sourceUrl;
    info.url = fields.sourceUrl;
  }
  if (fields.pageUrl) info.pageUrl = fields.pageUrl;
  if (fields.mime) info.mime = fields.mime;
  if (fields.context) info.context = fields.context;
  if (fields.pageTitle) info.currentTab = { title: fields.pageTitle };
  if (fields.referrerUrl) info.referrerUrl = fields.referrerUrl;
  if (fields.frameUrl) info.frameUrl = fields.frameUrl;
  if (fields.linkText) info.linkText = fields.linkText;
  if (fields.selectionText) info.selectionText = fields.selectionText;
  if (fields.mediaType) info.mediaType = fields.mediaType;
  return info;
};

export const summarizeRouteSource = (source: string): RouteSourceSummary => {
  const parsed = parseRoutingRuleAst(source).ast;
  return {
    lines: source ? source.split("\n").length : 0,
    rules: parsed.rules.length,
    matchers: parsed.rules.reduce(
      (total, rule) =>
        total + rule.clauses.filter((clause) => clause.clauseKind === "matcher").length,
      0,
    ),
  };
};

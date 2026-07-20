import { isRenameTransform, type RenameTransform } from "../../routing/rename.ts";
import { AUTOMATIC_CONTEXT } from "../../routing/automatic-rule.ts";
import { parseRoutingRuleAst } from "../../routing/rule-syntax.ts";
import { isDataUrl, parseDataUrlMediaType } from "../../shared/data-url.ts";
import type { PageSourceKind } from "../../shared/page-source.ts";
import type { ClickGesture } from "../../shared/click-gesture.ts";
import type { ValidationInfo } from "../../shared/message-protocol.ts";
import { isStringKeyedRecord } from "../../shared/message-protocol.ts";
import { parseVisualRoutingRules } from "../rule-editor/rule-visual-editor-model.ts";

export type RouteDebuggerClause = {
  name: string;
  pattern: string;
  matched: boolean;
  attempts?: RouteDebuggerAttempt[] | undefined;
  source?: { start: number; end: number; line: number } | undefined;
};

export type RouteDebuggerAttempt = {
  source: string;
  value: string | null;
  status: "matched" | "not-matched" | "missing" | "invalid";
  matchedText?: string | undefined;
  captures?: Array<string | null> | undefined;
};

export type RouteDebuggerRule = {
  index: number;
  name?: string | undefined;
  sourceIndex?: number | undefined;
  matched: boolean;
  destination: string;
  source?: { start: number; end: number; line: number } | undefined;
  clauses: RouteDebuggerClause[];
};

export type RouteDebuggerTrace = {
  selectedRule: number | null;
  // Optional so a trace from an older background that predates fetch: routing
  // still validates; absent means the winning rule did not rewrite the URL.
  selectedFetchTemplate?: string | null | undefined;
  rewrittenUrl?: string | null | undefined;
  // Same aging contract for rename: — absent means an older background or a
  // winning rule without a rename transform.
  selectedRename?: RenameTransform | null | undefined;
  renamedFrom?: string | null | undefined;
  renamedTo?: string | null | undefined;
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
  gesture?: ClickGesture | "" | undefined;
  pageTitle?: string | undefined;
  referrerUrl?: string | undefined;
  frameUrl?: string | undefined;
  linkText?: string | undefined;
  selectionText?: string | undefined;
  mediaType?: string | undefined;
  sourceKind?: PageSourceKind | "" | undefined;
  menuIndex?: string | undefined;
  comment?: string | undefined;
  now?: string | undefined;
  counter?: string | undefined;
  sha256?: string | undefined;
};

export type RouteSourceSummary = {
  lines: number;
  rules: number;
  matchers: number;
};

const nullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

const isAttemptStatus = (value: unknown): value is RouteDebuggerAttempt["status"] =>
  value === "matched" || value === "not-matched" || value === "missing" || value === "invalid";

const isNullableStringArray = (value: unknown): value is Array<string | null> =>
  Array.isArray(value) && value.every(nullableString);

const parseAttempts = (value: unknown): RouteDebuggerAttempt[] | null => {
  if (!Array.isArray(value)) return null;
  const attempts: RouteDebuggerAttempt[] = [];
  for (const attempt of value) {
    if (
      !isStringKeyedRecord(attempt) ||
      typeof attempt.source !== "string" ||
      !nullableString(attempt.value) ||
      !isAttemptStatus(attempt.status) ||
      !(typeof attempt.matchedText === "undefined" || typeof attempt.matchedText === "string") ||
      !(typeof attempt.captures === "undefined" || isNullableStringArray(attempt.captures))
    ) {
      return null;
    }
    attempts.push({
      source: attempt.source,
      value: attempt.value,
      status: attempt.status,
      ...(typeof attempt.matchedText === "string" ? { matchedText: attempt.matchedText } : {}),
      ...(isNullableStringArray(attempt.captures) ? { captures: attempt.captures } : {}),
    });
  }
  return attempts;
};

export const parseRouteDebuggerTrace = (value: unknown): RouteDebuggerTrace | null => {
  if (
    !isStringKeyedRecord(value) ||
    !(value.selectedRule === null || isPositiveSafeInteger(value.selectedRule)) ||
    !nullableString(value.destination) ||
    !nullableString(value.expandedDestination) ||
    !nullableString(value.sanitizedDestination) ||
    !nullableString(value.finalPath) ||
    !(value.selectedFetchTemplate === undefined || nullableString(value.selectedFetchTemplate)) ||
    !(value.rewrittenUrl === undefined || nullableString(value.rewrittenUrl)) ||
    !(
      value.selectedRename === undefined ||
      value.selectedRename === null ||
      isRenameTransform(value.selectedRename)
    ) ||
    !(value.renamedFrom === undefined || nullableString(value.renamedFrom)) ||
    !(value.renamedTo === undefined || nullableString(value.renamedTo)) ||
    !Array.isArray(value.rules)
  ) {
    return null;
  }

  const rules: RouteDebuggerRule[] = [];
  for (const candidate of value.rules) {
    if (
      !isStringKeyedRecord(candidate) ||
      !isPositiveSafeInteger(candidate.index) ||
      !(typeof candidate.name === "undefined" || typeof candidate.name === "string") ||
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
      const attempts =
        typeof clause.attempts === "undefined" ? undefined : parseAttempts(clause.attempts);
      if (attempts === null) return null;
      clauses.push({
        name: clause.name,
        pattern: clause.pattern,
        matched: clause.matched,
        ...(attempts ? { attempts } : {}),
      });
    }
    rules.push({
      index: candidate.index,
      ...(typeof candidate.name === "string" ? { name: candidate.name } : {}),
      matched: candidate.matched,
      destination: candidate.destination,
      clauses,
    });
  }

  return {
    selectedRule: value.selectedRule,
    ...(value.selectedFetchTemplate === undefined
      ? {}
      : { selectedFetchTemplate: value.selectedFetchTemplate }),
    ...(value.rewrittenUrl === undefined ? {} : { rewrittenUrl: value.rewrittenUrl }),
    ...(value.selectedRename === undefined ? {} : { selectedRename: value.selectedRename }),
    ...(value.renamedFrom === undefined ? {} : { renamedFrom: value.renamedFrom }),
    ...(value.renamedTo === undefined ? {} : { renamedTo: value.renamedTo }),
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
  const sourceRuleNames = parseVisualRoutingRules(source)
    .rules.filter((rule) => rule.enabled)
    .map((rule) => rule.comment);
  const sourceRules = parseRoutingRuleAst(source)
    .ast.rules.map((rule, sourceIndex) => ({ rule, sourceIndex }))
    .filter(
      ({ rule }) =>
        !rule.clauses.some(
          (clause) => clause.name === "disabled" && clause.value.trim().toLowerCase() === "true",
        ),
    );
  return {
    ...trace,
    rules: trace.rules.map((rule) => {
      const sourceEntry = sourceRules[rule.index - 1];
      const sourceRuleName = sourceRuleNames[rule.index - 1];
      const sourceRule = sourceEntry?.rule;
      const matcherClauses = sourceRule?.clauses.filter(
        (clause) => clause.clauseKind === "matcher" && clause.name !== "disabled",
      );
      return {
        ...rule,
        ...(sourceRuleName ? { name: sourceRuleName } : {}),
        ...(sourceEntry ? { sourceIndex: sourceEntry.sourceIndex } : {}),
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
  // An automatic save never carries these two: it derives mediaType from the
  // kind discovery found, and mime from a data: header, because such a URL has
  // no path to read an extension from (automation/automatic-routing.ts's
  // candidateInfo). Deriving them the same way is what makes the trace agree
  // with the save — without it a mediatype: or mime: rule is reported dead
  // while the router routes it, and the Media type field cannot even name the
  // document, stream and link kinds the source-kind field offers.
  const automatic = fields.context === AUTOMATIC_CONTEXT;
  const mime =
    fields.mime ||
    (automatic && isDataUrl(fields.sourceUrl) ? parseDataUrlMediaType(fields.sourceUrl) : "");
  if (mime) info.mime = mime;
  if (fields.context) info.context = fields.context;
  if (fields.gesture) info.gesture = fields.gesture;
  // Name the tab even when the field is blank: an absent key makes pagetitle:
  // fall back to the tracked tab, which while the debugger is open is the
  // options page itself, so a blank title would match "Save In" and report a
  // destination no real save reaches. Every production save attaches the key
  // explicitly for the same reason (see the external caller's guard in
  // background/messaging/handlers.ts).
  info.currentTab = fields.pageTitle ? { title: fields.pageTitle } : null;
  if (fields.referrerUrl) info.referrerUrl = fields.referrerUrl;
  if (fields.frameUrl) info.frameUrl = fields.frameUrl;
  if (fields.linkText) info.linkText = fields.linkText;
  if (fields.selectionText) info.selectionText = fields.selectionText;
  const mediaType = fields.mediaType || (automatic ? fields.sourceKind : "");
  if (mediaType) info.mediaType = mediaType;
  if (fields.sourceKind) info.sourceKind = fields.sourceKind;
  if (fields.menuIndex) info.menuIndex = fields.menuIndex;
  if (fields.comment) info.comment = fields.comment;
  if (fields.now) {
    const now = new Date(fields.now);
    if (Number.isFinite(now.getTime())) info.now = now.toISOString();
  }
  if (fields.counter) {
    const counter = Number(fields.counter);
    if (Number.isSafeInteger(counter) && counter >= 0) info.counter = counter;
  }
  if (fields.sha256) info.sha256 = fields.sha256;
  return info;
};

export const summarizeRouteSource = (source: string): RouteSourceSummary => {
  const parsed = parseRoutingRuleAst(source).ast;
  return {
    lines: source ? source.split("\n").length : 0,
    rules: parsed.rules.length,
    matchers: parsed.rules.reduce(
      (total, rule) =>
        total +
        rule.clauses.filter(
          (clause) => clause.clauseKind === "matcher" && clause.name !== "disabled",
        ).length,
      0,
    ),
  };
};

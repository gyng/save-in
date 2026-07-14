import { RULE_TYPES } from "../shared/constants.ts";
import type {
  MatcherAttempt,
  MatcherClause,
  MatcherResult,
  RoutingInfo,
  RoutingRule,
} from "./rule-types.ts";

export type EvaluatedMatcherClause = {
  clause: MatcherClause;
  result: MatcherResult;
  attempts: MatcherAttempt[];
};

export type RuleEvaluation = {
  destination: string | false;
  clauses: EvaluatedMatcherClause[];
};

const evaluateMatcherClause = (
  clause: MatcherClause,
  info: RoutingInfo,
): EvaluatedMatcherClause => {
  if (typeof clause.matcher !== "function") return { clause, result: false, attempts: [] };
  const explained = clause.matcher.explain?.(info, info);
  if (explained) return { clause, result: explained.result, attempts: explained.attempts };
  return { clause, result: clause.matcher(info, info), attempts: [] };
};

const evaluateMatcherClauses = (rule: RoutingRule, info: RoutingInfo): EvaluatedMatcherClause[] =>
  rule
    .filter((clause): clause is MatcherClause => clause.type === RULE_TYPES.MATCHER)
    .map((clause) => evaluateMatcherClause(clause, info));

const getCaptureMatcherResults = (
  rule: RoutingRule,
  evaluatedClauses: EvaluatedMatcherClause[],
): RegExpMatchArray[] | null => {
  const declaration = rule.find((clause) => clause.type === RULE_TYPES.CAPTURE);
  if (!declaration) return null;
  if (typeof declaration.value !== "string") return null;
  const names = declaration.value.split(",").map((name) => name.trim().toLowerCase());
  const captured: RegExpMatchArray[] = [];
  for (const name of names) {
    const clause = rule.find(
      (item): item is MatcherClause => item.type === RULE_TYPES.MATCHER && item.name === name,
    );
    const result = evaluatedClauses.find((evaluated) => evaluated.clause === clause)?.result;
    if (result) captured.push(result);
  }
  return captured.length === names.length ? captured : null;
};

const flattenCaptureGroups = (matches: RegExpMatchArray[]): (string | undefined)[] => [
  matches[0]?.[0],
  ...matches.flatMap((match) => match.slice(1)),
];

export const getCaptureMatches = (
  rule: RoutingRule,
  info: RoutingInfo,
): (string | undefined)[] | null => {
  const matches = getCaptureMatcherResults(rule, evaluateMatcherClauses(rule, info));
  const declaration = rule.find((clause) => clause.type === RULE_TYPES.CAPTURE);
  return matches
    ? declaration!.name === "capturegroups"
      ? flattenCaptureGroups(matches)
      : matches.flat()
    : null;
};

export const evaluateRule = (rule: RoutingRule, info: RoutingInfo): RuleEvaluation => {
  const clauses = evaluateMatcherClauses(rule, info);
  if (clauses.some(({ result }) => !result)) return { destination: false, clauses };
  const destinationClause = rule.find((clause) => clause.type === RULE_TYPES.DESTINATION);
  if (!destinationClause || typeof destinationClause.value !== "string") {
    return { destination: false, clauses };
  }
  let destination = destinationClause.value;
  const matches = getCaptureMatcherResults(rule, clauses);
  const declaration = rule.find((clause) => clause.type === RULE_TYPES.CAPTURE);
  const captured = matches
    ? declaration!.name === "capturegroups"
      ? flattenCaptureGroups(matches)
      : matches.flat()
    : null;
  if (captured) {
    destination = destination.replace(
      /:\$(\d+):/g,
      (_token, index: string) => captured[Number(index)] ?? "",
    );
  }
  return { destination, clauses };
};

export const matchRule = (rule: RoutingRule, info: RoutingInfo): string | false =>
  evaluateRule(rule, info).destination;

export const matchRules = (rules: RoutingRule[], info: RoutingInfo): string | null => {
  // Routing is ordered and intentionally non-chaining: the first complete
  // match owns the destination, and later rules never inspect its output.
  for (const rule of rules) {
    const result = matchRule(rule, info);
    if (result) return result;
  }
  return null;
};

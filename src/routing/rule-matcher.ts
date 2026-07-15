import { RULE_TYPES } from "../shared/constants.ts";
import type {
  CaptureClause,
  FetchClause,
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
  // Capture-substituted fetch template; routing variables stay unexpanded
  // because their resolution is async and happens in the download pipeline.
  fetch: string | false;
  clauses: EvaluatedMatcherClause[];
};

export type RuleMatch = {
  rule: RoutingRule;
  destination: string;
  fetch: string | null;
};

export const findFetchClause = (rule: RoutingRule): FetchClause | undefined =>
  rule.find((clause): clause is FetchClause => clause.type === RULE_TYPES.FETCH);

// Ordinary browser downloads can only be renamed, never re-requested, so
// rules that rewrite the download URL must be invisible to those pipelines.
export const isRenameOnlyEligibleRule = (rule: RoutingRule): boolean => !findFetchClause(rule);

type CaptureMatcherResults = {
  declaration: CaptureClause;
  matches: RegExpMatchArray[];
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
): CaptureMatcherResults | null => {
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
  return captured.length === names.length ? { declaration, matches: captured } : null;
};

const flattenCaptureGroups = (matches: RegExpMatchArray[]): (string | undefined)[] => [
  matches[0]?.[0],
  ...matches.flatMap((match) => match.slice(1)),
];

const captureValues = ({ declaration, matches }: CaptureMatcherResults): (string | undefined)[] =>
  declaration.name === "capturegroups" ? flattenCaptureGroups(matches) : matches.flat();

export const getCaptureMatches = (
  rule: RoutingRule,
  info: RoutingInfo,
): (string | undefined)[] | null => {
  const capture = getCaptureMatcherResults(rule, evaluateMatcherClauses(rule, info));
  return capture ? captureValues(capture) : null;
};

const substituteCaptures = (template: string, captured: (string | undefined)[] | null): string =>
  captured
    ? template.replace(/:\$(\d+):/g, (_token, index: string) => captured[Number(index)] ?? "")
    : template;

export const evaluateRule = (rule: RoutingRule, info: RoutingInfo): RuleEvaluation => {
  const clauses = evaluateMatcherClauses(rule, info);
  if (clauses.some(({ result }) => !result)) return { destination: false, fetch: false, clauses };
  const destinationClause = rule.find((clause) => clause.type === RULE_TYPES.DESTINATION);
  if (!destinationClause || typeof destinationClause.value !== "string") {
    return { destination: false, fetch: false, clauses };
  }
  const capture = getCaptureMatcherResults(rule, clauses);
  const captured = capture ? captureValues(capture) : null;
  const fetchClause = findFetchClause(rule);
  return {
    destination: substituteCaptures(destinationClause.value, captured),
    fetch: fetchClause ? substituteCaptures(fetchClause.value, captured) : false,
    clauses,
  };
};

export const matchRule = (rule: RoutingRule, info: RoutingInfo): string | false =>
  evaluateRule(rule, info).destination;

export const matchRulesDetailed = (
  rules: RoutingRule[],
  info: RoutingInfo,
  isEligible: (rule: RoutingRule) => boolean = () => true,
): RuleMatch | null => {
  // Routing is ordered and intentionally non-chaining: the first complete
  // match owns the destination, and later rules never inspect its output.
  // Ineligible rules are skipped, not match-consuming, so a later rule can
  // still win on pipelines that exclude some rules.
  for (const rule of rules) {
    if (!isEligible(rule)) continue;
    const evaluation = evaluateRule(rule, info);
    if (evaluation.destination) {
      return { rule, destination: evaluation.destination, fetch: evaluation.fetch || null };
    }
  }
  return null;
};

export const matchRules = (
  rules: RoutingRule[],
  info: RoutingInfo,
  isEligible?: (rule: RoutingRule) => boolean,
): string | null => matchRulesDetailed(rules, info, isEligible)?.destination ?? null;

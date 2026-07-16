import { RULE_TYPES } from "../shared/constants.ts";
import type { RenameTransform } from "./rename.ts";
import type {
  CaptureClause,
  FetchClause,
  MatcherAttempt,
  MatcherClause,
  MatcherResult,
  CssMatcherClause,
  RenameClause,
  RoutingInfo,
  RoutingRule,
} from "./rule-types.ts";
import { isCssMatcherClause, isRegexMatcherClause } from "./rule-types.ts";

export type EvaluatedMatcherClause = {
  clause: MatcherClause;
  result: MatcherResult;
  attempts: MatcherAttempt[];
};

export type RuleEvaluation = {
  destination: string | false;
  // Capture-substituted fetch template and rename replacement; routing
  // variables stay unexpanded because their resolution is async and happens
  // in the download pipeline.
  fetch: string | false;
  rename: RenameTransform | false;
  clauses: EvaluatedMatcherClause[];
};

export type RuleMatch = {
  rule: RoutingRule;
  destination: string;
  fetch: string | null;
  rename: RenameTransform | null;
};

export const findFetchClause = (rule: RoutingRule): FetchClause | undefined =>
  rule.find((clause): clause is FetchClause => clause.type === RULE_TYPES.FETCH);

export const findRenameClause = (rule: RoutingRule): RenameClause | undefined =>
  rule.find((clause): clause is RenameClause => clause.type === RULE_TYPES.RENAME);

const CONTENT_HASH_VARIABLE = /:sha256(?:full)?:/;

const needsContentHash = (rule: RoutingRule): boolean =>
  rule.some(
    (clause) =>
      (clause.type === RULE_TYPES.DESTINATION && CONTENT_HASH_VARIABLE.test(clause.value)) ||
      (clause.type === RULE_TYPES.RENAME && CONTENT_HASH_VARIABLE.test(clause.replacement)),
  );

export const isRenameOnlyEligibleMatch = (match: RuleMatch): boolean =>
  !CONTENT_HASH_VARIABLE.test(match.destination) &&
  !(match.rename && CONTENT_HASH_VARIABLE.test(match.rename.replacement));

// Ordinary browser downloads can only be renamed, never re-requested. A
// content hash would re-fetch and buffer the browser-owned download merely to
// name it, so URL rewrites and content-dependent rules are both invisible to
// this seam; ordered matching can continue at the next eligible rule.
export const isRenameOnlyEligibleRule = (rule: RoutingRule): boolean =>
  !findFetchClause(rule) && !needsContentHash(rule);

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
  evaluateMatchersWithCssOrigins(
    rule.filter((clause): clause is MatcherClause => clause.type === RULE_TYPES.MATCHER),
    info,
  );

const evaluateCssClauses = (
  clauses: CssMatcherClause[],
  info: RoutingInfo,
): EvaluatedMatcherClause[] => {
  const groups = info.matchedCssSelectorsByOrigin;
  if (!groups) {
    return clauses.map((clause) => ({
      clause,
      result: null,
      attempts: [{ source: "pageElement", value: null, status: "missing" }],
    }));
  }
  const matchingGroup = groups.find((group) => clauses.every(({ value }) => group.includes(value)));
  return clauses.map((clause) => ({
    clause,
    result: matchingGroup ? /^([\s\S]*)$/.exec(clause.value) : null,
    attempts: groups.length
      ? groups.map((group, index) => ({
          source: `pageElement[${index}]`,
          value: clause.value,
          status: group.includes(clause.value) ? "matched" : "not-matched",
          ...(group.includes(clause.value) ? { matchedText: clause.value, captures: [] } : {}),
        }))
      : [{ source: "pageElement", value: null, status: "missing" }],
  }));
};

const evaluateMatchersWithCssOrigins = (
  clauses: MatcherClause[],
  info: RoutingInfo,
): EvaluatedMatcherClause[] => {
  const cssClauses = clauses.filter(isCssMatcherClause);
  const cssEvaluations = new Map(
    evaluateCssClauses(cssClauses, info).map((evaluation) => [evaluation.clause, evaluation]),
  );
  return clauses.map((clause) =>
    isCssMatcherClause(clause)
      ? (cssEvaluations.get(clause) ?? evaluateMatcherClause(clause, info))
      : evaluateMatcherClause(clause, info),
  );
};

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
      (item) =>
        item.type === RULE_TYPES.MATCHER && item.name === name && isRegexMatcherClause(item),
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
  if (clauses.some(({ result }) => !result)) {
    return { destination: false, fetch: false, rename: false, clauses };
  }
  const destinationClause = rule.find((clause) => clause.type === RULE_TYPES.DESTINATION);
  if (!destinationClause || typeof destinationClause.value !== "string") {
    return { destination: false, fetch: false, rename: false, clauses };
  }
  const capture = getCaptureMatcherResults(rule, clauses);
  const captured = capture ? captureValues(capture) : null;
  const fetchClause = findFetchClause(rule);
  const renameClause = findRenameClause(rule);
  return {
    destination: substituteCaptures(destinationClause.value, captured),
    fetch: fetchClause ? substituteCaptures(fetchClause.value, captured) : false,
    rename: renameClause
      ? {
          find: renameClause.find.source,
          flags: renameClause.find.flags,
          replacement: substituteCaptures(renameClause.replacement, captured),
        }
      : false,
    clauses,
  };
};

export const matchRule = (rule: RoutingRule, info: RoutingInfo): string | false =>
  evaluateRule(rule, info).destination;

export const matchRulesDetailed = (
  rules: readonly RoutingRule[],
  info: RoutingInfo,
  isEligible: (rule: RoutingRule) => boolean = () => true,
  isMatchEligible: (match: RuleMatch) => boolean = () => true,
): RuleMatch | null => {
  // Routing is ordered and intentionally non-chaining: the first complete
  // match owns the destination, and later rules never inspect its output.
  // Ineligible rules are skipped, not match-consuming, so a later rule can
  // still win on pipelines that exclude some rules.
  for (const rule of rules) {
    if (!isEligible(rule)) continue;
    const evaluation = evaluateRule(rule, info);
    if (evaluation.destination) {
      const match = {
        rule,
        destination: evaluation.destination,
        fetch: evaluation.fetch || null,
        rename: evaluation.rename || null,
      };
      if (isMatchEligible(match)) return match;
    }
  }
  return null;
};

export const matchRules = (
  rules: readonly RoutingRule[],
  info: RoutingInfo,
  isEligible?: (rule: RoutingRule) => boolean,
  isMatchEligible?: (match: RuleMatch) => boolean,
): string | null =>
  matchRulesDetailed(rules, info, isEligible, isMatchEligible)?.destination ?? null;

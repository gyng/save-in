import { evaluateRule } from "../routing/rule-matcher.ts";
import { parseRoutingRuleAst } from "../routing/rule-syntax.ts";
import type { RoutingInfo, RoutingRule } from "../routing/rule-types.ts";
import {
  AUTOMATIC_CONTEXT,
  automaticRuleClauseIssues,
  isAutomaticRuleClauses,
  type AutomaticRuleIssue,
} from "../routing/automatic-rule.ts";
import type { PageSourceKind } from "../shared/page-source.ts";

export type AutomaticRoutingCandidate = {
  pageUrl: string;
  sourceUrl: string;
  sourceKind: PageSourceKind;
};

export type AutomaticRoutingMatch = {
  rule: RoutingRule;
  destination: string;
  fetch: string | null;
};

export const isEligibleAutomaticRoutingRule = (rule: RoutingRule): boolean =>
  isAutomaticRuleClauses(rule) && automaticRuleClauseIssues(rule).length === 0;

const candidateInfo = (candidate: AutomaticRoutingCandidate): RoutingInfo => ({
  context: AUTOMATIC_CONTEXT,
  mediaType: candidate.sourceKind,
  pageUrl: candidate.pageUrl,
  sourceKind: candidate.sourceKind,
  sourceUrl: candidate.sourceUrl,
  url: candidate.sourceUrl,
});

export const matchAutomaticRoutingRule = (
  rules: readonly RoutingRule[],
  candidate: AutomaticRoutingCandidate,
): AutomaticRoutingMatch | null => {
  const info = candidateInfo(candidate);
  for (const rule of rules) {
    if (!isEligibleAutomaticRoutingRule(rule)) continue;
    const evaluation = evaluateRule(rule, info);
    if (evaluation.destination) {
      return { rule, destination: evaluation.destination, fetch: evaluation.fetch || null };
    }
  }
  return null;
};

export const automaticRoutingRuleIssues = (source: string): AutomaticRuleIssue[] => {
  const parsed = parseRoutingRuleAst(source);
  return [...new Set(parsed.ast.rules.flatMap((rule) => automaticRuleClauseIssues(rule.clauses)))];
};

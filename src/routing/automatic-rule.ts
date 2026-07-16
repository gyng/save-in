export const AUTOMATIC_CONTEXT = "AUTO";
export const AUTOMATIC_CONTEXT_PATTERN = "^auto$";

export const AUTOMATIC_PAGE_MATCHERS = ["pageurl", "pagedomain", "pagerootdomain"] as const;
export const AUTOMATIC_SOURCE_MATCHERS = [
  "css",
  "sourceurl",
  "sourcedomain",
  "sourcerootdomain",
  "sourcekind",
  "mediatype",
  "fileext",
  "urlfileext",
] as const;

type PatternClause = {
  name: string;
  value: string | RegExp;
  flags?: string | undefined;
};

const patternParts = (clause: PatternClause): { source: string; flags: string | undefined } =>
  clause.value instanceof RegExp
    ? { source: clause.value.source, flags: clause.value.flags }
    : { source: clause.value, flags: clause.flags };

export const isAutomaticContextClause = (clause: PatternClause): boolean => {
  if (clause.name !== "context") return false;
  const { source, flags } = patternParts(clause);
  if (!/(^|[^a-z0-9_])auto([^a-z0-9_]|$)/i.test(source)) return false;
  try {
    const regex = new RegExp(source, flags);
    regex.lastIndex = 0;
    return regex.test(AUTOMATIC_CONTEXT.toLocaleLowerCase());
  } catch {
    return false;
  }
};

export const isAutomaticRuleClauses = (clauses: readonly PatternClause[]): boolean =>
  clauses.some(isAutomaticContextClause);

export type AutomaticRuleIssue = "page" | "source";

export const automaticRuleClauseIssues = (
  clauses: readonly PatternClause[],
): AutomaticRuleIssue[] => {
  if (!isAutomaticRuleClauses(clauses)) return [];
  const names = new Set(clauses.map(({ name }) => name));
  const issues: AutomaticRuleIssue[] = [];
  if (!AUTOMATIC_PAGE_MATCHERS.some((name) => names.has(name))) issues.push("page");
  if (!AUTOMATIC_SOURCE_MATCHERS.some((name) => names.has(name))) issues.push("source");
  return issues;
};

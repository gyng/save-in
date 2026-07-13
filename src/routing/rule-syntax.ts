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
export type ParsedRuleSyntax = {
  rules: RuleToken[][];
  issues: RuleSyntaxIssue[];
};

const CLAUSE_PATTERN = /^(\S*): ?(.*)$/;

const parseClause = (
  source: string,
  line: number,
): { token: RuleToken | null; issue: RuleSyntaxIssue | null } => {
  const matches = source.match(CLAUSE_PATTERN);
  if (!matches) {
    return {
      token: null,
      issue: { code: "bad-clause", line, column: 0, source },
    };
  }
  const [fullClause, name, value] = matches;
  return fullClause !== undefined && name !== undefined && value !== undefined
    ? { token: [fullClause, name, value], issue: null }
    : {
        token: null,
        issue: { code: "bad-clause", line, column: 0, source },
      };
};

export const tokenizeRuleLines = (
  source: string,
): { tokens: RuleToken[]; issues: RuleSyntaxIssue[] } => {
  const tokens: RuleToken[] = [];
  const issues: RuleSyntaxIssue[] = [];
  source.split("\n").forEach((line, index) => {
    const parsed = parseClause(line, index + 1);
    if (parsed.token) tokens.push(parsed.token);
    if (parsed.issue) issues.push(parsed.issue);
  });
  return { tokens, issues };
};

export const parseRoutingRuleSyntax = (source: string): ParsedRuleSyntax => {
  const rules: RuleToken[][] = [];
  const issues: RuleSyntaxIssue[] = [];
  let currentRule: RuleToken[] = [];
  let hasRuleSource = false;
  const lines = source
    .split("\n")
    .map((value, index) => ({ value, line: index + 1 }))
    .filter(({ value }) => !value.trimStart().startsWith("//"));
  while (lines[0] && !lines[0].value.trim()) lines.shift();
  while (lines.at(-1) && !lines.at(-1)!.value.trim()) lines.pop();
  if (lines[0]) lines[0].value = lines[0].value.trimStart();
  if (lines.at(-1)) lines.at(-1)!.value = lines.at(-1)!.value.trimEnd();

  const flush = () => {
    if (!hasRuleSource) return;
    rules.push(currentRule);
    currentRule = [];
    hasRuleSource = false;
  };

  lines.forEach(({ value, line }) => {
    if (!value.trim()) {
      flush();
      return;
    }
    hasRuleSource = true;
    const parsed = parseClause(value, line);
    if (parsed.token) currentRule.push(parsed.token);
    if (parsed.issue) issues.push(parsed.issue);
  });
  flush();

  return { rules, issues };
};

export const validateRoutingRuleSyntax = (source: string): RuleSyntaxIssue[] =>
  parseRoutingRuleSyntax(source).issues;

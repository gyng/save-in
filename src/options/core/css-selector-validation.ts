import { getMessage } from "../../platform/localization.ts";
import { parseRoutingRuleAst } from "../../routing/rule-syntax.ts";
import { isSelectorMatcherName, type RuleError } from "../../routing/rule-types.ts";

export const cssSelectorErrors = (
  source: string,
  root: Element = document.documentElement,
): RuleError[] =>
  parseRoutingRuleAst(source).ast.rules.flatMap((rule) =>
    rule.clauses.flatMap((clause) => {
      if (!isSelectorMatcherName(clause.name)) return [];
      const selector = clause.value;
      try {
        root.matches(selector);
        return [];
      } catch {
        return [
          {
            message: getMessage("ruleInvalidCssSelector") || "Invalid CSS selector",
            error: selector,
            location: {
              start: clause.valueSpan.start.offset,
              end: clause.valueSpan.end.offset,
              line: clause.valueSpan.start.line,
              column: clause.valueSpan.start.column,
            },
          },
        ];
      }
    }),
  );

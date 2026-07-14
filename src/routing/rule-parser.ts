import { RULE_TYPES } from "../shared/constants.ts";
import { matcherFunctions } from "./matchers.ts";
import { routingPorts } from "./ports.ts";
import { parseRoutingRuleAst, type RoutingRuleNode, type RuleSyntaxIssue } from "./rule-syntax.ts";
import type { SourceSpan } from "../shared/syntax-parser.ts";
import type {
  MatcherClause,
  RuleClause,
  RuleError,
  RuleErrorLocation,
  RoutingRule,
} from "./rule-types.ts";
import { automaticRuleClauseIssues, isAutomaticRuleClauses } from "./automatic-rule.ts";

const errorLocation = (span: SourceSpan): RuleErrorLocation => ({
  start: span.start.offset,
  end: span.end.offset,
  line: span.start.line,
  column: span.start.column,
});

const appendError = (
  errors: RuleError[],
  message: string,
  error: string,
  span: SourceSpan,
  warning = false,
): void => {
  errors.push({
    message,
    error,
    location: errorLocation(span),
    ...(warning ? { warning: true } : {}),
  });
};

const appendSyntaxErrors = (issues: RuleSyntaxIssue[], errors: RuleError[]): void => {
  issues.forEach((issue) => {
    appendError(
      errors,
      routingPorts.getMessage("ruleBadClause"),
      issue.source || "invalid line syntax",
      issue.span,
    );
  });
};

const captureGroupCount = (regex: RegExp): number => {
  const source = regex.source;
  let groups = 0;
  let inClass = false;
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === "\\") i += 1;
    else if (source[i] === "[") inClass = true;
    else if (source[i] === "]") inClass = false;
    else if (!inClass && source[i] === "(" && source[i + 1] !== "?") groups += 1;
    else if (!inClass && source.slice(i, i + 3) === "(?<" && !/[=!]/.test(source[i + 3] || ""))
      groups += 1;
  }
  return groups;
};

const isPlainMatchAll = (regex: RegExp): boolean => /^(?:\.\*|\^\.\*\$)$/.test(regex.source);

const parseSemanticRule = (
  rule: RoutingRuleNode,
  errors: RuleError[] = [],
): RoutingRule | false => {
  const controls = rule.clauses.filter((line) => line.name === "disabled");
  if (controls.length > 1) {
    appendError(
      errors,
      routingPorts.getMessage("ruleBadClause"),
      "disabled may appear only once",
      controls[1]!.span,
    );
    return false;
  }
  const control = controls[0];
  if (control) {
    const value = control.value.trim().toLowerCase();
    if (value !== "true" && value !== "false") {
      appendError(
        errors,
        routingPorts.getMessage("ruleBadClause"),
        "disabled must be true or false",
        control.valueSpan,
      );
      return false;
    }
    if (value === "true") return false;
  }
  const lines = rule.clauses.filter((line) => line.name !== "disabled");
  const automaticIssues = automaticRuleClauseIssues(lines);
  automaticIssues.forEach((issue) =>
    appendError(
      errors,
      issue === "page"
        ? routingPorts.getMessage("ruleAutomaticMissingPage")
        : routingPorts.getMessage("ruleAutomaticMissingSource"),
      issue === "page" ? "pageurl:" : "sourceurl:",
      rule.span,
    ),
  );
  const clauses: (RuleClause | false)[] = lines.map((line) => {
    const { name, flags, value: rawValue } = line;
    if (name === "into") {
      return {
        name,
        value: rawValue.replace(/^\.\//, ""),
        type: RULE_TYPES.DESTINATION,
      };
    }
    if (name === "capture" || name === "capturegroups") {
      return { name, value: rawValue, type: RULE_TYPES.CAPTURE };
    }

    let value: RegExp;
    try {
      value = new RegExp(rawValue, flags);
    } catch (error) {
      appendError(
        errors,
        routingPorts.getMessage("ruleInvalidRegex"),
        flags ? `invalid regex flags: ${flags} (${error})` : `${error}`,
        flags ? (line.flagsSpan ?? line.valueSpan) : line.valueSpan,
      );
      return false;
    }
    const factory = Object.hasOwn(matcherFunctions, name)
      ? matcherFunctions[name as keyof typeof matcherFunctions]
      : undefined;
    if (!factory) {
      appendError(errors, routingPorts.getMessage("ruleUnknownMatcher"), `${name}:`, line.nameSpan);
      return false;
    }
    return { name, value, type: RULE_TYPES.MATCHER, matcher: factory(value) };
  });
  const valid = clauses.filter((clause): clause is RuleClause => clause !== false);
  if (valid.length !== clauses.length || automaticIssues.length > 0) return false;
  const destinations = valid.filter((clause) => clause.type === RULE_TYPES.DESTINATION);
  const destinationNodes = lines.filter((line) => line.name === "into");
  const destination = destinations[0];
  const destinationNode = destinationNodes[0];
  if (!destination || !destination.value.trim()) {
    appendError(
      errors,
      routingPorts.getMessage("ruleMissingInto"),
      destination ? destination.value : "",
      destinationNode?.valueSpan ?? rule.span,
    );
    return false;
  }
  if (
    destination.value.match(/:\$\d+:/) &&
    !valid.some((clause) => clause.type === RULE_TYPES.CAPTURE)
  )
    appendError(
      errors,
      routingPorts.getMessage("ruleMissingCapture"),
      destination.value,
      destinationNode?.valueSpan ?? rule.span,
    );
  if (!valid.some((clause) => clause.type === RULE_TYPES.MATCHER)) {
    appendError(
      errors,
      routingPorts.getMessage("ruleMissingMatcher"),
      JSON.stringify(lines.map((line) => line.raw)),
      rule.span,
    );
    return false;
  }
  if (destinations.length >= 2) {
    appendError(
      errors,
      routingPorts.getMessage("ruleExtraInto"),
      JSON.stringify(lines.map((line) => line.raw)),
      destinationNodes[1]?.span ?? rule.span,
    );
    return false;
  }
  const captures = valid.filter((clause) => clause.type === RULE_TYPES.CAPTURE);
  const captureNodes = lines.filter(
    (line) => line.name === "capture" || line.name === "capturegroups",
  );
  if (captures.length >= 2) {
    appendError(
      errors,
      routingPorts.getMessage("ruleMultipleCapture"),
      JSON.stringify(lines.map((line) => line.raw)),
      captureNodes[1]?.span ?? rule.span,
    );
    return false;
  }
  if (captures.length === 1) {
    const capture = captures[0];
    if (!capture) return false;
    const captureNode = captureNodes[0];
    const names = capture.value.split(",").map((name) => name.trim().toLowerCase());
    const matcherCandidates = names.map((name) =>
      valid.filter((clause) => clause.type === RULE_TYPES.MATCHER && clause.name === name),
    );
    const capturedMatchers = matcherCandidates.map((matches) => matches[0]);
    let missing = false;
    names.forEach((name, index) => {
      const candidates = matcherCandidates[index] || [];
      if (!capturedMatchers[index] || (capture.name === "capturegroups" && candidates.length > 1)) {
        appendError(
          errors,
          routingPorts.getMessage("ruleCaptureMissingMatcher"),
          `${capture.name}: ${name}`,
          captureNode?.valueSpan ?? rule.span,
        );
        missing = true;
      } else if (capture.name === "capture" && candidates.length > 1) {
        appendError(
          errors,
          routingPorts.getMessage("ruleCaptureAmbiguousMatcher"),
          `capture: ${name}`,
          captureNode?.valueSpan ?? rule.span,
          true,
        );
      }
    });
    if (missing) return false;
    const definiteCapturedMatchers = capturedMatchers.filter(
      (clause): clause is MatcherClause => clause !== undefined,
    );
    const availableIndexes = definiteCapturedMatchers.reduce(
      (total, clause) => total + captureGroupCount(clause.value) + 1,
      capture.name === "capturegroups" ? 1 - capturedMatchers.length : 0,
    );
    const indexes = [...destination.value.matchAll(/:\$(\d+):/g)].map((match) => Number(match[1]));
    if (indexes.some((index) => index >= availableIndexes)) {
      appendError(
        errors,
        routingPorts.getMessage("ruleMissingCapture"),
        destination.value,
        destinationNode?.valueSpan ?? rule.span,
      );
      return false;
    }
  }
  // Whole-rule cardinality and capture references cannot be expressed by the
  // clause union; issue the brand only after those invariants have been checked.
  return valid as RoutingRule;
};

export const parseRulesCollecting = (
  raw: string,
): { rules: RoutingRule[]; errors: RuleError[] } => {
  const syntax = parseRoutingRuleAst(raw);
  const errors: RuleError[] = [];
  appendSyntaxErrors(syntax.issues, errors);
  const parsedRules = syntax.ast.rules
    .map((ast) => ({ ast, rule: parseSemanticRule(ast, errors) }))
    .filter((entry): entry is { ast: RoutingRuleNode; rule: RoutingRule } => Boolean(entry.rule));
  const rules = parsedRules.map((entry) => entry.rule);
  for (let index = 1; index < parsedRules.length; index += 1) {
    const laterEntry = parsedRules[index];
    if (!laterEntry) continue;
    const laterRule = laterEntry.rule;
    const shadowed = parsedRules.slice(0, index).some(({ rule: earlier }) => {
      if (isAutomaticRuleClauses(earlier) !== isAutomaticRuleClauses(laterRule)) return false;
      const earlierMatchers = earlier.filter((clause) => clause.type === RULE_TYPES.MATCHER);
      const laterMatchers = laterRule.filter((clause) => clause.type === RULE_TYPES.MATCHER);
      return earlierMatchers.every((earlierClause) =>
        earlierClause.name.toLowerCase() === "filename" && isPlainMatchAll(earlierClause.value)
          ? true
          : laterMatchers.some((laterClause) => {
              if (laterClause.name !== earlierClause.name) return false;
              const a = earlierClause.value;
              const b = laterClause.value;
              return isPlainMatchAll(a) || (a.source === b.source && a.flags === b.flags);
            }),
      );
    });
    if (shadowed) {
      appendError(
        errors,
        routingPorts.getMessage("ruleShadowed"),
        `rule ${index + 1}`,
        laterEntry.ast.span,
        true,
      );
    }
  }
  return { rules, errors };
};

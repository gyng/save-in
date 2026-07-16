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
import { findBannedFetchVariables, findUnknownPathVariables } from "./path-variables.ts";

const errorLocation = (span: SourceSpan): RuleErrorLocation => ({
  start: span.start.offset,
  end: span.end.offset,
  line: span.start.line,
  column: span.start.column,
});

const spanWithin = (span: SourceSpan, start: number, length: number): SourceSpan => ({
  start: {
    offset: span.start.offset + start,
    line: span.start.line,
    column: span.start.column + start,
  },
  end: {
    offset: span.start.offset + start + length,
    line: span.start.line,
    column: span.start.column + start + length,
  },
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
    appendError(errors, routingPorts.getMessage("ruleBadClause"), issue.source, issue.span);
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
    else if (!inClass && source.slice(i, i + 3) === "(?<") {
      const groupMarker = source[i + 3];
      if (groupMarker !== undefined && !/[=!]/.test(groupMarker)) groups += 1;
    }
  }
  return groups;
};

const isPlainMatchAll = (regex: RegExp): boolean => /^(?:\.\*|\^\.\*\$)$/.test(regex.source);

const ruleHasFetchClause = (rule: readonly RuleClause[]): boolean =>
  rule.some((clause) => clause.type === RULE_TYPES.FETCH);

const isMatcherName = (name: string): name is keyof typeof matcherFunctions =>
  Object.hasOwn(matcherFunctions, name);

const parseSemanticRule = (
  rule: RoutingRuleNode,
  errors: RuleError[] = [],
): RoutingRule | false => {
  const controls = rule.clauses.filter((line) => line.name === "disabled");
  if (controls.length > 1) {
    const duplicateControl = controls[1];
    /* v8 ignore next -- Two parsed controls necessarily provide a second control node. */
    if (!duplicateControl) return false;
    appendError(
      errors,
      routingPorts.getMessage("ruleBadClause"),
      "disabled may appear only once",
      duplicateControl.span,
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
    if (name === "fetch") {
      // One leading space is grammar trivia; any other whitespace in a URL
      // template is accidental and would corrupt the request line.
      return { name, value: rawValue.trim(), type: RULE_TYPES.FETCH };
    }

    let value: RegExp;
    try {
      value = new RegExp(rawValue, flags);
    } catch (error) {
      appendError(
        errors,
        routingPorts.getMessage("ruleInvalidRegex"),
        flags ? `invalid regex flags: ${flags} (${error})` : `${error}`,
        /* v8 ignore next -- Parsed flags always carry a flags span. */
        flags ? (line.flagsSpan ?? line.valueSpan) : line.valueSpan,
      );
      return false;
    }
    const factory = isMatcherName(name) ? matcherFunctions[name] : undefined;
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
  if (!destination || !destinationNode || !destination.value.trim()) {
    appendError(
      errors,
      routingPorts.getMessage("ruleMissingInto"),
      destination ? destination.value : "",
      destinationNode?.valueSpan ?? rule.span,
    );
    return false;
  }
  // Scan the raw node text, not the normalized clause value: stripped
  // prefixes and whitespace would shift every reported span off target.
  const unknownVariables = findUnknownPathVariables(destinationNode.value);
  for (const variable of unknownVariables) {
    appendError(
      errors,
      routingPorts.getMessage("ruleUnknownDestinationVariable"),
      variable.value,
      spanWithin(destinationNode.valueSpan, variable.start, variable.value.length),
    );
  }
  if (unknownVariables.length > 0) return false;
  const fetchClauses = valid.filter((clause) => clause.type === RULE_TYPES.FETCH);
  const fetchNodes = lines.filter((line) => line.name === "fetch");
  if (fetchClauses.length >= 2) {
    const duplicateFetch = fetchNodes[1];
    /* v8 ignore next -- Two parsed fetch clauses necessarily provide a second fetch node. */
    if (!duplicateFetch) return false;
    appendError(
      errors,
      routingPorts.getMessage("ruleExtraFetch"),
      JSON.stringify(lines.map((line) => line.raw)),
      duplicateFetch.span,
    );
    return false;
  }
  const fetchClause = fetchClauses[0];
  const fetchNode = fetchNodes[0];
  if (fetchClause && fetchNode) {
    // The scheme and authority marker must be literal so no expansion can
    // reintroduce data:, javascript:, or file: requests at runtime.
    if (!/^https?:\/\//.test(fetchClause.value)) {
      appendError(
        errors,
        routingPorts.getMessage("ruleFetchNotHttp"),
        fetchClause.value,
        fetchNode.valueSpan,
      );
      return false;
    }
    // Scan the raw node text so spans stay aligned when the trimmed clause
    // value dropped extra leading whitespace.
    const unknownFetchVariables = findUnknownPathVariables(fetchNode.value);
    for (const variable of unknownFetchVariables) {
      appendError(
        errors,
        routingPorts.getMessage("ruleUnknownDestinationVariable"),
        variable.value,
        spanWithin(fetchNode.valueSpan, variable.start, variable.value.length),
      );
    }
    const bannedFetchVariables = findBannedFetchVariables(fetchNode.value);
    for (const variable of bannedFetchVariables) {
      appendError(
        errors,
        routingPorts.getMessage("ruleFetchUnsupportedVariable"),
        variable.value,
        spanWithin(fetchNode.valueSpan, variable.start, variable.value.length),
      );
    }
    if (unknownFetchVariables.length > 0 || bannedFetchVariables.length > 0) return false;
    if (
      fetchClause.value.match(/:\$\d+:/) &&
      !valid.some((clause) => clause.type === RULE_TYPES.CAPTURE)
    )
      appendError(
        errors,
        routingPorts.getMessage("ruleMissingCapture"),
        fetchClause.value,
        fetchNode.valueSpan,
      );
  }
  if (
    destination.value.match(/:\$\d+:/) &&
    !valid.some((clause) => clause.type === RULE_TYPES.CAPTURE)
  )
    appendError(
      errors,
      routingPorts.getMessage("ruleMissingCapture"),
      destination.value,
      destinationNode.valueSpan,
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
    const duplicateDestination = destinationNodes[1];
    /* v8 ignore next -- Two parsed destinations necessarily provide a second destination node. */
    if (!duplicateDestination) return false;
    appendError(
      errors,
      routingPorts.getMessage("ruleExtraInto"),
      JSON.stringify(lines.map((line) => line.raw)),
      duplicateDestination.span,
    );
    return false;
  }
  const captures = valid.filter((clause) => clause.type === RULE_TYPES.CAPTURE);
  const captureNodes = lines.filter(
    (line) => line.name === "capture" || line.name === "capturegroups",
  );
  if (captures.length >= 2) {
    const duplicateCapture = captureNodes[1];
    /* v8 ignore next -- Two parsed captures necessarily provide a second capture node. */
    if (!duplicateCapture) return false;
    appendError(
      errors,
      routingPorts.getMessage("ruleMultipleCapture"),
      JSON.stringify(lines.map((line) => line.raw)),
      duplicateCapture.span,
    );
    return false;
  }
  if (captures.length === 1) {
    const capture = captures[0];
    const captureNode = captureNodes[0];
    /* v8 ignore next -- A parsed capture clause supplies both representations. */
    if (!capture || !captureNode) return false;
    const names = capture.value.split(",").map((name) => name.trim().toLowerCase());
    const matcherCandidates = names.map((name) =>
      valid.filter((clause) => clause.type === RULE_TYPES.MATCHER && clause.name === name),
    );
    const capturedMatchers = matcherCandidates.map((matches) => matches[0]);
    let missing = false;
    names.forEach((name, index) => {
      /* v8 ignore next -- matcherCandidates is mapped one-for-one from names. */
      const candidates = matcherCandidates[index] ?? [];
      if (!capturedMatchers[index] || (capture.name === "capturegroups" && candidates.length > 1)) {
        appendError(
          errors,
          routingPorts.getMessage("ruleCaptureMissingMatcher"),
          `${capture.name}: ${name}`,
          captureNode.valueSpan,
        );
        missing = true;
      } else if (capture.name === "capture" && candidates.length > 1) {
        appendError(
          errors,
          routingPorts.getMessage("ruleCaptureAmbiguousMatcher"),
          `capture: ${name}`,
          captureNode.valueSpan,
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
        destinationNode.valueSpan,
      );
      return false;
    }
    const fetchIndexes = fetchClause
      ? [...fetchClause.value.matchAll(/:\$(\d+):/g)].map((match) => Number(match[1]))
      : [];
    if (fetchIndexes.some((index) => index >= availableIndexes)) {
      appendError(
        errors,
        routingPorts.getMessage("ruleMissingCapture"),
        /* v8 ignore next -- A non-empty fetchIndexes list proves fetchClause exists. */
        fetchClause?.value ?? "",
        /* v8 ignore next -- Parsed fetch clauses and fetch nodes come one-for-one from the same lines. */
        fetchNode?.valueSpan ?? rule.span,
      );
      return false;
    }
  }
  // Fatal whole-rule cardinality and capture-target invariants cannot be
  // expressed by the clause union; issue the parser brand only after checking them.
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
    /* v8 ignore next -- The loop bound guarantees an entry at this index. */
    if (!laterEntry) continue;
    const laterRule = laterEntry.rule;
    const shadowed = parsedRules.slice(0, index).some(({ rule: earlier }) => {
      if (isAutomaticRuleClauses(earlier) !== isAutomaticRuleClauses(laterRule)) return false;
      // A fetch rule ahead of a plain twin leaves the plain rule live in
      // ordinary browser-download routing, which skips fetch rules. A plain
      // rule ahead of a fetch twin wins in every pipeline the fetch rule is
      // eligible for, so that fetch rule is genuinely dead and stays flagged.
      if (ruleHasFetchClause(earlier) && !ruleHasFetchClause(laterRule)) return false;
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

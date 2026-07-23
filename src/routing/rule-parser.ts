import { RULE_TYPES } from "../shared/constants.ts";
import { matcherFunctions } from "./matchers.ts";
import { routingPorts } from "./ports.ts";
import {
  parseRoutingRuleAst,
  type RoutingClauseNode,
  type RoutingRuleNode,
  type RuleSyntaxIssue,
} from "./rule-syntax.ts";
import type { SourceSpan } from "../shared/syntax-parser.ts";
import type {
  MatcherClause,
  RegexMatcherClause,
  RuleClause,
  RuleError,
  RuleErrorLocation,
  RoutingRule,
} from "./rule-types.ts";
import { isRegexMatcherClause } from "./rule-types.ts";
import {
  MAX_CSS_SELECTOR_LENGTH,
  MAX_CSS_SELECTOR_MATCHES,
  MAX_CSS_SELECTORS_PER_ORIGIN,
} from "../shared/css-selector-attestation.ts";
import { automaticRuleClauseIssues, isAutomaticRuleClauses } from "./automatic-rule.ts";
import { findBannedFetchVariables, findUnknownPathVariables } from "./path-variables.ts";
import { RENAME_SEPARATOR, splitRenameValue } from "./rename.ts";
import { isRenameOnlyEligibleRule } from "./rule-matcher.ts";
import { isSafeRoutingRegex } from "./regex-safety.ts";
import { isUsableFetchTemplate } from "./fetch-url.ts";
import { invalidDestinationRange } from "./destination-safety.ts";
import { ROUTES_TO_FOLDER_REGEX } from "./path.ts";
import { isRoutingActionName, ROUTING_ACTION_VALUES } from "./action-values.ts";

// A trailing separator routes into a directory and keeps the download's own
// name. Shared with the router and the download plan so the warning below can
// never disagree with where the file actually lands.
const ROUTES_TO_FOLDER = ROUTES_TO_FOLDER_REGEX;
// A routing variable or capture reference, i.e. a component that expands to a
// different value per download rather than a fixed literal.
const EXPANDING_DESTINATION_TOKEN = /:(?:[A-Za-z][A-Za-z0-9_]*|\$\d+):/;

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

const appendDuplicateClauseError = (
  nodes: readonly RoutingClauseNode[],
  errors: RuleError[],
  message: string,
  lines: readonly RoutingClauseNode[],
): boolean => {
  const duplicate = nodes[1];
  if (!duplicate) return false;
  appendError(errors, message, JSON.stringify(lines.map((line) => line.raw)), duplicate.span);
  return true;
};

const appendMissingCaptureError = (value: string, span: SourceSpan, errors: RuleError[]): void => {
  appendError(errors, routingPorts.getMessage("ruleMissingCapture"), value, span);
};

const appendUncapturedReferenceError = (
  referenceValue: string,
  span: SourceSpan,
  hasCapture: boolean,
  errors: RuleError[],
  reportedValue = referenceValue,
): boolean => {
  if (!/:\$\d+:/.test(referenceValue) || hasCapture) return false;
  appendMissingCaptureError(reportedValue, span, errors);
  return true;
};

const hasOutOfRangeCapture = (value: string, availableIndexes: number): boolean =>
  [...value.matchAll(/:\$(\d+):/g)].some((match) => Number(match[1]) >= availableIndexes);

const rejectOutOfRangeCapture = (
  value: string,
  span: SourceSpan,
  availableIndexes: number,
  errors: RuleError[],
  reportedValue = value,
): boolean => {
  if (!hasOutOfRangeCapture(value, availableIndexes)) return false;
  appendMissingCaptureError(reportedValue, span, errors);
  return true;
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

const isPlainMatchAll = (regex: RegExp): boolean =>
  /^(?:\(\?:\)|\.\*|\^\.\*\$)$/.test(regex.source);

const clauseAcceptsRegexFlags = (line: RoutingRuleNode["clauses"][number]): boolean =>
  line.name === "rename" ||
  !["after", "capture", "capturegroups", "css", "disabled", "exclude", "fetch", "into"].includes(
    line.name,
  );

const hasDynamicOutputCapture = (rule: readonly RuleClause[]): boolean =>
  rule.some(
    (clause) =>
      (clause.type === RULE_TYPES.DESTINATION && /:\$\d+:/.test(clause.value)) ||
      (clause.type === RULE_TYPES.RENAME && /:\$\d+:/.test(clause.replacement)),
  );

const isAlwaysRenameOnlyEligibleRule = (rule: RoutingRule): boolean =>
  isRenameOnlyEligibleRule(rule) && !hasDynamicOutputCapture(rule);

const issueFallsWithinRule = (issue: RuleSyntaxIssue, rule: RoutingRuleNode): boolean =>
  issue.span.start.offset >= rule.span.start.offset &&
  issue.span.end.offset <= rule.span.end.offset;

const isMatcherName = (name: string): name is keyof typeof matcherFunctions =>
  Object.hasOwn(matcherFunctions, name);

const cssMatcher = (selector: string): MatcherClause["matcher"] => {
  const matcher = (info: Parameters<MatcherClause["matcher"]>[0]) =>
    info.matchedCssSelectorsByOrigin?.some((group) => group.includes(selector)) === true
      ? /^([\s\S]*)$/.exec(selector)
      : null;
  return matcher;
};

const parseSemanticRule = (
  rule: RoutingRuleNode,
  errors: RuleError[] = [],
): RoutingRule | false => {
  let invalidFlags = false;
  rule.clauses.forEach((line) => {
    if (line.flagsSpan === null) return;
    if (!line.flags) {
      appendError(
        errors,
        routingPorts.getMessage("ruleInvalidRegex"),
        "empty regular-expression flags after /",
        line.flagsSpan,
      );
      invalidFlags = true;
      return;
    }
    if (!clauseAcceptsRegexFlags(line)) {
      const message =
        line.name === "css"
          ? routingPorts.getMessage("ruleCssFlags")
          : routingPorts.getMessage("ruleClauseFlags");
      appendError(errors, message, `${line.name}/${line.flags}:`, line.flagsSpan);
      invalidFlags = true;
    }
  });
  if (invalidFlags) return false;

  const controls = rule.clauses.filter((line) => line.name === "disabled");
  if (controls.length > 1) {
    const duplicateControl = controls[1] as (typeof controls)[number];
    appendError(
      errors,
      routingPorts.getMessage("ruleBadClause"),
      "disabled may appear only once",
      duplicateControl.span,
    );
    return false;
  }
  const control = controls[0];
  let disabled = false;
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
    disabled = value === "true";
  }
  const lines = rule.clauses.filter((line) => line.name !== "disabled");
  const excessCssLine = lines.filter((line) => line.name === "css")[MAX_CSS_SELECTORS_PER_ORIGIN];
  if (excessCssLine) {
    appendError(
      errors,
      routingPorts.getMessage("ruleTooManyCssSelectors"),
      excessCssLine.value.trim(),
      excessCssLine.valueSpan,
    );
    return false;
  }
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
    if (isRoutingActionName(name)) {
      const expectedValue = ROUTING_ACTION_VALUES[name];
      if (rawValue.trim().toLowerCase() !== expectedValue) {
        appendError(
          errors,
          routingPorts.getMessage("ruleBadClause"),
          `${name} must be ${expectedValue}`,
          line.valueSpan,
        );
        return false;
      }
      return name === "exclude"
        ? { name, value: ROUTING_ACTION_VALUES.exclude, type: RULE_TYPES.ACTION }
        : { name, value: ROUTING_ACTION_VALUES.after, type: RULE_TYPES.ACTION };
    }
    if (name === "rename") {
      const parts = splitRenameValue(rawValue);
      if (!parts) {
        appendError(
          errors,
          routingPorts.getMessage("ruleRenameMissingSeparator"),
          rawValue,
          line.valueSpan,
        );
        return false;
      }
      let find: RegExp;
      try {
        find = new RegExp(parts.find, flags);
      } catch (error) {
        appendError(
          errors,
          routingPorts.getMessage("ruleInvalidRegex"),
          flags ? `invalid regex flags: ${flags} (${error})` : `${error}`,
          flags ? (line.flagsSpan as typeof line.valueSpan) : line.valueSpan,
        );
        return false;
      }
      if (!isSafeRoutingRegex(find)) {
        appendError(
          errors,
          routingPorts.getMessage("ruleUnsafeRegex"),
          parts.find,
          spanWithin(line.valueSpan, 0, parts.find.length),
          true,
        );
      }
      return {
        name,
        value: rawValue,
        find,
        replacement: parts.replacement,
        type: RULE_TYPES.RENAME,
      };
    }

    if (name === "css") {
      // CSS permits escaped trailing whitespace (for example an ID ending in
      // a space). The syntax parser already removes the grammar's one trivia
      // space after the colon, so preserve the selector value byte-for-byte.
      const selector = rawValue;
      if (!selector.trim() || selector.length > MAX_CSS_SELECTOR_LENGTH) {
        appendError(
          errors,
          routingPorts.getMessage("ruleInvalidCssSelector"),
          selector,
          line.valueSpan,
        );
        return false;
      }
      return {
        name,
        value: selector,
        type: RULE_TYPES.MATCHER,
        matcher: cssMatcher(selector),
      };
    }

    let value: RegExp;
    try {
      value = new RegExp(rawValue, flags);
    } catch (error) {
      appendError(
        errors,
        routingPorts.getMessage("ruleInvalidRegex"),
        flags ? `invalid regex flags: ${flags} (${error})` : `${error}`,
        flags ? (line.flagsSpan as typeof line.valueSpan) : line.valueSpan,
      );
      return false;
    }
    const factory = isMatcherName(name) ? matcherFunctions[name] : undefined;
    if (!factory) {
      appendError(errors, routingPorts.getMessage("ruleUnknownMatcher"), `${name}:`, line.nameSpan);
      return false;
    }
    if (rawValue === "") {
      appendError(
        errors,
        routingPorts.getMessage("ruleEmptyMatcher"),
        `${name}:`,
        line.valueSpan,
        true,
      );
    } else if (rawValue !== rawValue.trim()) {
      appendError(
        errors,
        routingPorts.getMessage("ruleSuspiciousWhitespace"),
        rawValue,
        line.valueSpan,
        true,
      );
    }
    if (!isSafeRoutingRegex(value)) {
      appendError(
        errors,
        routingPorts.getMessage("ruleUnsafeRegex"),
        rawValue,
        line.valueSpan,
        true,
      );
    }
    return { name, value, type: RULE_TYPES.MATCHER, matcher: factory(value) };
  });
  const valid = clauses.filter((clause): clause is RuleClause => clause !== false);
  if (valid.length !== clauses.length || automaticIssues.length > 0) return false;
  const exclusionNodes = lines.filter((line) => line.name === "exclude");
  const tabActionNodes = lines.filter((line) => line.name === "after");
  if (exclusionNodes.length > 1) {
    appendError(
      errors,
      routingPorts.getMessage("ruleBadClause"),
      "exclude may appear only once",
      (exclusionNodes[1] as (typeof exclusionNodes)[number]).span,
    );
    return false;
  }
  if (tabActionNodes.length > 1) {
    appendError(
      errors,
      routingPorts.getMessage("ruleBadClause"),
      "after may appear only once",
      (tabActionNodes[1] as (typeof tabActionNodes)[number]).span,
    );
    return false;
  }
  const excluded = exclusionNodes.length === 1;
  if (excluded) {
    const incompatible = lines.find((line) =>
      ["after", "capture", "capturegroups", "fetch", "into", "rename"].includes(line.name),
    );
    if (incompatible) {
      appendError(
        errors,
        routingPorts.getMessage("ruleBadClause"),
        `exclude cannot be combined with ${incompatible.name}`,
        incompatible.span,
      );
      return false;
    }
    if (!valid.some((clause) => clause.type === RULE_TYPES.MATCHER)) {
      appendError(
        errors,
        routingPorts.getMessage("ruleMissingMatcher"),
        JSON.stringify(lines.map((line) => line.raw)),
        rule.span,
      );
      return false;
    }
    return disabled ? false : (valid as RoutingRule);
  }
  if (tabActionNodes.length === 1 && isAutomaticRuleClauses(valid)) {
    appendError(
      errors,
      routingPorts.getMessage("ruleBadClause"),
      "automatic rules cannot close tabs",
      (tabActionNodes[0] as (typeof tabActionNodes)[number]).span,
    );
    return false;
  }
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
  const relativePrefixLength = destinationNode.value.startsWith("./") ? 2 : 0;
  const invalidDestination = invalidDestinationRange(
    destinationNode.value.slice(relativePrefixLength),
  );
  if (invalidDestination) {
    appendError(
      errors,
      routingPorts.getMessage("ruleDestinationMustBeRelative"),
      destinationNode.value,
      spanWithin(
        destinationNode.valueSpan,
        relativePrefixLength + invalidDestination.start,
        invalidDestination.length,
      ),
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
  // `into:` names the saved file unless it ends with "/" (the folder route in
  // downloads/download-plan.ts) or its final component expands per download.
  // A constant final component names every match identically, so they collapse
  // onto one file — usually a folder that was meant instead (#196). Legal, so
  // this warns rather than rejecting.
  // The name starts after the last separator of either kind — the same ones the
  // folder test below reads. Splitting on "/" alone lets a variable in an
  // earlier component make a constant name look like it varies.
  const lastSeparator = Math.max(
    destination.value.lastIndexOf("/"),
    destination.value.lastIndexOf("\\"),
  );
  const finalDestinationComponent = destination.value.slice(lastSeparator + 1);
  if (
    !ROUTES_TO_FOLDER.test(destination.value) &&
    finalDestinationComponent.trim() &&
    !EXPANDING_DESTINATION_TOKEN.test(finalDestinationComponent)
  ) {
    appendError(
      errors,
      routingPorts.getMessage("ruleIntoConstantFilename"),
      destinationNode.value,
      destinationNode.valueSpan,
      true,
    );
  }
  const fetchClauses = valid.filter((clause) => clause.type === RULE_TYPES.FETCH);
  const fetchNodes = lines.filter((line) => line.name === "fetch");
  if (
    appendDuplicateClauseError(fetchNodes, errors, routingPorts.getMessage("ruleExtraFetch"), lines)
  ) {
    return false;
  }
  const fetchClause = fetchClauses[0];
  const fetchNode = fetchNodes[0];
  if (
    fetchClause &&
    fetchNode &&
    valid.some((clause) => clause.type === RULE_TYPES.MATCHER && clause.name === "finalfilename")
  ) {
    // Chrome learns finalfilename only after the request has started, when a
    // fetch: URL rewrite is no longer possible. Reject the cross-phase pair in
    // both browsers instead of accepting a Firefox-only rule that silently
    // behaves differently on Chrome.
    appendError(
      errors,
      routingPorts.getMessage("ruleFetchFinalFilenameUnsupported"),
      fetchClause.value,
      fetchNode.valueSpan,
    );
    return false;
  }
  if (fetchClause && fetchNode) {
    // The scheme and authority marker must be literal so no expansion can
    // reintroduce data:, javascript:, or file: requests at runtime.
    if (!isUsableFetchTemplate(fetchClause.value)) {
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
      appendUncapturedReferenceError(
        fetchClause.value,
        fetchNode.valueSpan,
        valid.some((clause) => clause.type === RULE_TYPES.CAPTURE),
        errors,
      )
    ) {
      return false;
    }
  }
  const renameClauses = valid.filter((clause) => clause.type === RULE_TYPES.RENAME);
  const renameNodes = lines.filter((line) => line.name === "rename");
  if (
    appendDuplicateClauseError(
      renameNodes,
      errors,
      routingPorts.getMessage("ruleExtraRename"),
      lines,
    )
  ) {
    return false;
  }
  const renameClause = renameClauses[0];
  const renameNode = renameNodes[0];
  if (renameClause && renameNode) {
    // Only the replacement side expands variables; the find side is a regex
    // where ":name:" is ordinary pattern text. Scan the raw node text so the
    // reported spans line up with the source.
    const separatorEnd = renameNode.value.indexOf(RENAME_SEPARATOR) + RENAME_SEPARATOR.length;
    const unknownRenameVariables = findUnknownPathVariables(
      renameNode.value.slice(separatorEnd),
    ).map((variable) => ({
      ...variable,
      start: variable.start + separatorEnd,
      end: variable.end + separatorEnd,
    }));
    for (const variable of unknownRenameVariables) {
      appendError(
        errors,
        routingPorts.getMessage("ruleUnknownDestinationVariable"),
        variable.value,
        spanWithin(renameNode.valueSpan, variable.start, variable.value.length),
      );
    }
    if (unknownRenameVariables.length > 0) return false;
    if (
      appendUncapturedReferenceError(
        renameClause.replacement,
        renameNode.valueSpan,
        valid.some((clause) => clause.type === RULE_TYPES.CAPTURE),
        errors,
        renameClause.value,
      )
    ) {
      return false;
    }
  }
  if (
    appendUncapturedReferenceError(
      destination.value,
      destinationNode.valueSpan,
      valid.some((clause) => clause.type === RULE_TYPES.CAPTURE),
      errors,
    )
  ) {
    return false;
  }
  if (!valid.some((clause) => clause.type === RULE_TYPES.MATCHER)) {
    appendError(
      errors,
      routingPorts.getMessage("ruleMissingMatcher"),
      JSON.stringify(lines.map((line) => line.raw)),
      rule.span,
    );
    return false;
  }
  if (
    appendDuplicateClauseError(
      destinationNodes,
      errors,
      routingPorts.getMessage("ruleExtraInto"),
      lines,
    )
  ) {
    return false;
  }
  const captures = valid.filter((clause) => clause.type === RULE_TYPES.CAPTURE);
  const captureNodes = lines.filter(
    (line) => line.name === "capture" || line.name === "capturegroups",
  );
  if (
    appendDuplicateClauseError(
      captureNodes,
      errors,
      routingPorts.getMessage("ruleMultipleCapture"),
      lines,
    )
  ) {
    return false;
  }
  if (captures.length === 1) {
    const capture = captures[0] as (typeof captures)[number];
    const captureNode = captureNodes[0] as (typeof captureNodes)[number];
    const names = capture.value.split(",").map((name) => name.trim().toLowerCase());
    const capturedMatchers: RegexMatcherClause[] = [];
    let missing = false;
    names.forEach((name) => {
      const candidates = valid.filter(
        (clause): clause is MatcherClause =>
          clause.type === RULE_TYPES.MATCHER && clause.name === name,
      );
      const capturedMatcher = candidates.find(isRegexMatcherClause);
      if (!capturedMatcher || (capture.name === "capturegroups" && candidates.length > 1)) {
        appendError(
          errors,
          routingPorts.getMessage("ruleCaptureMissingMatcher"),
          `${capture.name}: ${name}`,
          captureNode.valueSpan,
        );
        missing = true;
      } else {
        capturedMatchers.push(capturedMatcher);
        if (capture.name !== "capture" || candidates.length <= 1) return;
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
    const availableIndexes = capturedMatchers.reduce(
      (total, clause) => total + captureGroupCount(clause.value) + 1,
      capture.name === "capturegroups" ? 1 - capturedMatchers.length : 0,
    );
    if (
      rejectOutOfRangeCapture(
        destination.value,
        destinationNode.valueSpan,
        availableIndexes,
        errors,
      )
    ) {
      return false;
    }
    if (
      fetchClause &&
      fetchNode &&
      rejectOutOfRangeCapture(fetchClause.value, fetchNode.valueSpan, availableIndexes, errors)
    ) {
      return false;
    }
    if (
      renameClause &&
      renameNode &&
      rejectOutOfRangeCapture(
        renameClause.replacement,
        renameNode.valueSpan,
        availableIndexes,
        errors,
        renameClause.value,
      )
    ) {
      return false;
    }
  }
  // Fatal whole-rule cardinality and capture-target invariants cannot be
  // expressed by the clause union; issue the parser brand only after checking them.
  return disabled ? false : (valid as RoutingRule);
};

export const parseRulesCollecting = (
  raw: string,
): { rules: RoutingRule[]; errors: RuleError[] } => {
  const syntax = parseRoutingRuleAst(raw);
  const errors: RuleError[] = [];
  appendSyntaxErrors(syntax.issues, errors);
  const parsedRules = syntax.ast.rules
    .map((ast, sourceIndex) => ({
      ast,
      sourceIndex,
      rule: syntax.issues.some((issue) => issueFallsWithinRule(issue, ast))
        ? false
        : parseSemanticRule(ast, errors),
    }))
    .filter((entry): entry is { ast: RoutingRuleNode; sourceIndex: number; rule: RoutingRule } =>
      Boolean(entry.rule),
    );
  const cssNodes = parsedRules.flatMap(({ ast }) =>
    ast.clauses.filter((clause) => clause.name === "css"),
  );
  const excessCssNode = cssNodes[MAX_CSS_SELECTOR_MATCHES];
  if (excessCssNode) {
    appendError(
      errors,
      routingPorts.getMessage("ruleTooManyCssSelectors"),
      excessCssNode.value.trim(),
      excessCssNode.valueSpan,
    );
    return { rules: [], errors };
  }
  const rules = parsedRules.map((entry) => entry.rule);
  for (let index = 1; index < parsedRules.length; index += 1) {
    const laterEntry = parsedRules[index] as (typeof parsedRules)[number];
    const laterRule = laterEntry.rule;
    const shadowed = parsedRules.slice(0, index).some(({ rule: earlier }) => {
      if (isAutomaticRuleClauses(earlier) !== isAutomaticRuleClauses(laterRule)) return false;
      // A rule that ordinary browser routing may skip leaves an always-eligible
      // plain twin live in that pipeline. This includes fetch/hash rules and a
      // captured output that can become a hash token after matching. The
      // reverse order is genuinely shadowed in every shared pipeline.
      if (
        !isAutomaticRuleClauses(laterRule) &&
        !isAlwaysRenameOnlyEligibleRule(earlier) &&
        isRenameOnlyEligibleRule(laterRule)
      )
        return false;
      const earlierMatchers = earlier.filter((clause) => clause.type === RULE_TYPES.MATCHER);
      const laterMatchers = laterRule.filter((clause) => clause.type === RULE_TYPES.MATCHER);
      return earlierMatchers.every((earlierClause) =>
        earlierClause.name.toLowerCase() === "filename" &&
        typeof earlierClause.value !== "string" &&
        isPlainMatchAll(earlierClause.value)
          ? true
          : laterMatchers.some((laterClause) => {
              if (laterClause.name !== earlierClause.name) return false;
              const a = earlierClause.value;
              const b = laterClause.value;
              if (typeof a === "string" || typeof b === "string") return a === b;
              return isPlainMatchAll(a) || (a.source === b.source && a.flags === b.flags);
            }),
      );
    });
    if (shadowed) {
      appendError(
        errors,
        routingPorts.getMessage("ruleShadowed"),
        `rule ${laterEntry.sourceIndex + 1}`,
        laterEntry.ast.span,
        true,
      );
    }
  }
  return { rules, errors };
};

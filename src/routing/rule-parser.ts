import { RULE_TYPES } from "../shared/constants.ts";
import { matcherFunctions } from "./matchers.ts";
import { routingPorts } from "./ports.ts";
import type { MatcherClause, RuleClause, RuleError, RoutingRule, RuleToken } from "./rule-types.ts";

export const tokenizeLines = (lines: string, errors: RuleError[] = []): RuleToken[] =>
  lines
    .split("\n")
    .map((line) => ({ line, matches: line.match(/^(\S*): ?(.*)/) }))
    .map(({ line, matches }) => {
      if (!matches || matches.length < 3) {
        errors.push({
          message: routingPorts.getMessage("ruleBadClause"),
          error: `${line || "invalid line syntax"}`,
        });
        return null;
      }
      const [fullClause, name, value] = matches;
      return fullClause !== undefined && name !== undefined && value !== undefined
        ? ([fullClause, name, value] satisfies RuleToken)
        : null;
    })
    .filter((tokens): tokens is RuleToken => Boolean(tokens && tokens.length >= 3));

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

export const parseRule = (lines: RuleToken[], errors: RuleError[] = []): RoutingRule | false => {
  const clauses: (RuleClause | false)[] = lines.map((tokens) => {
    const [, rawName, rawValue] = tokens;
    const flagSeparator = rawName.lastIndexOf("/");
    const name = (flagSeparator > 0 ? rawName.slice(0, flagSeparator) : rawName).toLowerCase();
    const flags = flagSeparator > 0 ? rawName.slice(flagSeparator + 1) : "";
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
      errors.push({
        message: routingPorts.getMessage("ruleInvalidRegex"),
        error: flags ? `invalid regex flags: ${flags} (${error})` : `${error}`,
      });
      return false;
    }
    const factory = Object.hasOwn(matcherFunctions, name)
      ? matcherFunctions[name as keyof typeof matcherFunctions]
      : undefined;
    if (!factory) {
      errors.push({ message: routingPorts.getMessage("ruleUnknownMatcher"), error: `${name}:` });
      return false;
    }
    return { name, value, type: RULE_TYPES.MATCHER, matcher: factory(value) };
  });
  const valid = clauses.filter((clause): clause is RuleClause => clause !== false);
  if (valid.length !== clauses.length) return false;
  const destinations = valid.filter((clause) => clause.type === RULE_TYPES.DESTINATION);
  const destination = destinations[0];
  if (!destination || !destination.value.trim()) {
    errors.push({
      message: routingPorts.getMessage("ruleMissingInto"),
      error: destination ? destination.value : "",
    });
    return false;
  }
  if (
    destination.value.match(/:\$\d+:/) &&
    !valid.some((clause) => clause.type === RULE_TYPES.CAPTURE)
  )
    errors.push({
      message: routingPorts.getMessage("ruleMissingCapture"),
      error: destination.value,
    });
  if (!valid.some((clause) => clause.type === RULE_TYPES.MATCHER)) {
    errors.push({
      message: routingPorts.getMessage("ruleMissingMatcher"),
      error: JSON.stringify(lines.map((line) => line[0])),
    });
    return false;
  }
  if (destinations.length >= 2) {
    errors.push({
      message: routingPorts.getMessage("ruleExtraInto"),
      error: JSON.stringify(lines.map((line) => line[0])),
    });
    return false;
  }
  const captures = valid.filter((clause) => clause.type === RULE_TYPES.CAPTURE);
  if (captures.length >= 2) {
    errors.push({
      message: routingPorts.getMessage("ruleMultipleCapture"),
      error: JSON.stringify(lines.map((line) => line[0])),
    });
    return false;
  }
  if (captures.length === 1) {
    const capture = captures[0];
    if (!capture) return false;
    const names = capture.value.split(",").map((name) => name.trim().toLowerCase());
    const matcherCandidates = names.map((name) =>
      valid.filter((clause) => clause.type === RULE_TYPES.MATCHER && clause.name === name),
    );
    const capturedMatchers = matcherCandidates.map((matches) => matches[0]);
    let missing = false;
    names.forEach((name, index) => {
      const candidates = matcherCandidates[index] || [];
      if (!capturedMatchers[index] || (capture.name === "capturegroups" && candidates.length > 1)) {
        errors.push({
          message: routingPorts.getMessage("ruleCaptureMissingMatcher"),
          error: `${capture.name}: ${name}`,
        });
        missing = true;
      } else if (capture.name === "capture" && candidates.length > 1) {
        errors.push({
          message: routingPorts.getMessage("ruleCaptureAmbiguousMatcher"),
          error: `capture: ${name}`,
          warning: true,
        });
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
      errors.push({
        message: routingPorts.getMessage("ruleMissingCapture"),
        error: destination.value,
      });
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
  const source = raw
    .split("\n")
    .map((line) => (line.trim() === "" ? "" : line))
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n")
    .trim();
  if (!source) return { rules: [], errors: [] };
  const errors: RuleError[] = [];
  const rules = source
    .replace(/\n\n+/g, "\n\n")
    .split("\n\n")
    .map((lines) => tokenizeLines(lines, errors))
    .map((tokens) => parseRule(tokens, errors))
    .filter((rule): rule is RoutingRule => Boolean(rule));
  for (let index = 1; index < rules.length; index += 1) {
    const laterRule = rules[index];
    if (!laterRule) continue;
    const shadowed = rules.slice(0, index).some((earlier) => {
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
    if (shadowed)
      errors.push({
        message: routingPorts.getMessage("ruleShadowed"),
        error: `rule ${index + 1}`,
        warning: true,
      });
  }
  return { rules, errors };
};

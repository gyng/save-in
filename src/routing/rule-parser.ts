import { RULE_TYPES } from "../shared/constants.ts";
import type { RuleType } from "../shared/constants.ts";
import { matcherFunctions } from "./matchers.ts";
import { routingPorts } from "./ports.ts";
import type { RuleClause, RuleError, RoutingRule, RuleToken } from "./rule-types.ts";

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
      return matches;
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

export const parseRule = (lines: RuleToken[], errors: RuleError[] = []): RoutingRule | false => {
  const clauses: (RuleClause | false)[] = lines.map((tokens) => {
    const rawName = tokens[1];
    const flagSeparator = rawName.lastIndexOf("/");
    const name = flagSeparator > 0 ? rawName.slice(0, flagSeparator) : rawName;
    const flags = flagSeparator > 0 ? rawName.slice(flagSeparator + 1) : "";
    let value: string | RegExp;
    try {
      value = name === "into" || name === "capture" ? tokens[2] : new RegExp(tokens[2], flags);
    } catch (error) {
      errors.push({
        message: routingPorts.getMessage("ruleInvalidRegex"),
        error: flags ? `invalid regex flags: ${flags} (${error})` : `${error}`,
      });
      return false;
    }
    let type: RuleType = RULE_TYPES.MATCHER;
    if (name === "into") {
      type = RULE_TYPES.DESTINATION;
      value = (value as string).replace(/^\.\//, "");
    } else if (name === "capture") type = RULE_TYPES.CAPTURE;
    if (type !== RULE_TYPES.MATCHER) return { name, value, type };
    const matcherName = name.toLowerCase();
    const factory = Object.hasOwn(matcherFunctions, matcherName)
      ? matcherFunctions[matcherName as keyof typeof matcherFunctions]
      : undefined;
    if (!factory) {
      errors.push({ message: routingPorts.getMessage("ruleUnknownMatcher"), error: `${name}:` });
      return false;
    }
    return { name, value, type, matcher: factory(value as RegExp) };
  });
  if (clauses.some((clause) => clause === false)) return false;
  const valid = clauses as RuleClause[];
  const destinations = valid.filter((clause) => clause.type === RULE_TYPES.DESTINATION);
  if (!destinations.length || !(destinations[0].value as string).trim()) {
    errors.push({
      message: routingPorts.getMessage("ruleMissingInto"),
      error: destinations.length ? (destinations[0].value as string) : "",
    });
    return false;
  }
  const destination = destinations[0];
  if (
    (destination.value as string).match(/:\$\d+:/) &&
    !valid.some((clause) => clause.name === "capture")
  )
    errors.push({
      message: routingPorts.getMessage("ruleMissingCapture"),
      error: destination.value as string,
      warning: true,
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
  const captures = valid.filter((clause) => clause.name === "capture");
  if (captures.length >= 2) {
    errors.push({
      message: routingPorts.getMessage("ruleMultipleCapture"),
      error: JSON.stringify(lines.map((line) => line[0])),
    });
    return false;
  }
  if (captures.length === 1) {
    const names = (captures[0].value as string).split(",").map((name) => name.trim());
    let missing = false;
    for (const name of names)
      if (!valid.some((clause) => clause.name === name)) {
        errors.push({
          message: routingPorts.getMessage("ruleCaptureMissingMatcher"),
          error: `capture: ${name}`,
        });
        missing = true;
      }
    if (missing) return false;
    const availableIndexes = names.reduce((total, name) => {
      const clause = valid.find((item) => item.type === RULE_TYPES.MATCHER && item.name === name);
      return total + captureGroupCount(clause?.value as RegExp) + 1;
    }, 0);
    const indexes = [...(destination.value as string).matchAll(/:\$(\d+):/g)].map((match) =>
      Number(match[1]),
    );
    if (indexes.some((index) => index >= availableIndexes)) {
      errors.push({
        message: routingPorts.getMessage("ruleMissingCapture"),
        error: destination.value as string,
      });
      return false;
    }
  }
  return valid;
};

export const parseRulesCollecting = (
  raw: string,
): { rules: RoutingRule[]; errors: RuleError[] } => {
  const source = raw
    .split("\n")
    .filter((line) => !line.startsWith("//"))
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
    const shadowed = rules.slice(0, index).some((earlier) => {
      const earlierMatchers = earlier.filter((clause) => clause.type === RULE_TYPES.MATCHER);
      const laterMatchers = rules[index].filter((clause) => clause.type === RULE_TYPES.MATCHER);
      return earlierMatchers.every((earlierClause) =>
        laterMatchers.some((laterClause) => {
          if (laterClause.name !== earlierClause.name) return false;
          const a = earlierClause.value as RegExp;
          const b = laterClause.value as RegExp;
          return (
            (/^(?:\.\*|\^\.\*\$)$/.test(a.source) && !a.flags) ||
            (a.source === b.source && a.flags === b.flags)
          );
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

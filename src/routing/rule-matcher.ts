import { RULE_TYPES } from "../shared/constants.ts";
import type { RoutingInfo, RoutingRule } from "./rule-types.ts";

const getCaptureMatcherResults = (
  rule: RoutingRule,
  info: RoutingInfo,
): RegExpMatchArray[] | null => {
  const declaration = rule.find((clause) => clause.type === RULE_TYPES.CAPTURE);
  if (!declaration) return null;
  const names = (declaration.value as string).split(",").map((name) => name.trim().toLowerCase());
  const captured: RegExpMatchArray[] = [];
  for (const name of names) {
    const clause = rule.find((item) => item.type === RULE_TYPES.MATCHER && item.name === name);
    const result = clause?.matcher?.(info, info);
    if (result) captured.push(result);
  }
  return captured.length === names.length ? captured : null;
};

const flattenCaptureGroups = (matches: RegExpMatchArray[]): (string | undefined)[] => [
  matches[0]?.[0],
  ...matches.flatMap((match) => match.slice(1)),
];

export const getCaptureMatches = (
  rule: RoutingRule,
  info: RoutingInfo,
): (string | undefined)[] | null => {
  const matches = getCaptureMatcherResults(rule, info);
  const declaration = rule.find((clause) => clause.type === RULE_TYPES.CAPTURE);
  return matches
    ? declaration?.name === "capturegroups"
      ? flattenCaptureGroups(matches)
      : matches.flat()
    : null;
};

export const matchRule = (rule: RoutingRule, info: RoutingInfo): string | false => {
  const matches = rule
    .filter((clause) => clause.type === RULE_TYPES.MATCHER)
    .map((clause) => clause.matcher?.(info, info));
  if (matches.some((match) => !match)) return false;
  let destination = rule.find((clause) => clause.name === "into")!.value as string;
  const captured = getCaptureMatches(rule, info);
  if (captured) {
    destination = destination.replace(
      /:\$(\d+):/g,
      (_token, index: string) => captured[Number(index)] ?? "",
    );
  }
  return destination;
};

export const matchRules = (rules: RoutingRule[], info: RoutingInfo): string | null => {
  for (const rule of rules) {
    const result = matchRule(rule, info);
    if (result) return result;
  }
  return null;
};

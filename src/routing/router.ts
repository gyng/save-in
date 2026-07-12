import { RULE_TYPES } from "../shared/constants.ts";
import { EXTENSION_REGEX, getFilenameFromUrl } from "./filename.ts";
import { getFilenameDiagnostics, Path } from "./path.ts";
import { parseRulesCollecting } from "./rule-parser.ts";
import type { RoutingInfo, RoutingRule } from "./rule-types.ts";
import { routingPorts } from "./ports.ts";

export type * from "./rule-types.ts";
export { matcherFunctions } from "./matchers.ts";
export { parseRule, parseRulesCollecting, tokenizeLines } from "./rule-parser.ts";

export const parseRules = (raw: string): RoutingRule[] => {
  const { rules, errors } = parseRulesCollecting(raw);
  routingPorts.recordRuleErrors(errors);
  if (routingPorts.isDebug()) routingPorts.logDebug("parsedRules", rules);
  return rules;
};

export const getCaptureMatches = (
  rule: RoutingRule,
  info: RoutingInfo,
): (string | undefined)[] | null => {
  const declaration = rule.find(
    (clause) => clause.type === RULE_TYPES.CAPTURE && clause.name === "capture",
  );
  if (!declaration) return null;
  const names = (declaration.value as string).split(",").map((name) => name.trim());
  const captured: RegExpMatchArray[] = [];
  for (const name of names) {
    const clause = rule.find((item) => item.type === RULE_TYPES.MATCHER && item.name === name);
    const result = clause?.matcher?.(info);
    if (result) captured.push(result);
  }
  return captured.length === names.length ? captured.flat() : null;
};

export const matchRule = (rule: RoutingRule, info: RoutingInfo): string | false => {
  const matches = rule
    .filter((clause) => clause.type === RULE_TYPES.MATCHER)
    .map((clause) => clause.matcher?.(info, info));
  if (matches.some((match) => !match)) return false;
  let destination = rule.find((clause) => clause.name === "into")!.value as string;
  const captured = getCaptureMatches(rule, info);
  if (captured)
    for (let index = 0; index < captured.length; index += 1)
      destination = destination.split(`:$${index}:`).join(captured[index] ?? "");
  return destination;
};

export const matchRules = (rules: RoutingRule[], info: RoutingInfo): string | null => {
  for (const rule of rules) {
    const result = matchRule(rule, info);
    if (result) return result;
  }
  return null;
};

export type RuleTrace = {
  initialFilename?: string;
  actualFilename?: string;
  selectedRule: number | null;
  destination: string | null;
  expandedDestination: string | null;
  sanitizedDestination: string | null;
  finalPath: string | null;
  filenameDiagnostics: ReturnType<typeof getFilenameDiagnostics> | null;
  rules: Array<{
    index: number;
    matched: boolean;
    destination: string;
    clauses: Array<{ name: string; pattern: string; matched: boolean }>;
  }>;
};

export const traceRules = (rules: RoutingRule[], info: RoutingInfo): RuleTrace => {
  const traced = rules.map((rule, index) => {
    const clauses = rule
      .filter((clause) => clause.type === RULE_TYPES.MATCHER)
      .map((clause) => ({
        name: clause.name,
        pattern: String(clause.value),
        matched: Boolean(clause.matcher?.(info, info)),
      }));
    const destination = rule.find((clause) => clause.type === RULE_TYPES.DESTINATION)!
      .value as string;
    return {
      index: index + 1,
      matched: clauses.every((clause) => clause.matched),
      destination,
      clauses,
    };
  });
  const selectedIndex = traced.findIndex((rule) => rule.matched);
  const selectedRule = selectedIndex >= 0 ? selectedIndex + 1 : null;
  const destination = selectedIndex >= 0 ? matchRule(rules[selectedIndex], info) || null : null;
  const actualFilename = info.filename || "";
  const naiveFilename = getFilenameFromUrl(info.url || info.srcUrl || info.linkUrl || "");
  const expandedDestination = destination
    ?.replaceAll(":filename:", actualFilename)
    .replaceAll(":fileext:", actualFilename.match(EXTENSION_REGEX)?.[1] || "")
    .replaceAll(":actualfileext:", actualFilename.match(EXTENSION_REGEX)?.[1] || "")
    .replaceAll(":naivefilename:", naiveFilename)
    .replaceAll(":naivefileext:", naiveFilename.match(EXTENSION_REGEX)?.[1] || "")
    .replaceAll(":urlfileext:", naiveFilename.match(EXTENSION_REGEX)?.[1] || "");
  const sanitizedDestination = expandedDestination
    ? new Path(expandedDestination).finalize()
    : null;
  return {
    initialFilename: info.initialFilename,
    actualFilename: info.filename,
    selectedRule,
    destination,
    expandedDestination: expandedDestination || null,
    sanitizedDestination,
    finalPath: sanitizedDestination,
    filenameDiagnostics: actualFilename ? getFilenameDiagnostics(actualFilename) : null,
    rules: traced,
  };
};

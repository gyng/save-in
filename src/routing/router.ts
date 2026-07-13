import { RULE_TYPES } from "../shared/constants.ts";
import { options } from "../config/options-data.ts";
import { getFilenameDiagnostics, Path } from "./path.ts";
import { parseRulesCollecting } from "./rule-parser.ts";
import type { RoutingDownloadInfo, RoutingInfo, RoutingRule } from "./rule-types.ts";
import { routingPorts } from "./ports.ts";
import { applyVariables } from "./variable.ts";

export type * from "./rule-types.ts";
export { matcherFunctions } from "./matchers.ts";
export { parseRule, parseRulesCollecting, tokenizeLines } from "./rule-parser.ts";

export const parseRules = (raw: string): RoutingRule[] => {
  const { rules, errors } = parseRulesCollecting(raw);
  routingPorts.recordRuleErrors(errors);
  if (routingPorts.isDebug()) routingPorts.logDebug("parsedRules", rules);
  return rules;
};

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
  initialFilename?: string | undefined;
  actualFilename?: string | undefined;
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

export const traceRules = async (rules: RoutingRule[], info: RoutingInfo): Promise<RuleTrace> => {
  const matchedDestinations = rules.map((rule) => matchRule(rule, info));
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
      matched: Boolean(matchedDestinations[index]),
      destination,
      clauses,
    };
  });
  const selectedIndex = matchedDestinations.findIndex((destination) => Boolean(destination));
  const selectedRule = selectedIndex >= 0 ? selectedIndex + 1 : null;
  const matchedDestination = selectedIndex >= 0 ? matchedDestinations[selectedIndex] : false;
  const destination = matchedDestination || null;
  const actualFilename = info.filename || "";
  const sourceUrl = info.sourceUrl || info.srcUrl;
  const downloadUrl = info.url || sourceUrl || info.linkUrl || info.pageUrl;
  const traceInfo: RoutingDownloadInfo = {
    ...(info as RoutingDownloadInfo),
    url: downloadUrl,
    sourceUrl,
    now: info.now instanceof Date ? info.now : new Date(),
    preview: true,
  };
  const expandedPath = destination ? await applyVariables(new Path(destination), traceInfo) : null;
  const expandedDestination = expandedPath?.toString() ?? null;
  const sanitizedDestination =
    expandedPath?.finalize({ finalComponentIsFilename: !/\/\s*$/.test(destination || "") }) ?? null;
  return {
    initialFilename: info.initialFilename,
    actualFilename: info.filename,
    selectedRule,
    destination,
    expandedDestination: expandedDestination || null,
    sanitizedDestination,
    finalPath: sanitizedDestination,
    filenameDiagnostics: actualFilename
      ? getFilenameDiagnostics(actualFilename, options.truncateLength)
      : null,
    rules: traced,
  };
};

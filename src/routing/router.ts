import { RULE_TYPES } from "../shared/constants.ts";
import { options } from "../config/options-data.ts";
import { getFilenameDiagnostics, Path } from "./path.ts";
import { parseRulesCollecting } from "./rule-parser.ts";
import { matchRule } from "./rule-matcher.ts";
import type { RoutingDownloadInfo, RoutingInfo, RoutingRule } from "./rule-types.ts";
import { routingPorts } from "./ports.ts";
import { applyVariables } from "./variable.ts";

export type * from "./rule-types.ts";
export { matcherFunctions } from "./matchers.ts";
export { getCaptureMatches, matchRule, matchRules } from "./rule-matcher.ts";
export { parseRule, parseRulesCollecting, tokenizeLines } from "./rule-parser.ts";
export {
  parseRoutingRuleAst,
  parseRoutingRuleSyntax,
  ROUTING_RULE_GRAMMAR,
  validateRoutingRuleSyntax,
} from "./rule-syntax.ts";
export type {
  ParsedRoutingAst,
  RoutingClauseNode,
  RoutingDocumentNode,
  RoutingRuleNode,
} from "./rule-syntax.ts";

export const parseRules = (raw: string): RoutingRule[] => {
  const { rules, errors } = parseRulesCollecting(raw);
  routingPorts.recordRuleErrors(errors);
  if (routingPorts.isDebug()) routingPorts.logDebug("parsedRules", rules);
  return rules;
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
        matched: Boolean(clause.matcher(info, info)),
      }));
    const destination = rule.find((clause) => clause.type === RULE_TYPES.DESTINATION)?.value ?? "";
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

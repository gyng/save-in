import { RULE_TYPES } from "../shared/constants.ts";
import { options } from "../config/options-data.ts";
import { getFilenameDiagnostics, Path, ROUTES_TO_FOLDER_REGEX } from "./path.ts";
import { parseRulesCollecting } from "./rule-parser.ts";
import { evaluateRule } from "./rule-matcher.ts";
import type {
  MatcherAttempt,
  RoutingDownloadInfo,
  RoutingInfo,
  RoutingRule,
} from "./rule-types.ts";
import { routingPorts } from "./ports.ts";
import { expandFetchUrl, isUsableFetchRewrite } from "./fetch-url.ts";
import { deriveUrlFilenames } from "./filename.ts";
import { applyVariables } from "./variable.ts";
import { applyRenameTransform, expandRenameTransform, type RenameTransform } from "./rename.ts";
import { isStringKeyedRecord } from "../shared/util.ts";

export type * from "./rule-types.ts";
export { matcherFunctions } from "./matchers.ts";
export {
  evaluateRule,
  findFetchClause,
  findRenameClause,
  getCaptureMatches,
  isRenameOnlyEligibleMatch,
  isRenameOnlyEligibleRule,
  matchRule,
  matchRules,
  matchRulesDetailed,
  type RuleMatch,
} from "./rule-matcher.ts";
export {
  applyRenameTransform,
  expandRenameTransform,
  isRenameTransform,
  RENAME_SEPARATOR,
  splitRenameValue,
  type RenameTransform,
} from "./rename.ts";
export { parseRulesCollecting } from "./rule-parser.ts";
export {
  parseRoutingRuleAst,
  ROUTING_RULE_GRAMMAR,
  serializeRoutingDocument,
  validateRoutingRuleSyntax,
} from "./rule-syntax.ts";
export type {
  ParsedRoutingAst,
  RoutingClauseCst,
  RoutingClauseNode,
  RoutingDocumentNode,
  RoutingInvalidCst,
  RoutingLineEnvelopeCst,
  RoutingRuleNode,
  RoutingTriviaCst,
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
  // Capture-substituted fetch template of the winning rule, then the fully
  // expanded URL it rewrites the download to. Destination expansion below
  // runs against the rewritten URL so the preview matches the pipeline.
  selectedFetchTemplate: string | null;
  rewrittenUrl: string | null;
  // Capture-substituted rename transform of the winning rule and the final
  // filename component before/after it applied, mirroring the pipeline seam
  // (after expansion and disposition resolution, before sanitization).
  selectedRename: RenameTransform | null;
  renamedFrom: string | null;
  renamedTo: string | null;
  destination: string | null;
  expandedDestination: string | null;
  sanitizedDestination: string | null;
  finalPath: string | null;
  filenameDiagnostics: ReturnType<typeof getFilenameDiagnostics> | null;
  rules: Array<{
    index: number;
    matched: boolean;
    destination: string;
    fetch: string;
    rename: string;
    clauses: Array<{
      name: string;
      pattern: string;
      matched: boolean;
      attempts: MatcherAttempt[];
    }>;
  }>;
};

const normalizeTraceCurrentTab = (value: unknown): RoutingDownloadInfo["currentTab"] => {
  if (value === null) return null;
  if (!isStringKeyedRecord(value)) return undefined;
  return {
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(typeof value.incognito === "boolean" ? { incognito: value.incognito } : {}),
  };
};

export const traceRules = async (
  rules: RoutingRule[],
  info: RoutingInfo,
  isEligible: (rule: RoutingRule) => boolean = () => true,
): Promise<RuleTrace> => {
  const eligibility = rules.map(isEligible);
  const evaluations = rules.map((rule, index) =>
    eligibility[index]
      ? evaluateRule(rule, info)
      : { destination: false as const, fetch: false as const, rename: false as const, clauses: [] },
  );
  const matchedDestinations = evaluations.map(({ destination }) => destination);
  const traced = rules.map((rule, index) => {
    const evaluation = evaluations[index] as (typeof evaluations)[number];
    const clauses = rule
      .filter((clause) => clause.type === RULE_TYPES.MATCHER)
      .map((clause) => {
        const evaluated = evaluation.clauses.find((item) => item.clause === clause);
        return {
          name: clause.name,
          pattern: String(clause.value),
          matched: eligibility[index] ? Boolean(evaluated?.result) : false,
          attempts: evaluated?.attempts ?? [],
        };
      });
    const destination = rule.find((clause) => clause.type === RULE_TYPES.DESTINATION)?.value ?? "";
    const fetch = rule.find((clause) => clause.type === RULE_TYPES.FETCH)?.value ?? "";
    const rename = rule.find((clause) => clause.type === RULE_TYPES.RENAME)?.value ?? "";
    return {
      index: index + 1,
      matched: Boolean(matchedDestinations[index]),
      destination,
      fetch,
      rename,
      clauses,
    };
  });
  const selectedIndex = matchedDestinations.findIndex((destination) => Boolean(destination));
  const selectedRule = selectedIndex >= 0 ? selectedIndex + 1 : null;
  const matchedDestination = selectedIndex >= 0 ? matchedDestinations[selectedIndex] : false;
  const destination = matchedDestination || null;
  const selectedEvaluation = selectedIndex >= 0 ? evaluations[selectedIndex] : undefined;
  const selectedFetchTemplate = selectedEvaluation ? selectedEvaluation.fetch || null : null;
  const actualFilename = info.filename || "";
  const sourceUrl = info.sourceUrl || info.srcUrl;
  const downloadUrl = info.url || sourceUrl || info.linkUrl || info.pageUrl;
  const traceInfo: RoutingDownloadInfo = {
    ...info,
    currentTab: normalizeTraceCurrentTab(info.currentTab),
    url: downloadUrl,
    sourceUrl,
    now: info.now instanceof Date ? info.now : new Date(),
    preview: true,
  };
  const expandedFetchUrl = selectedFetchTemplate
    ? await expandFetchUrl(selectedFetchTemplate, traceInfo)
    : null;
  // Mirror the pipeline exactly: an unusable expansion drops the rewrite, and
  // a usable one retargets both the URL and the URL-derived names before the
  // destination expands (applyFetchRewrite does the same for real downloads).
  const rewrittenUrl =
    expandedFetchUrl !== null && isUsableFetchRewrite(expandedFetchUrl) ? expandedFetchUrl : null;
  const fetchRewriteFailed = selectedFetchTemplate !== null && rewrittenUrl === null;
  let destinationInfo = traceInfo;
  if (rewrittenUrl) {
    const { naiveFilename, initialFilename } = deriveUrlFilenames(
      rewrittenUrl,
      info.suggestedFilename,
    );
    destinationInfo = {
      ...traceInfo,
      url: rewrittenUrl,
      naiveFilename,
      filename: initialFilename,
      initialFilename,
    };
  }
  const expandedPath =
    destination && !fetchRewriteFailed
      ? await applyVariables(new Path(destination), destinationInfo)
      : null;
  const expandedDestination = expandedPath?.toString() ?? null;
  const finalComponentIsFilename =
    typeof destination === "string" && !ROUTES_TO_FOLDER_REGEX.test(destination);
  const selectedRename = selectedEvaluation ? selectedEvaluation.rename || null : null;
  const expandedRename =
    selectedRename && !fetchRewriteFailed
      ? await expandRenameTransform(selectedRename, destinationInfo)
      : null;
  let renamedFrom: string | null = null;
  let renamedTo: string | null = null;
  const transformFinalComponent = expandedRename
    ? (value: string): string => {
        renamedFrom = value;
        renamedTo = applyRenameTransform(value, expandedRename);
        return renamedTo;
      }
    : undefined;
  const sanitizedDestination =
    expandedPath?.finalize({
      finalComponentIsFilename,
      ...(transformFinalComponent && finalComponentIsFilename ? { transformFinalComponent } : {}),
    }) ?? null;
  // A folder-only destination keeps the download's own resolved name, so the
  // rename applies to that name instead of a route component (§finalizeFullPath).
  if (expandedRename && destination && !finalComponentIsFilename) {
    renamedFrom = destinationInfo.filename ?? "";
    renamedTo = applyRenameTransform(renamedFrom, expandedRename);
  }
  return {
    initialFilename: info.initialFilename,
    actualFilename: info.filename,
    selectedRule,
    selectedFetchTemplate,
    rewrittenUrl,
    selectedRename,
    renamedFrom,
    renamedTo,
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

import { evaluateRule } from "../routing/rule-matcher.ts";
import { parseRoutingRuleAst } from "../routing/rule-syntax.ts";
import type { RenameTransform } from "../routing/rename.ts";
import type { RoutingInfo, RoutingRule } from "../routing/rule-types.ts";
import {
  AUTOMATIC_CONTEXT,
  automaticRuleClauseIssues,
  isAutomaticRuleClauses,
  type AutomaticRuleIssue,
} from "../routing/automatic-rule.ts";
import type { PageSourceChannel, PageSourceKind } from "../shared/page-source.ts";
import { isDataUrl, parseDataUrlMediaType } from "../shared/data-url.ts";

export type AutomaticRoutingCandidate = {
  pageUrl: string;
  sourceUrl: string;
  sourceKind: PageSourceKind;
  // Absent for media embedded directly on the page — the pre-4.2 default,
  // always admitted. Present for anchor/background/resource-hint candidates so
  // the content scan and the background backstop gate the same way (see
  // isAdmittedAutomaticSource below). Not part of the rule-matching vocabulary:
  // sourcekind: alone still selects the destination.
  sourceChannel?: PageSourceChannel | undefined;
  matchedCssSelectorsByOrigin?: string[][] | undefined;
};

// The three phase-B content options, plus the phase-A link option, expressed
// as a plain gate record so the content scan and the background backstop
// (background/messaging/auto-download.ts) can share one admission rule
// instead of drifting out of sync.
export type AutomaticScanGates = {
  includeLinks: boolean;
  includeDocuments: boolean;
  includeBackgrounds: boolean;
  resourceHints: boolean;
};

// Per-channel x kind admission for the automatic scan. A candidate with no
// channel is embedded media (img/video/audio) and is always admitted — that
// is the scan's pre-4.1 baseline behavior. Every other channel needs its own
// content option on, and a channel's option only admits the kinds that
// channel can actually produce: an anchor-classified stream/document needs
// includeDocuments; a resource-hint stream needs resourceHints even though
// both carry sourceKind "stream". A plain-link anchor (kind "link") is never
// admitted, by design.
export const isAdmittedAutomaticSource = (
  kind: PageSourceKind,
  channel: PageSourceChannel | undefined,
  gates: AutomaticScanGates,
): boolean => {
  if (channel === "background") return gates.includeBackgrounds && kind === "image";
  if (channel === "resource-hint") return gates.resourceHints && kind === "stream";
  if (channel === "anchor") {
    if (kind === "image" || kind === "video" || kind === "audio") return gates.includeLinks;
    if (kind === "stream" || kind === "document") return gates.includeDocuments;
    return false;
  }
  return kind === "image" || kind === "video" || kind === "audio";
};

export type AutomaticRoutingMatch = {
  rule: RoutingRule;
  destination: string;
  fetch: string | null;
  rename: RenameTransform | null;
};

export const isEligibleAutomaticRoutingRule = (rule: RoutingRule): boolean =>
  isAutomaticRuleClauses(rule) && automaticRuleClauseIssues(rule).length === 0;

const candidateInfo = (candidate: AutomaticRoutingCandidate): RoutingInfo => ({
  context: AUTOMATIC_CONTEXT,
  mediaType: candidate.sourceKind,
  pageUrl: candidate.pageUrl,
  sourceKind: candidate.sourceKind,
  sourceUrl: candidate.sourceUrl,
  matchedCssSelectorsByOrigin: candidate.matchedCssSelectorsByOrigin,
  url: candidate.sourceUrl,
  // A data: URL has no path (fileext:/urlfileext: are empty), so mime-based
  // matching and :mimeext: naming rely on the mediatype parsed from its header.
  // Deriving it from the URL itself keeps the content pre-match and the
  // background re-match agreeing, and — because info.mime is set — no HTTP-only
  // HEAD fetch is needed to resolve it (resolveMime short-circuits on mime).
  ...(isDataUrl(candidate.sourceUrl) ? { mime: parseDataUrlMediaType(candidate.sourceUrl) } : {}),
});

export const matchAutomaticRoutingRule = (
  rules: readonly RoutingRule[],
  candidate: AutomaticRoutingCandidate,
): AutomaticRoutingMatch | null => {
  const info = candidateInfo(candidate);
  for (const rule of rules) {
    if (!isEligibleAutomaticRoutingRule(rule)) continue;
    const evaluation = evaluateRule(rule, info);
    if (evaluation.destination) {
      return {
        rule,
        destination: evaluation.destination,
        fetch: evaluation.fetch || null,
        rename: evaluation.rename || null,
      };
    }
  }
  return null;
};

export const automaticRoutingRuleIssues = (source: string): AutomaticRuleIssue[] => {
  const parsed = parseRoutingRuleAst(source);
  return [...new Set(parsed.ast.rules.flatMap((rule) => automaticRuleClauseIssues(rule.clauses)))];
};

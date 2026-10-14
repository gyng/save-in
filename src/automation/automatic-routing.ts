import { matchRulesDetailed, type RuleMatch } from "../routing/rule-matcher.ts";
import { parseRoutingRuleAst } from "../routing/rule-syntax.ts";
import type { RoutingInfo, RoutingRule } from "../routing/rule-types.ts";
import {
  AUTOMATIC_CONTEXT,
  automaticRuleClauseIssues,
  isAutomaticRuleClauses,
  type AutomaticRuleIssue,
} from "../routing/automatic-rule.ts";
import {
  classifyUrlKind,
  type PageSourceChannel,
  type PageSourceKind,
} from "../shared/page-source.ts";
import { isDataUrl, isDataUrlWithinCap, parseDataUrlMediaType } from "../shared/data-url.ts";
import { RULE_TYPES } from "../shared/constants.ts";

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
  // The tab that declared the source. The background re-match sets it so this
  // match is evaluated against that tab — and, because routing suppresses debug
  // logging for a private tab, so a private automatic save does not print its
  // page and source URLs. The content pre-match leaves it absent, because this
  // candidate is the message payload and cannot carry a tab. That does not
  // leave the scan blind to the title: it reaches pagetitle: through the
  // routing port content/ports.ts configures, which answers with this page —
  // in a content script, this page is the tab.
  currentTab?: RoutingInfo["currentTab"];
};

// The phase-A link gate, phase-B channel gates, and phase-C data: protocol gate
// expressed as one record so the content scan and background backstop
// (background/messaging/auto-download.ts) cannot drift apart.
export type AutomaticScanGates = {
  includeLinks: boolean;
  includeDocuments: boolean;
  includeBackgrounds: boolean;
  resourceHints: boolean;
  includeDataUrls: boolean;
  includeScriptMedia: boolean;
};

export const normalizeAutomaticSourceUrl = (
  value: string,
  gates: Pick<AutomaticScanGates, "includeDataUrls">,
): string | null => {
  // The raw data: string is the URL. URL() would treat a trailing # as a
  // fragment and change the self-contained payload.
  if (isDataUrl(value)) {
    return gates.includeDataUrls && isDataUrlWithinCap(value) ? value : null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
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
  // Absence is the only always-admitted shape: a channel value this build does
  // not recognize (a newer content script, a tampered message) must not ride
  // the embedded-media branch, because no gate the user controls covers it.
  if (channel === undefined) return kind === "image" || kind === "video" || kind === "audio";
  if (channel === "background") return gates.includeBackgrounds && kind === "image";
  if (channel === "resource-hint") return gates.resourceHints && kind === "stream";
  // The collector only ever hands over recognized media; a plain link has no
  // whole-file meaning and is refused here even if a message claims one.
  if (channel === "script-media") return gates.includeScriptMedia && kind !== "link";
  if (channel === "anchor") {
    if (kind === "image" || kind === "video" || kind === "audio") return gates.includeLinks;
    if (kind === "stream" || kind === "document") return gates.includeDocuments;
  }
  return false;
};

// Which network-observed media may become an automatic candidate at all. The
// collector buffers everything it recognizes for the Page Sources panel, but an
// unattended save must never adopt a fragment of a stream: HLS/DASH players fetch
// segments with fetch/XHR, often under .mp4/.m4a/.webm names, and a browser
// playing HLS natively issues media-element requests for every segment. So:
// - stream manifests, images, and documents are whole files however they were
//   fetched (an XHR-fetched PDF or image is still the complete resource);
// - video/audio count only when a media element or <object>/<embed> requested
//   the URL itself, the URL's own extension names that kind (the collector's
//   extensionless media-element fallback could be a .ts segment), and the tab
//   shows no sign of a stream (a manifest, or a media element loading a URL
//   that names no media type, as a natively played extensionless playlist
//   does), after which its media requests are presumed to be that stream's
//   segments.
export const isWholeFileScriptMediaRequest = (request: {
  url: string;
  kind: PageSourceKind;
  requestType: string;
  tabHasStream: boolean;
}): boolean => {
  const { url, kind, requestType, tabHasStream } = request;
  if (kind === "stream" || kind === "image" || kind === "document") return true;
  if (kind !== "video" && kind !== "audio") return false;
  return (
    (requestType === "media" || requestType === "object") &&
    classifyUrlKind(url) === kind &&
    !tabHasStream
  );
};

// The page visit a script-media entry must belong to before an automatic save
// may adopt it. A tab's collector buffer outlives the documents it shows: the
// old document keeps issuing requests after the next navigation has reset the
// buffer and until the new one commits, and a back/forward-cache restore sends
// no navigation request at all, so the buffer still holds the other page's
// traffic. `documentId` is the browser-supplied identity of the requesting
// top-level document (MessageSender.documentId; Chrome, and Firefox releases
// that implement it). `start` is the wall-clock time the visit began as the
// content script measured it: the navigation's response start, or the moment
// a cached page was restored.
export type ScriptMediaVisit = { documentId?: string | undefined; start: number };

// When both the request and the visit carry a document identity, it decides:
// the browser attributed the request to that document, which no clock reading
// can contradict. Otherwise (Firefox before documentId, a Firefox worker
// request, a request from a frame nested below the first level) the entry must
// have been observed no earlier than the visit started.
export const isScriptMediaFromVisit = (
  entry: { at: number; doc?: string | undefined },
  visit: ScriptMediaVisit,
): boolean =>
  entry.doc !== undefined && visit.documentId !== undefined
    ? entry.doc === visit.documentId
    : entry.at >= visit.start;

export type AutomaticRoutingMatch = RuleMatch;

export const isEligibleAutomaticRoutingRule = (rule: RoutingRule): boolean =>
  isAutomaticRuleClauses(rule) && automaticRuleClauseIssues(rule).length === 0;

// Matchers that read the source URL itself, so capturing one on a data:
// candidate would carry page-controlled payload into $1 and out through the
// destination. This is the same payload DATA_PAYLOAD_OUTPUT_VARIABLE below
// blocks, named as matchers rather than variables: the two lists describe one
// boundary and have to grow together. `capture:` resolves against the full
// matcher set, not the narrower automatic-source vocabulary.
const DATA_PAYLOAD_CAPTURE_MATCHERS = new Set([
  "fileext",
  "naivefilename",
  "sourceurl",
  "urlfileext",
]);

const hasDataPayloadCapture = (rule: RoutingRule): boolean => {
  const capture = rule.find((clause) => clause.type === RULE_TYPES.CAPTURE);
  if (!capture) return false;
  return capture.value
    .split(",")
    .some((name) => DATA_PAYLOAD_CAPTURE_MATCHERS.has(name.trim().toLowerCase()));
};

const DATA_PAYLOAD_OUTPUT_VARIABLE =
  /:(?:sourceurl|sourcepath|naivefilename|naivefileext|urlfileext|finalurl|redirecturl):/;

const hasDataPayloadOutput = (rule: RoutingRule): boolean =>
  rule.some(
    (clause) =>
      (clause.type === RULE_TYPES.DESTINATION && DATA_PAYLOAD_OUTPUT_VARIABLE.test(clause.value)) ||
      (clause.type === RULE_TYPES.RENAME &&
        DATA_PAYLOAD_OUTPUT_VARIABLE.test(clause.replacement)) ||
      (clause.type === RULE_TYPES.FETCH && DATA_PAYLOAD_OUTPUT_VARIABLE.test(clause.value)),
  );

export const isEligibleAutomaticRoutingRuleForCandidate = (
  rule: RoutingRule,
  candidate: AutomaticRoutingCandidate,
): boolean =>
  isEligibleAutomaticRoutingRule(rule) &&
  (!isDataUrl(candidate.sourceUrl) ||
    (!hasDataPayloadCapture(rule) && !hasDataPayloadOutput(rule)));

const candidateInfo = (candidate: AutomaticRoutingCandidate): RoutingInfo => ({
  context: AUTOMATIC_CONTEXT,
  mediaType: candidate.sourceKind,
  // Only when the caller supplied it: the key's presence switches title
  // matching from the last focused tab to this one.
  ...(candidate.currentTab !== undefined ? { currentTab: candidate.currentTab } : {}),
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
): AutomaticRoutingMatch | null =>
  matchRulesDetailed(rules, candidateInfo(candidate), (rule) =>
    isEligibleAutomaticRoutingRuleForCandidate(rule, candidate),
  );

export const automaticRoutingRuleIssues = (source: string): AutomaticRuleIssue[] => {
  const parsed = parseRoutingRuleAst(source);
  return [...new Set(parsed.ast.rules.flatMap((rule) => automaticRuleClauseIssues(rule.clauses)))];
};

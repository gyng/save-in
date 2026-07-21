import {
  PAGE_SOURCE_CHANNELS,
  PAGE_SOURCE_KINDS,
  isPageSourceKind,
  type PageSourceKind,
} from "../../shared/page-source.ts";
import { BROWSER_DOWNLOAD_CONTEXT, DOWNLOAD_TYPES, SPECIAL_DIRS } from "../../shared/constants.ts";
import { isDataUrl } from "../../shared/data-url.ts";
import { normalizeAutomaticSourceUrl } from "../../automation/automatic-routing.ts";
import { isAutomaticRuleClauses } from "../../routing/automatic-rule.ts";
import {
  isAdmittedAutomaticSource,
  type AutomaticScanGates,
} from "../../automation/automatic-routing.ts";
import { splitRenameValue } from "../../routing/rename.ts";

// Raw clause shape shared by the Visual editor's syntax nodes and parsed
// rules; reachability only reads names, pattern text, and flags.
export type ReachabilityClause = {
  name: string;
  value: string | RegExp;
  flags?: string | undefined;
};

export type ReachabilityOptions = {
  autoDownloadEnabled: boolean;
  autoDownloadLinks: boolean;
  autoDownloadDocuments: boolean;
  autoDownloadBackgrounds: boolean;
  autoDownloadManifests: boolean;
  autoDownloadDataUrls: boolean;
};

// Option names double as their _locales label keys, so surfaces can render
// the exact checkbox label the user must turn on.
const CHANNEL_OPTION_IDS = [
  "autoDownloadLinks",
  "autoDownloadDocuments",
  "autoDownloadBackgrounds",
  "autoDownloadManifests",
] as const;
export type ReachabilityUnlockOption = (typeof CHANNEL_OPTION_IDS)[number];

export const REACHABILITY_OPTION_IDS = [
  "autoDownloadEnabled",
  "autoDownloadLinks",
  "autoDownloadDocuments",
  "autoDownloadBackgrounds",
  "autoDownloadManifests",
  "autoDownloadDataUrls",
] as const;

// Rule-card diagnostics never consult the data: gate (the admission probe
// filters channel options only), so the Visual editor subscribes to these
// five and never re-renders every card for an autoDownloadDataUrls toggle.
export const RULE_REACHABILITY_OPTION_IDS = REACHABILITY_OPTION_IDS.filter(
  (id) => id !== "autoDownloadDataUrls",
);

// Surfaces inject their own control reader so this model stays DOM-free.
export const readReachabilityOptions = (
  checked: (id: (typeof REACHABILITY_OPTION_IDS)[number]) => boolean,
): ReachabilityOptions => ({
  autoDownloadEnabled: checked("autoDownloadEnabled"),
  autoDownloadLinks: checked("autoDownloadLinks"),
  autoDownloadDocuments: checked("autoDownloadDocuments"),
  autoDownloadBackgrounds: checked("autoDownloadBackgrounds"),
  autoDownloadManifests: checked("autoDownloadManifests"),
  autoDownloadDataUrls: checked("autoDownloadDataUrls"),
});

export type RuleReachabilityDiagnostic =
  | { kind: "automatic-saves-off"; level: "info" }
  | { kind: "no-kinds"; level: "warning" }
  | { kind: "link-only"; level: "warning" }
  | {
      kind: "unreachable-kinds";
      level: "warning";
      unlockOptions: [ReachabilityUnlockOption, ...ReachabilityUnlockOption[]];
    }
  | { kind: "empty-variable"; level: "warning"; variable: string };

const KIND_MATCHER_NAMES = new Set(["sourcekind", "mediatype"]);

const compileClausePattern = (clause: ReachabilityClause): RegExp | null => {
  try {
    return clause.value instanceof RegExp
      ? new RegExp(clause.value.source, clause.value.flags)
      : new RegExp(clause.value, clause.flags);
  } catch {
    // The validator already reports invalid patterns; an uncompilable kind
    // clause must not double-report, so it constrains nothing here.
    return null;
  }
};

const testPattern = (regex: RegExp, value: string): boolean => {
  // A global or sticky flag would make test() stateful across values.
  regex.lastIndex = 0;
  return regex.test(value);
};

const scanGates = (options: ReachabilityOptions): AutomaticScanGates => ({
  includeLinks: options.autoDownloadLinks,
  includeDocuments: options.autoDownloadDocuments,
  includeBackgrounds: options.autoDownloadBackgrounds,
  resourceHints: options.autoDownloadManifests,
  includeDataUrls: options.autoDownloadDataUrls,
});

// Every discovery path a candidate can arrive through: the three gated
// channels plus channel-absent embedded media.
const DISCOVERY_CHANNELS = [...PAGE_SOURCE_CHANNELS, undefined] as const;

// The kinds the automatic scanner can produce under the given options,
// derived by probing the real admission gate so this model and the scan
// cannot drift apart.
export const producibleSourceKinds = (options: ReachabilityOptions): Set<PageSourceKind> => {
  const gates = scanGates(options);
  const kinds = new Set<PageSourceKind>();
  for (const kind of PAGE_SOURCE_KINDS) {
    if (DISCOVERY_CHANNELS.some((channel) => isAdmittedAutomaticSource(kind, channel, gates))) {
      kinds.add(kind);
    }
  }
  return kinds;
};

// The channel options that would each, on their own, make one of the kinds
// producible. Empty exactly when no channel ever supplies them (plain links).
const unlockOptionsFor = (
  kinds: ReadonlySet<PageSourceKind>,
  options: ReachabilityOptions,
): ReachabilityUnlockOption[] =>
  CHANNEL_OPTION_IDS.filter((id) => {
    if (options[id]) return false;
    const producible = producibleSourceKinds({ ...options, [id]: true });
    return [...kinds].some((kind) => producible.has(kind));
  });

// The vocabulary kinds the rule's kind matchers can accept. Every matcher
// clause must match, so multiple kind clauses intersect. Returns null when the
// rule carries no kind matcher (all six kinds pass).
export const matchableSourceKinds = (
  clauses: readonly ReachabilityClause[],
): Set<PageSourceKind> | null => {
  let matchable: Set<PageSourceKind> | null = null;
  for (const clause of clauses) {
    if (!KIND_MATCHER_NAMES.has(clause.name)) continue;
    const regex = compileClausePattern(clause);
    if (!regex) continue;
    const passing = new Set<PageSourceKind>();
    for (const kind of PAGE_SOURCE_KINDS) {
      if (testPattern(regex, kind)) passing.add(kind);
    }
    if (matchable === null) {
      matchable = passing;
    } else {
      const current: ReadonlySet<PageSourceKind> = matchable;
      matchable = new Set([...current].filter((kind) => passing.has(kind)));
    }
  }
  return matchable;
};

// The diagnostics claim a rule cannot run, which is only true when automatic
// discovery is its sole entry point. Context matching is normalized to
// lowercase and every context clause must match, so a rule such as
// `context: auto|click` still fires on interactive saves and must stay
// silent here — interactive saves are never gated by discovery options.
// Adopted ordinary browser downloads are a non-automatic entry point too:
// `context: auto|browser` rules keep routing them, so they are equally
// exempt (the round-two refutation held only for the kind warnings, not the
// master-switch note).
const NON_AUTOMATIC_CONTEXTS = [
  ...Object.values(DOWNLOAD_TYPES).filter((value) => value !== DOWNLOAD_TYPES.AUTO),
  BROWSER_DOWNLOAD_CONTEXT,
]
  // Locale-insensitive on purpose: the router lowercases contexts with
  // toLowerCase (routing/matchers.ts), and a Turkish/Azerbaijani host locale
  // would otherwise probe "clıck" and reintroduce mixed-context false hints.
  .map((value) => value.toLowerCase());

const firesOutsideAutomaticDiscovery = (clauses: readonly ReachabilityClause[]): boolean => {
  const contextClauses = clauses.filter((clause) => clause.name === "context");
  // Compile once per clause, not once per clause × probed context.
  const regexes = contextClauses.map((clause) => compileClausePattern(clause));
  return NON_AUTOMATIC_CONTEXTS.some((context) =>
    regexes.every((regex) => {
      // An uncompilable context clause is the validator's report; assume it
      // constrains nothing so the diagnostics stay conservative.
      if (!regex) return true;
      return testPattern(regex, context);
    }),
  );
};

// Variables interactive saves populate but the automatic candidate info never
// carries (automation/automatic-routing.ts candidateInfo): no menu, clicked
// link metadata, or selection exists during a page scan.
export const AUTOMATIC_EMPTY_VARIABLES = [
  SPECIAL_DIRS.MENU_PATH,
  SPECIAL_DIRS.LINK_TEXT,
  SPECIAL_DIRS.LINK_TITLE,
  SPECIAL_DIRS.LINK_DOWNLOAD,
  SPECIAL_DIRS.SELECTION_TEXT,
] as const;

// Only sides where variables expand count: into:/fetch: are whole templates,
// while a rename find pattern is a raw regex where ":menupath:" is literal
// text to match, not a template.
const expandingTemplateText = (clause: ReachabilityClause): string | null => {
  if (typeof clause.value !== "string") return null;
  if (clause.name === "into" || clause.name === "fetch") return clause.value;
  if (clause.name === "rename") return splitRenameValue(clause.value)?.replacement ?? null;
  return null;
};

const emptyVariablesUsed = (clauses: readonly ReachabilityClause[]): string[] =>
  AUTOMATIC_EMPTY_VARIABLES.filter((variable) =>
    clauses.some((clause) => {
      const template = expandingTemplateText(clause);
      return template !== null && template.includes(variable);
    }),
  );

// Conservative option-aware reachability for one EXCLUSIVELY automatic rule.
export const ruleReachabilityDiagnostics = (
  clauses: readonly ReachabilityClause[],
  options: ReachabilityOptions,
): RuleReachabilityDiagnostic[] => {
  if (!isAutomaticRuleClauses(clauses) || firesOutsideAutomaticDiscovery(clauses)) return [];
  const diagnostics: RuleReachabilityDiagnostic[] = [];
  const matchable = matchableSourceKinds(clauses);
  let neverSavable = false;
  if (matchable !== null) {
    const producible = producibleSourceKinds(options);
    const reachable = [...matchable].some((kind) => producible.has(kind));
    if (matchable.size === 0) {
      neverSavable = true;
      diagnostics.push({ kind: "no-kinds", level: "warning" });
    } else if (!reachable) {
      const [firstUnlock, ...restUnlock] = unlockOptionsFor(matchable, options);
      if (firstUnlock === undefined) {
        // No channel option ever supplies the matched kinds: only plain
        // links have no discovery channel at all.
        neverSavable = true;
        diagnostics.push({ kind: "link-only", level: "warning" });
      } else {
        diagnostics.push({
          kind: "unreachable-kinds",
          level: "warning",
          unlockOptions: [firstUnlock, ...restUnlock],
        });
      }
    }
  }
  if (!options.autoDownloadEnabled && !neverSavable) {
    // The authoring flow deliberately drafts rules with the master switch
    // off, so this is information, not a warning — and it is withheld when
    // an adjacent warning already says the rule can never save (mirroring
    // the debugger: advice is pointless for a rule nothing can feed).
    diagnostics.unshift({ kind: "automatic-saves-off", level: "info" });
  }
  for (const variable of emptyVariablesUsed(clauses)) {
    diagnostics.push({ kind: "empty-variable", level: "warning", variable });
  }
  return diagnostics;
};

// Debugger variant: gates on the debugged INPUT rather than any rule. A
// candidate whose kind the current options never discover (or a data: source
// with its gate off) would not reach automatic routing at all.
export type InputDiscoveryDiagnostics = {
  // Parity with the rule cards' information note: the input describes an
  // automatic save that the master switch currently parks.
  automaticSavesOff: boolean;
  // Plain links have no discovery channel; no option can help.
  neverAdopted: boolean;
  // Disjunctive alternatives — each on its own makes the kind discoverable.
  channelOptions: ReachabilityUnlockOption[];
  // Conjunctive with the channel alternatives: a data: source additionally
  // needs its protocol gate regardless of which channel finds it.
  requiresDataGate: boolean;
};

export const inputDiscoveryDiagnostics = (
  input: { context?: string | undefined; sourceKind?: string | undefined; sourceUrl?: string },
  options: ReachabilityOptions,
): InputDiscoveryDiagnostics | null => {
  if ((input.context ?? "").toLowerCase() !== "auto") return null;
  const sourceUrl = input.sourceUrl ?? "";
  // The scan detects data: case-insensitively (shared isDataUrl).
  const dataSource = isDataUrl(sourceUrl);
  // Ask the scan's own normalizer, with the data gate open, whether any
  // configuration could adopt this source at all. An over-cap payload, a blob:,
  // an ftp:, and an unparseable URL are all rejected regardless of every option
  // a note could name, so each sentence one offered would be false advice — the
  // debug log already records the skip, and the honest rendering is no note.
  // Deriving it here rather than restating the gates keeps the advice from
  // drifting away from what the scan and the background backstop actually do.
  if (sourceUrl && !normalizeAutomaticSourceUrl(sourceUrl, { includeDataUrls: true })) return null;
  const automaticSavesOff = !options.autoDownloadEnabled;
  let neverAdopted = false;
  let channelOptions: ReachabilityUnlockOption[] = [];
  const kind = input.sourceKind;
  if (isPageSourceKind(kind) && !producibleSourceKinds(options).has(kind)) {
    channelOptions = unlockOptionsFor(new Set([kind]), options);
    neverAdopted = channelOptions.length === 0;
  }
  // Advice is pointless for a source nothing can discover, so the data gate
  // is only surfaced alongside actionable channel advice (or on its own).
  const requiresDataGate = !neverAdopted && dataSource && !options.autoDownloadDataUrls;
  if (!automaticSavesOff && !neverAdopted && channelOptions.length === 0 && !requiresDataGate) {
    return null;
  }
  return { automaticSavesOff, neverAdopted, channelOptions, requiresDataGate };
};

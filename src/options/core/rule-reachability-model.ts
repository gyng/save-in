import { PAGE_SOURCE_KINDS, type PageSourceKind } from "../../shared/page-source.ts";
import { SPECIAL_DIRS } from "../../shared/constants.ts";
import { isAutomaticRuleClauses } from "../../routing/automatic-rule.ts";

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
export type ReachabilityUnlockOption = "autoDownloadDocuments" | "autoDownloadManifests";

export const REACHABILITY_OPTION_IDS = [
  "autoDownloadEnabled",
  "autoDownloadLinks",
  "autoDownloadDocuments",
  "autoDownloadBackgrounds",
  "autoDownloadManifests",
  "autoDownloadDataUrls",
] as const;

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
  | { kind: "menupath-empty"; level: "warning" };

const KIND_MATCHER_NAMES = new Set(["sourcekind", "mediatype"]);
const TEMPLATE_CLAUSE_NAMES = new Set(["into", "fetch", "rename"]);

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

// The kinds the automatic scanner can produce under the given options.
// Embedded image, video, and audio elements are always scanned; the channel
// options only ADD ways to discover those same media kinds, so they never
// change this set. Plain links are never adopted (a non-goal), and data: is a
// protocol gate rather than a kind.
export const producibleSourceKinds = (options: ReachabilityOptions): Set<PageSourceKind> => {
  const kinds = new Set<PageSourceKind>(["image", "video", "audio"]);
  if (options.autoDownloadDocuments) {
    kinds.add("document");
    kinds.add("stream");
  }
  if (options.autoDownloadManifests) kinds.add("stream");
  return kinds;
};

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
      // A global or sticky flag would make test() stateful across kinds.
      regex.lastIndex = 0;
      if (regex.test(kind)) passing.add(kind);
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

const usesMenuPathVariable = (clauses: readonly ReachabilityClause[]): boolean =>
  clauses.some(
    (clause) =>
      TEMPLATE_CLAUSE_NAMES.has(clause.name) &&
      typeof clause.value === "string" &&
      clause.value.includes(SPECIAL_DIRS.MENU_PATH),
  );

// Conservative option-aware reachability for one AUTOMATIC rule. Interactive
// saves are user-initiated and never gated by discovery options, so
// non-automatic rules report nothing.
export const ruleReachabilityDiagnostics = (
  clauses: readonly ReachabilityClause[],
  options: ReachabilityOptions,
): RuleReachabilityDiagnostic[] => {
  if (!isAutomaticRuleClauses(clauses)) return [];
  const diagnostics: RuleReachabilityDiagnostic[] = [];
  if (!options.autoDownloadEnabled) {
    // The authoring flow deliberately drafts rules with the master switch
    // off, so this is information, not a warning.
    diagnostics.push({ kind: "automatic-saves-off", level: "info" });
  }
  const matchable = matchableSourceKinds(clauses);
  if (matchable !== null) {
    const producible = producibleSourceKinds(options);
    const reachable = [...matchable].some((kind) => producible.has(kind));
    if (matchable.size === 0) {
      diagnostics.push({ kind: "no-kinds", level: "warning" });
    } else if (!reachable) {
      if ([...matchable].every((kind) => kind === "link")) {
        diagnostics.push({ kind: "link-only", level: "warning" });
      } else {
        // Reaching here guarantees an unreachable stream or document kind:
        // media kinds are always producible and the all-link case returned
        // above, so the documents channel always helps.
        const unlockOptions: [ReachabilityUnlockOption, ...ReachabilityUnlockOption[]] = [
          "autoDownloadDocuments",
        ];
        if (matchable.has("stream")) unlockOptions.push("autoDownloadManifests");
        diagnostics.push({ kind: "unreachable-kinds", level: "warning", unlockOptions });
      }
    }
  }
  if (usesMenuPathVariable(clauses)) {
    diagnostics.push({ kind: "menupath-empty", level: "warning" });
  }
  return diagnostics;
};

// Debugger variant: gates on the debugged INPUT rather than any rule. A
// candidate whose kind the current options never discover (or a data: source
// with its gate off) would not reach automatic routing at all.
export type DiscoveryUnlockOption = ReachabilityUnlockOption | "autoDownloadDataUrls";

export const inputDiscoveryUnlockOptions = (
  input: { context?: string | undefined; sourceKind?: string | undefined; sourceUrl?: string },
  options: ReachabilityOptions,
): [DiscoveryUnlockOption, ...DiscoveryUnlockOption[]] | null => {
  if ((input.context ?? "").toLowerCase() !== "auto") return null;
  const notes: DiscoveryUnlockOption[] = [];
  const kind = input.sourceKind;
  if (kind === "stream" || kind === "document") {
    const producible = producibleSourceKinds(options);
    if (!producible.has(kind)) {
      notes.push("autoDownloadDocuments");
      if (kind === "stream") notes.push("autoDownloadManifests");
    }
  }
  if ((input.sourceUrl ?? "").startsWith("data:") && !options.autoDownloadDataUrls) {
    notes.push("autoDownloadDataUrls");
  }
  // The length check proves the tuple shape; callers rely on a guaranteed
  // first entry so their sentences never need an impossible empty-list arm.
  return notes.length > 0 ? (notes as [DiscoveryUnlockOption, ...DiscoveryUnlockOption[]]) : null;
};

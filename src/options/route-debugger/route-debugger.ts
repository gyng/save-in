import { getMessage } from "../../platform/localization.ts";
import { webExtensionApi } from "../../platform/web-extension-api.ts";
import { MESSAGE_TYPES } from "../../shared/constants.ts";
import type { WireDownloadInfo } from "../../shared/message-protocol.ts";
import { sendInternalMessage } from "../../platform/messaging.ts";
import {
  mapRouteTraceToSource,
  parseRouteDebuggerTrace,
  routeDebuggerInfo,
  type RouteDebuggerFields,
  type RouteDebuggerTrace,
} from "./route-debugger-model.ts";
import { isPageSourceKind } from "../../shared/page-source.ts";
import {
  inputDiscoveryDiagnostics,
  REACHABILITY_OPTION_IDS,
} from "../core/rule-reachability-model.ts";
import {
  readReachabilityControls,
  subscribeReachabilityControls,
} from "../core/reachability-controls.ts";

type MessageSubstitutions = string | number | Array<string | number>;

const RUNNING_MESSAGE_DELAY_MS = 150;

const noop = (): void => {};
let refreshLatestDownloadFromEvent = noop;

export const refreshRouteDebuggerLatestDownload = (): void => {
  refreshLatestDownloadFromEvent();
};

const localize = (key: string, fallback: string, substitutions?: MessageSubstitutions): string =>
  getMessage(key, substitutions) || fallback;

const element = <T extends HTMLElement>(selector: string): T | null =>
  document.querySelector<T>(selector);

const localDateTimeValue = (value: string | undefined): string => {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 19);
};

const fieldsFromInfo = (info: WireDownloadInfo): RouteDebuggerFields => ({
  filename: info.filename || info.initialFilename || info.resolvedFilename || "",
  sourceUrl: info.sourceUrl || info.url || "",
  pageUrl: info.pageUrl || "",
  mime: info.mime || "",
  context: info.context || "",
  pageTitle: info.currentTab?.title || "",
  referrerUrl: info.referrerUrl || "",
  frameUrl: info.frameUrl || "",
  linkText: info.linkText || "",
  selectionText: info.selectionText || "",
  mediaType: info.mediaType || "",
  sourceKind: info.sourceKind || "",
  menuIndex: info.menuIndex || "",
  comment: info.comment || "",
  now: localDateTimeValue(info.now),
  counter: info.counter == null ? "" : String(info.counter),
  sha256: info.sha256 || "",
});

const SAMPLE_DOWNLOAD: RouteDebuggerFields = {
  filename: "report.pdf",
  sourceUrl: "https://cdn.example/report.pdf",
  pageUrl: "https://example.com/reports",
  mime: "application/pdf",
  context: "",
  pageTitle: "",
  referrerUrl: "",
  frameUrl: "",
  linkText: "",
  selectionText: "",
  mediaType: "",
  sourceKind: "",
  menuIndex: "",
  comment: "",
  now: "",
  counter: "",
  sha256: "",
};

const appendText = (parent: HTMLElement, className: string, text: string): HTMLElement => {
  const child = document.createElement("span");
  child.className = className;
  child.textContent = text;
  parent.append(child);
  return child;
};

const matcherSourceLabel = (source: string): string => {
  switch (source) {
    case "url":
    case "sourceUrl":
    case "srcUrl":
    case "linkUrl":
      return localize("routeDebuggerSourceUrl", "Source URL");
    case "pageUrl":
      return localize("routeDebuggerPageUrl", "Page URL");
    case "referrerUrl":
      return localize("routeDebuggerReferrerUrl", "Referrer URL");
    case "frameUrl":
      return localize("routeDebuggerFrameUrl", "Frame URL");
    case "resolvedFilename":
    case "filename":
    case "mimeExtension":
      return localize("routeDebuggerFilename", "Filename");
    case "mime":
    case "resolvedContentType":
      return localize("routeDebuggerContentType", "Content type");
    case "context":
      return localize("routeDebuggerContext", "Context");
    case "currentTabTitle":
      return localize("routeDebuggerPageTitle", "Page title");
    case "linkText":
      return localize("routeDebuggerLinkText", "Link text");
    case "selectionText":
      return localize("routeDebuggerSelectionText", "Selected text");
    case "mediaType":
      return localize("routeDebuggerMediaType", "Media type");
    case "sourceKind":
      return localize("routeDebuggerSourceKind", "Source kind");
    case "menuIndex":
      return localize("routeDebuggerMenuIndex", "Menu index");
    case "comment":
      return localize("routeDebuggerMenuComment", "Menu comment");
    default:
      return source;
  }
};

export const setupRouteDebugger = (): void => {
  refreshLatestDownloadFromEvent = noop;
  const textarea = element<HTMLTextAreaElement>("#filenamePatterns");
  const form = element<HTMLElement>("#route-debugger-form");
  const result = element<HTMLElement>("#route-debugger-result");
  const runButton = element<HTMLButtonElement>("#route-debugger-run");
  const useLastButton = element<HTMLButtonElement>("#route-debugger-use-last");
  const useSampleButton = element<HTMLButtonElement>("#route-debugger-use-sample");
  const clearButton = element<HTMLButtonElement>("#route-debugger-clear");
  const filename = element<HTMLInputElement>("#route-debugger-filename");
  const sourceUrl = element<HTMLInputElement>("#route-debugger-source-url");
  const pageUrl = element<HTMLInputElement>("#route-debugger-page-url");
  const mime = element<HTMLInputElement>("#route-debugger-mime");
  const context = element<HTMLSelectElement>("#route-debugger-context");
  const pageTitle = element<HTMLInputElement>("#route-debugger-page-title");
  const referrerUrl = element<HTMLInputElement>("#route-debugger-referrer-url");
  const frameUrl = element<HTMLInputElement>("#route-debugger-frame-url");
  const linkText = element<HTMLInputElement>("#route-debugger-link-text");
  const selectionText = element<HTMLInputElement>("#route-debugger-selection-text");
  const mediaType = element<HTMLSelectElement>("#route-debugger-media-type");
  const sourceKind = element<HTMLSelectElement>("#route-debugger-source-kind");
  const menuIndex = element<HTMLInputElement>("#route-debugger-menu-index");
  const comment = element<HTMLInputElement>("#route-debugger-comment");
  const now = element<HTMLInputElement>("#route-debugger-now");
  const counter = element<HTMLInputElement>("#route-debugger-counter");
  const sha256 = element<HTMLInputElement>("#route-debugger-sha256");
  if (
    !textarea ||
    !form ||
    !result ||
    !runButton ||
    !useLastButton ||
    !useSampleButton ||
    !clearButton ||
    !filename ||
    !sourceUrl ||
    !pageUrl ||
    !mime ||
    !context ||
    !pageTitle ||
    !referrerUrl ||
    !frameUrl ||
    !linkText ||
    !selectionText ||
    !mediaType ||
    !sourceKind ||
    !menuIndex ||
    !comment ||
    !now ||
    !counter ||
    !sha256
  ) {
    return;
  }

  const controls = {
    filename,
    sourceUrl,
    pageUrl,
    mime,
    context,
    pageTitle,
    referrerUrl,
    frameUrl,
    linkText,
    selectionText,
    mediaType,
    sourceKind,
    menuIndex,
    comment,
    now,
    counter,
    sha256,
  };
  let lastDownloadInfo: WireDownloadInfo | null = null;
  let generation = 0;
  let latestDownloadGeneration = 0;
  let hasRun = false;
  let rerunTimer: number | null = null;
  // The displayed trace and the exact field snapshot it ran with: the
  // reachability note re-renders against live checkboxes, but it must
  // describe the input of the trace on screen, not whatever the fields say
  // now.
  let lastTrace: RouteDebuggerTrace | null = null;
  let lastRunFields: RouteDebuggerFields | null = null;

  const readFields = (): RouteDebuggerFields => ({
    filename: filename.value.trim(),
    sourceUrl: sourceUrl.value.trim(),
    pageUrl: pageUrl.value.trim(),
    mime: mime.value.trim(),
    context: context.value,
    pageTitle: pageTitle.value.trim(),
    referrerUrl: referrerUrl.value.trim(),
    frameUrl: frameUrl.value.trim(),
    linkText: linkText.value.trim(),
    selectionText: selectionText.value.trim(),
    mediaType: mediaType.value,
    sourceKind: isPageSourceKind(sourceKind.value) ? sourceKind.value : "",
    menuIndex: menuIndex.value.trim(),
    comment: comment.value.trim(),
    now: now.value,
    counter: counter.value.trim(),
    sha256: sha256.value.trim(),
  });

  const writeFields = (fields: RouteDebuggerFields): void => {
    filename.value = fields.filename;
    sourceUrl.value = fields.sourceUrl;
    pageUrl.value = fields.pageUrl;
    mime.value = fields.mime;
    context.value = [...context.options].some((option) => option.value === fields.context)
      ? fields.context
      : "";
    pageTitle.value = fields.pageTitle || "";
    referrerUrl.value = fields.referrerUrl || "";
    frameUrl.value = fields.frameUrl || "";
    linkText.value = fields.linkText || "";
    selectionText.value = fields.selectionText || "";
    const nextMediaType = fields.mediaType || "";
    mediaType.value = [...mediaType.options].some((option) => option.value === nextMediaType)
      ? nextMediaType
      : "";
    const nextSourceKind = fields.sourceKind || "";
    sourceKind.value = [...sourceKind.options].some((option) => option.value === nextSourceKind)
      ? nextSourceKind
      : "";
    menuIndex.value = fields.menuIndex || "";
    comment.value = fields.comment || "";
    now.value = fields.now || "";
    counter.value = fields.counter || "";
    sha256.value = fields.sha256 || "";
  };

  const setState = (state: string): void => {
    result.dataset.state = state;
  };

  const clearResult = (): void => {
    setState("empty");
    result.replaceChildren();
  };

  const renderMessage = (state: string, title: string): void => {
    // A message replaces whatever trace was on screen; keeping the stale
    // trace would let a discovery-checkbox change resurrect it over this
    // message with jump offsets computed against superseded rule text.
    lastTrace = null;
    lastRunFields = null;
    setState(state);
    const message = document.createElement("div");
    message.className = "route-debugger-message";
    message.setAttribute("role", state === "error" || state === "invalid" ? "alert" : "status");
    message.setAttribute("aria-live", "polite");
    message.setAttribute("aria-atomic", "true");
    appendText(message, "route-debugger-message-title", title);
    result.replaceChildren(message);
  };

  const jumpToSource = (
    source: { start: number; end: number; line: number },
    ruleIndex: number,
  ): void => {
    document.dispatchEvent(
      new CustomEvent("route-debugger-source-selected", {
        detail: {
          ruleIndex,
          line: source.line,
        },
      }),
    );
    if (element("#rules-mode-visual")?.getAttribute("aria-selected") === "true") return;
    textarea.focus();
    textarea.setSelectionRange(source.start, source.end);
    const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight) || 24;
    const line = textarea.value.slice(0, source.start).split("\n").length - 1;
    textarea.scrollTop = Math.max(0, line * lineHeight - textarea.clientHeight / 3);
  };

  type TracedRule = RouteDebuggerTrace["rules"][number];
  type TracedClause = TracedRule["clauses"][number];

  // How many rules matched, and how that reads: only the first match is used,
  // so any others are reported as also-matched rather than as a conflict.
  const buildMatchSummary = (trace: RouteDebuggerTrace): HTMLElement => {
    const matchedRuleCount = trace.rules.filter((rule) => rule.matched).length;
    const laterMatchCount = Math.max(0, matchedRuleCount - 1);
    const message = document.createElement("div");
    message.className = "route-debugger-message route-debugger-match-summary";
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");
    message.setAttribute("aria-atomic", "true");
    appendText(
      message,
      "route-debugger-message-title",
      matchedRuleCount === 0
        ? localize("routeDebuggerNoMatch", "No routing rule matched.")
        : matchedRuleCount === 1
          ? localize(
              "routeDebuggerOneRuleMatched",
              "1 rule matched and was used.",
              matchedRuleCount,
            )
          : laterMatchCount === 1
            ? localize(
                "routeDebuggerOneLaterRuleMatches",
                "1 rule used; 1 later rule also matches.",
                laterMatchCount,
              )
            : localize(
                "routeDebuggerLaterRulesMatch",
                `1 rule used; ${laterMatchCount} later rules also match.`,
                laterMatchCount,
              ),
    );
    return message;
  };

  const buildReachabilityNote = (level: "info" | "warning", text: string): HTMLElement => {
    const note = document.createElement("div");
    note.className = "route-debugger-message route-debugger-reachability-note";
    note.dataset.level = level;
    appendText(note, "route-debugger-message-title", text);
    return note;
  };

  // An automatic-context input can describe a source the current discovery
  // options never produce; the trace is still exact, so these are notes beside
  // it, keyed to the input snapshot the trace ran with. Options are read live,
  // and the checkbox listeners below re-render the trace, so the advice follows
  // the named controls.
  const buildDiscoveryNotes = (fields: RouteDebuggerFields): HTMLElement[] => {
    const discovery = inputDiscoveryDiagnostics(
      { context: fields.context, sourceKind: fields.sourceKind, sourceUrl: fields.sourceUrl },
      readReachabilityControls(),
    );
    if (!discovery) return [];
    const notes: HTMLElement[] = [];
    if (discovery.neverAdopted) {
      notes.push(
        buildReachabilityNote(
          "warning",
          localize(
            "routeDebuggerReachabilityLink",
            "Automatic discovery never adopts plain links, so current settings would never discover this source.",
          ),
        ),
      );
    }
    // Channel alternatives are disjunctive ("or"); the data: gate is
    // conjunctive with whichever channel applies, so it always renders with
    // "and" — a user enabling only one side of a conjunction gets nothing.
    const [firstOption, secondOption] = discovery.channelOptions;
    const dataLabel = discovery.requiresDataGate
      ? localize("autoDownloadDataUrls", "autoDownloadDataUrls")
      : undefined;
    if (firstOption !== undefined && secondOption !== undefined) {
      const first = localize(firstOption, firstOption);
      const second = localize(secondOption, secondOption);
      notes.push(
        buildReachabilityNote(
          "warning",
          dataLabel === undefined
            ? localize(
                "routeDebuggerReachabilityOffEither",
                `Current settings would not discover this source automatically. Turn on “${first}” or “${second}” to include it.`,
                [first, second],
              )
            : localize(
                "routeDebuggerReachabilityOffEitherData",
                `Current settings would not discover this source automatically. Turn on “${first}” or “${second}”, and “${dataLabel}” to include it.`,
                [first, second, dataLabel],
              ),
        ),
      );
    } else if (firstOption !== undefined) {
      const first = localize(firstOption, firstOption);
      notes.push(
        buildReachabilityNote(
          "warning",
          dataLabel === undefined
            ? localize(
                "routeDebuggerReachabilityOff",
                `Current settings would not discover this source automatically. Turn on “${first}” to include it.`,
                [first],
              )
            : localize(
                "routeDebuggerReachabilityOffData",
                `Current settings would not discover this source automatically. Turn on “${first}” and “${dataLabel}” to include it.`,
                [first, dataLabel],
              ),
        ),
      );
    } else if (dataLabel !== undefined) {
      notes.push(
        buildReachabilityNote(
          "warning",
          localize(
            "routeDebuggerReachabilityOff",
            `Current settings would not discover this source automatically. Turn on “${dataLabel}” to include it.`,
            [dataLabel],
          ),
        ),
      );
    }
    // The parked master switch reads as a footnote after the actionable
    // discovery advice above. Advice is pointless for a source nothing can
    // discover, so a never-adopted input keeps only its own note.
    if (discovery.automaticSavesOff && !discovery.neverAdopted) {
      const master = localize("autoDownloadEnabled", "autoDownloadEnabled");
      notes.push(
        buildReachabilityNote(
          "info",
          localize(
            "routeDebuggerReachabilityAutomaticOff",
            `Automatic saving is off, so this source would not be saved until “${master}” is on.`,
            [master],
          ),
        ),
      );
    }
    return notes;
  };

  const buildRuleHeader = (rule: TracedRule, selected: boolean): HTMLElement => {
    const header = document.createElement("summary");
    header.className = "route-debugger-rule-header";
    const titleGroup = document.createElement("span");
    titleGroup.className = "route-debugger-rule-title-group";
    const title = document.createElement("span");
    title.className = "route-debugger-rule-title";
    const ruleLabel = localize("routeDebuggerRule", `Rule ${rule.index}`, rule.index);
    title.textContent = rule.name || ruleLabel;
    const titleLine = document.createElement("span");
    titleLine.className = "route-debugger-rule-title-line";
    titleLine.append(title);
    // A named rule still shows its number, since that is what the trace and the
    // rule list call it.
    if (rule.name) appendText(titleLine, "route-debugger-rule-index", ruleLabel);
    const destination = document.createElement("code");
    destination.className = "route-debugger-rule-destination";
    destination.dataset.path = rule.destination;
    destination.textContent = localize(
      "routeDebuggerRuleDestination",
      `Saves to ${rule.destination}`,
      rule.destination,
    );
    titleGroup.append(titleLine, destination);

    const meta = document.createElement("span");
    meta.className = "route-debugger-rule-meta";
    const matchedClauses = rule.clauses.filter((clause) => clause.matched).length;
    appendText(
      meta,
      "route-debugger-rule-count",
      localize(
        "routeDebuggerMatcherCount",
        `${matchedClauses} of ${rule.clauses.length} conditions met`,
        [matchedClauses, rule.clauses.length],
      ),
    );
    const badge = document.createElement("span");
    badge.className = "route-debugger-rule-badge";
    badge.textContent = selected
      ? localize("routeDebuggerSelected", "Used")
      : rule.matched
        ? localize("routeDebuggerAlsoMatches", "Matched, not used")
        : localize("routeDebuggerDidNotMatch", "Conditions not met");
    meta.append(badge);

    header.append(titleGroup, meta);
    return header;
  };

  // Only a rule the editor can point at gets an Edit button.
  const buildRuleSourceLink = (rule: TracedRule): HTMLButtonElement | null => {
    const ruleSource = rule.source;
    const ruleSourceIndex = rule.sourceIndex;
    if (!ruleSource || ruleSourceIndex === undefined) return null;
    const sourceLink = document.createElement("button");
    sourceLink.type = "button";
    sourceLink.className = "route-debugger-source-link";
    sourceLink.textContent = localize("routeDebuggerEditRule", "Edit");
    sourceLink.title = localize(
      "routeDebuggerGoToLine",
      `Go to line ${ruleSource.line}`,
      ruleSource.line,
    );
    sourceLink.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      jumpToSource(ruleSource, ruleSourceIndex);
    });
    return sourceLink;
  };

  // How the winning rule turned the request into a path, stage by stage. A
  // stage with no value never ran, so it is left out rather than shown empty.
  // The caller owns the precondition: this renders whatever the trace reached.
  const buildRulePipeline = (trace: RouteDebuggerTrace): HTMLDListElement => {
    const routePipeline = document.createElement("dl");
    routePipeline.className = "route-debugger-pipeline";
    const rename = trace.selectedRename ?? null;
    const renamed =
      typeof trace.renamedFrom === "string" && typeof trace.renamedTo === "string"
        ? `${trace.renamedFrom} → ${trace.renamedTo}`
        : null;
    const stages: Array<[string, string | null]> = [
      // fetch: rewrites the download URL before destination variables
      // expand, so these two stages sit ahead of the path pipeline and stay
      // hidden for plain rules that never rewrite the URL.
      [
        localize("routeDebuggerFetchTemplate", "Rewrite template"),
        trace.selectedFetchTemplate ?? null,
      ],
      [localize("routeDebuggerRewrittenUrl", "Rewritten URL"), trace.rewrittenUrl ?? null],
      [localize("routeDebuggerExpanded", "Expanded path"), trace.expandedDestination],
      // rename: edits the final filename component between expansion and
      // sanitization; both stages stay hidden for rules without one.
      [
        localize("routeDebuggerRenameTemplate", "Rename"),
        rename
          ? `${rename.find}${rename.flags ? `/${rename.flags}` : ""} → ${rename.replacement}`
          : null,
      ],
      [localize("routeDebuggerRenamedName", "Renamed name"), renamed],
      [localize("routeDebuggerFinalPath", "Final path"), trace.finalPath],
    ];
    stages.forEach(([label, value]) => {
      if (value === null) return;
      const stage = document.createElement("div");
      const term = document.createElement("dt");
      term.textContent = label;
      const description = document.createElement("dd");
      const code = document.createElement("code");
      code.textContent = value;
      description.append(code);
      stage.append(term, description);
      routePipeline.append(stage);
    });
    return routePipeline;
  };

  const buildRuleOutput = (
    pipeline: HTMLDListElement | null,
    sourceLink: HTMLButtonElement | null,
  ): HTMLElement | null => {
    if (!pipeline && !sourceLink) return null;
    const output = document.createElement("div");
    output.className = "route-debugger-rule-output";
    if (pipeline) {
      output.append(pipeline);
      // The pipeline ends at the rule's own destination, which is the whole
      // path only for click-to-save and automatic saves: those are rooted at
      // the download folder (downloads/download-plan.ts, #190), while a menu
      // save has the chosen folder composed in front of it
      // (downloads/download-disposition.ts joins [menu path, route]). The
      // trace has no menu folder to add — the debugger never asks for one —
      // so name the base instead of inventing a folder the user never picked.
      const base = document.createElement("div");
      base.className = "route-debugger-message route-debugger-path-base";
      base.textContent = localize(
        "routeDebuggerPathBase",
        "A menu save adds the folder you pick in front of this path. Click-to-save and automatic saves start at your download folder.",
      );
      output.append(base);
    }
    if (sourceLink) output.append(sourceLink);
    return output;
  };

  // What the clause tried and what came back. A traced clause reports each
  // attempt; an older trace without attempts only knows whether it matched.
  const buildClauseDecision = (clause: TracedClause): HTMLElement => {
    const decision = document.createElement("span");
    decision.className = "route-debugger-clause-decision";
    if (clause.attempts && clause.attempts.length > 0) {
      const expression = document.createElement("code");
      expression.className = "route-debugger-clause-expression";
      expression.textContent = `${clause.name}: ${clause.pattern}`;
      decision.append(expression);
      clause.attempts.forEach((attempt) => {
        const source = matcherSourceLabel(attempt.source);
        const value = attempt.value ?? "";
        const text =
          attempt.status === "matched"
            ? localize(
                "routeDebuggerAttemptMatched",
                `Tested “${value}” from ${source} — matched.`,
                [value, source],
              )
            : attempt.status === "not-matched"
              ? localize(
                  "routeDebuggerAttemptDidNotMatch",
                  `Tested “${value}” from ${source} — did not match.`,
                  [value, source],
                )
              : attempt.status === "invalid"
                ? localize(
                    "routeDebuggerAttemptInvalid",
                    `Could not read a valid value from ${source}: “${value}”.`,
                    [source, value],
                  )
                : localize(
                    "routeDebuggerAttemptMissing",
                    `No value was available from ${source}.`,
                    source,
                  );
        appendText(decision, "route-debugger-clause-attempt", text);
      });
      return decision;
    }
    appendText(
      decision,
      "route-debugger-clause-legacy",
      clause.matched
        ? localize("routeDebuggerConditionMatched", `${clause.name} matches ${clause.pattern}`, [
            clause.name,
            clause.pattern,
          ])
        : localize(
            "routeDebuggerConditionDidNotMatch",
            `${clause.name} does not match ${clause.pattern}`,
            [clause.name, clause.pattern],
          ),
    );
    return decision;
  };

  const buildClauseList = (rule: TracedRule): HTMLUListElement => {
    const ruleSourceIndex = rule.sourceIndex;
    const clauses = document.createElement("ul");
    clauses.className = "route-debugger-clauses";
    rule.clauses.forEach((clause) => {
      const item = document.createElement("li");
      // A clause the editor can point at is a button; one it cannot is inert.
      const clauseRow = document.createElement(clause.source ? "button" : "div");
      if (clauseRow instanceof HTMLButtonElement) clauseRow.type = "button";
      clauseRow.className = "route-debugger-clause";
      clauseRow.dataset.clauseName = clause.name;
      clauseRow.classList.toggle("is-match", clause.matched);
      clauseRow.classList.toggle("is-miss", !clause.matched);
      const clauseSource = clause.source;
      if (clauseSource && ruleSourceIndex !== undefined) {
        clauseRow.addEventListener("click", () => jumpToSource(clauseSource, ruleSourceIndex));
      }
      appendText(clauseRow, "route-debugger-clause-mark", clause.matched ? "✓" : "×");
      clauseRow.append(buildClauseDecision(clause));
      item.append(clauseRow);
      clauses.append(item);
    });
    return clauses;
  };

  const buildRuleCard = (trace: RouteDebuggerTrace, rule: TracedRule): HTMLDetailsElement => {
    const selected = trace.selectedRule === rule.index;
    const card = document.createElement("details");
    card.className = "route-debugger-rule";
    // Open the rule that was used; with no match at all, open the first so the
    // panel never renders fully collapsed.
    card.open = selected || (trace.selectedRule === null && rule.index === 1);
    card.classList.toggle("is-selected", selected);
    card.classList.toggle("is-match", rule.matched && !selected);
    card.append(buildRuleHeader(rule, selected));
    // Only the winning rule produced a path, so only it shows the pipeline.
    const output = buildRuleOutput(
      selected && trace.destination ? buildRulePipeline(trace) : null,
      buildRuleSourceLink(rule),
    );
    if (output) card.append(output);
    card.append(buildClauseList(rule));
    return card;
  };

  const renderTrace = (trace: RouteDebuggerTrace, fields: RouteDebuggerFields): void => {
    lastTrace = trace;
    lastRunFields = fields;
    setState(trace.selectedRule === null ? "no-match" : "matched");
    const resultFragment = document.createDocumentFragment();
    resultFragment.append(buildMatchSummary(trace));
    resultFragment.append(...buildDiscoveryNotes(fields));
    const rules = document.createElement("div");
    rules.className = "route-debugger-rule-list";
    trace.rules.forEach((rule) => rules.append(buildRuleCard(trace, rule)));
    resultFragment.append(rules);
    result.replaceChildren(resultFragment);
  };

  const run = async (): Promise<void> => {
    const mine = ++generation;
    hasRun = true;
    runButton.disabled = true;
    const hasResult = result.childElementCount > 0;
    result.dataset.busy = "true";
    result.setAttribute("aria-busy", "true");
    const runningMessageTimer = hasResult
      ? null
      : window.setTimeout(() => {
          if (mine === generation) {
            renderMessage("running", localize("routeDebuggerRunning", "Testing routes…"));
          }
        }, RUNNING_MESSAGE_DELAY_MS);
    // One snapshot feeds both the validation request and the rendered trace,
    // so the reachability note always describes the input the trace ran with.
    const fields = readFields();
    try {
      const requestValidation = async () => {
        const response = await sendInternalMessage(webExtensionApi.runtime, {
          type: MESSAGE_TYPES.VALIDATE,
          body: {
            filenamePatterns: textarea.value,
            info: routeDebuggerInfo(fields),
          },
        });
        if ("status" in response.body) {
          throw new Error(response.body.message || response.body.error);
        }
        const errors = response.body.ruleErrors?.filter((error) => !error.warning) ?? [];
        if (errors.length > 0) return { errors, trace: null };
        const trace = parseRouteDebuggerTrace(response.body.ruleTrace);
        if (!trace) throw new Error("Invalid route debugger trace");
        return { errors, trace };
      };
      let validation: Awaited<ReturnType<typeof requestValidation>>;
      try {
        validation = await requestValidation();
      } catch {
        // VALIDATE is read-only. A freshly reloaded MV3 background can miss or
        // interrupt the first request while it finishes waking, so retry once.
        validation = await requestValidation();
      }
      if (mine !== generation) return;
      if (validation.errors.length > 0) {
        renderMessage(
          "invalid",
          localize(
            "routeDebuggerFixErrors",
            `Fix the highlighted routing issues before testing. Issue count: ${validation.errors.length}.`,
            validation.errors.length,
          ),
        );
        return;
      }
      /* v8 ignore next -- A null trace is returned only alongside blocking errors handled above. */
      if (!validation.trace) {
        renderMessage(
          "error",
          localize("routeDebuggerUnavailable", "Could not run the route debugger."),
        );
        return;
      }
      renderTrace(mapRouteTraceToSource(textarea.value, validation.trace), fields);
    } catch {
      if (mine !== generation) return;
      renderMessage(
        "error",
        localize("routeDebuggerUnavailable", "Could not run the route debugger."),
      );
    } finally {
      if (runningMessageTimer !== null) window.clearTimeout(runningMessageTimer);
      if (mine === generation) {
        runButton.disabled = false;
        delete result.dataset.busy;
        result.removeAttribute("aria-busy");
      }
    }
  };

  const scheduleRerun = (): void => {
    if (!hasRun) return;
    if (rerunTimer !== null) window.clearTimeout(rerunTimer);
    rerunTimer = window.setTimeout(() => {
      rerunTimer = null;
      void run();
    }, 250);
  };

  runButton.addEventListener("click", () => {
    void run();
  });
  // The reachability note names live discovery checkboxes; toggling one must
  // refresh a displayed trace without re-running it (the trace stays exact
  // for its snapshot), and a settings import writes .checked without firing
  // change, so the shared subscription also follows "options-restored".
  // Registered once here so debugger reruns never stack duplicate listeners.
  subscribeReachabilityControls(REACHABILITY_OPTION_IDS, () => {
    if (lastTrace && lastRunFields) renderTrace(lastTrace, lastRunFields);
  });
  clearButton.addEventListener("click", () => {
    generation += 1;
    hasRun = false;
    lastTrace = null;
    lastRunFields = null;
    runButton.disabled = false;
    delete result.dataset.busy;
    result.removeAttribute("aria-busy");
    if (rerunTimer !== null) window.clearTimeout(rerunTimer);
    rerunTimer = null;
    writeFields({
      filename: "",
      sourceUrl: "",
      pageUrl: "",
      mime: "",
      context: "",
      pageTitle: "",
      referrerUrl: "",
      frameUrl: "",
      linkText: "",
      selectionText: "",
      mediaType: "",
      sourceKind: "",
      menuIndex: "",
      comment: "",
      now: "",
      counter: "",
      sha256: "",
    });
    clearResult();
    filename.focus();
  });
  form.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    void run();
  });
  Object.values(controls).forEach((control) => control.addEventListener("input", scheduleRerun));
  textarea.addEventListener("input", scheduleRerun);
  textarea.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey) || event.isComposing) return;
    event.preventDefault();
    void run();
  });
  useLastButton.addEventListener("click", () => {
    if (!lastDownloadInfo) {
      renderMessage(
        "empty",
        localize("routeDebuggerNoLastDownload", "No recent download is available."),
      );
      return;
    }
    writeFields(fieldsFromInfo(lastDownloadInfo));
    void run();
  });
  useSampleButton.addEventListener("click", () => {
    writeFields(SAMPLE_DOWNLOAD);
    void run();
  });

  const refreshLatestDownload = (replaceFields: boolean): void => {
    const mine = ++latestDownloadGeneration;
    void sendInternalMessage(webExtensionApi.runtime, { type: MESSAGE_TYPES.CHECK_ROUTES })
      .then((response) => {
        if (mine !== latestDownloadGeneration || !("lastDownload" in response.body)) return;
        lastDownloadInfo = response.body.lastDownload?.info ?? null;
        useLastButton.disabled = lastDownloadInfo === null;
        if (replaceFields) {
          writeFields(lastDownloadInfo ? fieldsFromInfo(lastDownloadInfo) : SAMPLE_DOWNLOAD);
        }
      })
      .catch(() => {});
  };

  refreshLatestDownloadFromEvent = () => refreshLatestDownload(false);

  clearResult();
  useLastButton.disabled = true;
  writeFields(SAMPLE_DOWNLOAD);
  refreshLatestDownload(true);
};

import { getMessage } from "../platform/localization.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";
import { MESSAGE_TYPES } from "../shared/constants.ts";
import { sendInternalMessage, type WireDownloadInfo } from "../shared/message-protocol.ts";
import {
  mapRouteTraceToSource,
  parseRouteDebuggerTrace,
  routeDebuggerInfo,
  type RouteDebuggerFields,
  type RouteDebuggerTrace,
} from "./route-debugger-model.ts";

type MessageSubstitutions = string | number | Array<string | number>;

const localize = (key: string, fallback: string, substitutions?: MessageSubstitutions): string =>
  getMessage(key, substitutions) || fallback;

const element = <T extends HTMLElement>(selector: string): T | null =>
  document.querySelector<T>(selector);

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
};

const appendText = (parent: HTMLElement, className: string, text: string): HTMLElement => {
  const child = document.createElement("span");
  child.className = className;
  child.textContent = text;
  parent.append(child);
  return child;
};

export const setupRouteDebugger = (): void => {
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
  const moreData = element<HTMLDetailsElement>(".route-debugger-more");
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
    !moreData
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
  };
  let lastDownloadInfo: WireDownloadInfo | null = null;
  let generation = 0;
  let hasRun = false;
  let rerunTimer: number | null = null;

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
    moreData.open = Boolean(
      fields.pageTitle ||
      fields.referrerUrl ||
      fields.frameUrl ||
      fields.linkText ||
      fields.selectionText ||
      fields.mediaType,
    );
  };

  const setState = (state: string): void => {
    result.dataset.state = state;
  };

  const clearResult = (): void => {
    setState("empty");
    result.replaceChildren();
  };

  const renderMessage = (state: string, title: string): void => {
    setState(state);
    const message = document.createElement("div");
    message.className = "route-debugger-message";
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

  const renderTrace = (trace: RouteDebuggerTrace): void => {
    setState(trace.selectedRule === null ? "no-match" : "matched");
    const fragment = document.createDocumentFragment();
    const outcome = document.createElement("div");
    outcome.className = "route-debugger-outcome";
    const outcomeCopy = document.createElement("div");
    outcomeCopy.className = "route-debugger-outcome-copy";
    appendText(
      outcomeCopy,
      "route-debugger-outcome-label",
      trace.selectedRule === null
        ? localize("routeDebuggerNoMatch", "No routing rule matched.")
        : localize(
            "routeDebuggerMatched",
            `Rule ${trace.selectedRule} matched.`,
            trace.selectedRule,
          ),
    );
    if (trace.finalPath) {
      const finalPath = document.createElement("code");
      finalPath.className = "route-debugger-final-path";
      finalPath.textContent = trace.finalPath;
      outcomeCopy.append(finalPath);
    }
    outcome.append(outcomeCopy);
    fragment.append(outcome);

    if (trace.destination) {
      const pipeline = document.createElement("dl");
      pipeline.className = "route-debugger-pipeline";
      const stages: Array<[string, string | null]> = [
        [localize("routeDebuggerTemplate", "Template"), trace.destination],
        [localize("routeDebuggerExpanded", "Expanded"), trace.expandedDestination],
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
        pipeline.append(stage);
      });
      fragment.append(pipeline);
    }

    const rules = document.createElement("div");
    rules.className = "route-debugger-rules";
    const traceHeading = document.createElement("div");
    traceHeading.className = "route-debugger-trace-heading";
    const traceHeadingCopy = document.createElement("div");
    appendText(
      traceHeadingCopy,
      "route-debugger-trace-title",
      localize("routeDebuggerEvaluation", "Rule evaluation"),
    );
    appendText(
      traceHeadingCopy,
      "route-debugger-trace-description",
      localize("routeDebuggerFirstMatch", "Rules run top to bottom; the first match wins."),
    );
    traceHeading.append(traceHeadingCopy);
    rules.append(traceHeading);
    trace.rules.forEach((rule) => {
      const selected = trace.selectedRule === rule.index;
      const card = document.createElement("details");
      card.className = "route-debugger-rule";
      card.open = selected || (trace.selectedRule === null && rule.index === 1);
      card.classList.toggle("is-selected", selected);
      card.classList.toggle("is-match", rule.matched && !selected);
      const header = document.createElement("summary");
      header.className = "route-debugger-rule-header";
      const titleGroup = document.createElement("span");
      titleGroup.className = "route-debugger-rule-title-group";
      const title = document.createElement("span");
      title.className = "route-debugger-rule-title";
      title.textContent = localize("routeDebuggerRule", `Rule ${rule.index}`, rule.index);
      const destination = document.createElement("code");
      destination.className = "route-debugger-rule-destination";
      destination.textContent = `into: ${rule.destination}`;
      titleGroup.append(title, destination);
      const meta = document.createElement("span");
      meta.className = "route-debugger-rule-meta";
      const matchedClauses = rule.clauses.filter((clause) => clause.matched).length;
      appendText(
        meta,
        "route-debugger-rule-count",
        localize("routeDebuggerMatcherCount", `Matched ${matchedClauses}/${rule.clauses.length}`, [
          matchedClauses,
          rule.clauses.length,
        ]),
      );
      const badge = document.createElement("span");
      badge.className = "route-debugger-rule-badge";
      badge.textContent = selected
        ? localize("routeDebuggerSelected", "Selected")
        : rule.matched
          ? localize("routeDebuggerAlsoMatches", "Also matches")
          : localize("routeDebuggerDidNotMatch", "Did not match");
      meta.append(badge);
      if (rule.source) {
        const sourceLink = document.createElement("button");
        sourceLink.type = "button";
        sourceLink.className = "route-debugger-source-link";
        sourceLink.textContent = `L${rule.source.line}`;
        sourceLink.setAttribute(
          "aria-label",
          localize("routeDebuggerGoToLine", `Go to line ${rule.source.line}`, rule.source.line),
        );
        sourceLink.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          jumpToSource(rule.source!, rule.sourceIndex!);
        });
        meta.append(sourceLink);
      }
      header.append(titleGroup, meta);
      card.append(header);

      const clauses = document.createElement("ul");
      clauses.className = "route-debugger-clauses";
      rule.clauses.forEach((clause) => {
        const item = document.createElement("li");
        const clauseButton = document.createElement("button");
        clauseButton.type = "button";
        clauseButton.className = "route-debugger-clause";
        clauseButton.classList.toggle("is-match", clause.matched);
        clauseButton.classList.toggle("is-miss", !clause.matched);
        if (clause.source) {
          clauseButton.addEventListener("click", () =>
            jumpToSource(clause.source!, rule.sourceIndex!),
          );
        }
        appendText(clauseButton, "route-debugger-clause-mark", clause.matched ? "✓" : "×");
        const name = document.createElement("code");
        name.className = "route-debugger-clause-name";
        name.textContent = `${clause.name}:`;
        const pattern = document.createElement("code");
        pattern.className = "route-debugger-clause-pattern";
        pattern.textContent = clause.pattern;
        clauseButton.append(name, pattern);
        if (clause.source) {
          appendText(clauseButton, "route-debugger-clause-line", `L${clause.source.line}`);
        }
        item.append(clauseButton);
        clauses.append(item);
      });
      card.append(clauses);
      rules.append(card);
    });
    fragment.append(rules);
    result.replaceChildren(fragment);
  };

  const run = async (): Promise<void> => {
    const mine = ++generation;
    hasRun = true;
    runButton.disabled = true;
    const hasTrace = result.querySelector(".route-debugger-rules") !== null;
    result.dataset.busy = "true";
    result.setAttribute("aria-busy", "true");
    if (!hasTrace) renderMessage("running", localize("routeDebuggerRunning", "Testing routes…"));
    try {
      const response = await sendInternalMessage(webExtensionApi.runtime, {
        type: MESSAGE_TYPES.VALIDATE,
        body: {
          filenamePatterns: textarea.value,
          info: routeDebuggerInfo(readFields()),
        },
      });
      if (mine !== generation) return;
      if (!("version" in response.body)) {
        throw new Error(response.body.message || response.body.error);
      }
      const errors = response.body.ruleErrors?.filter((error) => !error.warning) ?? [];
      if (errors.length > 0) {
        renderMessage(
          "invalid",
          localize(
            "routeDebuggerFixErrors",
            `Fix ${errors.length} routing error(s) before testing.`,
            errors.length,
          ),
        );
        return;
      }
      const parsed = parseRouteDebuggerTrace(response.body.ruleTrace);
      if (!parsed) throw new Error("Invalid route debugger trace");
      renderTrace(mapRouteTraceToSource(textarea.value, parsed));
    } catch {
      if (mine !== generation) return;
      renderMessage(
        "error",
        localize("routeDebuggerUnavailable", "Could not run the route debugger."),
      );
    } finally {
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
  clearButton.addEventListener("click", () => {
    generation += 1;
    hasRun = false;
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

  clearResult();
  useLastButton.disabled = true;
  writeFields(SAMPLE_DOWNLOAD);
  void sendInternalMessage(webExtensionApi.runtime, { type: MESSAGE_TYPES.CHECK_ROUTES })
    .then((response) => {
      if (!("lastDownload" in response.body)) return;
      lastDownloadInfo = response.body.lastDownload?.info ?? null;
      useLastButton.disabled = lastDownloadInfo === null;
      writeFields(lastDownloadInfo ? fieldsFromInfo(lastDownloadInfo) : SAMPLE_DOWNLOAD);
    })
    .catch(() => {});
};

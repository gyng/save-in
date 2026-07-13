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

const localize = (key: string, fallback: string, substitutions?: string | number): string =>
  getMessage(key, substitutions) || fallback;

const element = <T extends HTMLElement>(selector: string): T | null =>
  document.querySelector<T>(selector);

const fieldsFromInfo = (info: WireDownloadInfo): RouteDebuggerFields => ({
  filename: info.filename || info.initialFilename || info.resolvedFilename || "",
  sourceUrl: info.sourceUrl || info.url || "",
  pageUrl: info.pageUrl || "",
  mime: info.mime || "",
  context: info.context || "",
});

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
  const filename = element<HTMLInputElement>("#route-debugger-filename");
  const sourceUrl = element<HTMLInputElement>("#route-debugger-source-url");
  const pageUrl = element<HTMLInputElement>("#route-debugger-page-url");
  const mime = element<HTMLInputElement>("#route-debugger-mime");
  const context = element<HTMLSelectElement>("#route-debugger-context");
  if (
    !textarea ||
    !form ||
    !result ||
    !runButton ||
    !useLastButton ||
    !filename ||
    !sourceUrl ||
    !pageUrl ||
    !mime ||
    !context
  ) {
    return;
  }

  const controls = { filename, sourceUrl, pageUrl, mime, context };
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
  });

  const writeFields = (fields: RouteDebuggerFields): void => {
    filename.value = fields.filename;
    sourceUrl.value = fields.sourceUrl;
    pageUrl.value = fields.pageUrl;
    mime.value = fields.mime;
    context.value = [...context.options].some((option) => option.value === fields.context)
      ? fields.context
      : "";
  };

  const setState = (state: string): void => {
    result.dataset.state = state;
  };

  const renderMessage = (state: string, title: string, detail = ""): void => {
    setState(state);
    const message = document.createElement("div");
    message.className = "route-debugger-message";
    appendText(message, "route-debugger-message-title", title);
    if (detail) appendText(message, "route-debugger-message-detail", detail);
    result.replaceChildren(message);
  };

  const jumpToSource = (source: { start: number; end: number }): void => {
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
    trace.rules.forEach((rule) => {
      const selected = trace.selectedRule === rule.index;
      const card = document.createElement("article");
      card.className = "route-debugger-rule";
      card.classList.toggle("is-selected", selected);
      card.classList.toggle("is-match", rule.matched && !selected);
      const header = document.createElement("button");
      header.type = "button";
      header.className = "route-debugger-rule-header";
      if (rule.source) header.addEventListener("click", () => jumpToSource(rule.source!));
      const title = document.createElement("span");
      title.className = "route-debugger-rule-title";
      title.textContent = localize("routeDebuggerRule", `Rule ${rule.index}`, rule.index);
      const badge = document.createElement("span");
      badge.className = "route-debugger-rule-badge";
      badge.textContent = selected
        ? localize("routeDebuggerSelected", "Selected")
        : rule.matched
          ? localize("routeDebuggerAlsoMatches", "Also matches")
          : localize("routeDebuggerDidNotMatch", "Did not match");
      header.append(title, badge);
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
          clauseButton.addEventListener("click", () => jumpToSource(clause.source!));
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
    renderMessage("running", localize("routeDebuggerRunning", "Testing routes…"));
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
      if (mine === generation) runButton.disabled = false;
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
  form.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    void run();
  });
  Object.values(controls).forEach((control) => control.addEventListener("input", scheduleRerun));
  textarea.addEventListener("input", scheduleRerun);
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

  renderMessage(
    "empty",
    localize("routeDebuggerEmpty", "Enter download details, then run the current rules."),
  );
  useLastButton.disabled = true;
  void sendInternalMessage(webExtensionApi.runtime, { type: MESSAGE_TYPES.CHECK_ROUTES })
    .then((response) => {
      if (!("lastDownload" in response.body)) return;
      lastDownloadInfo = response.body.lastDownload?.info ?? null;
      useLastButton.disabled = lastDownloadInfo === null;
    })
    .catch(() => {});
};

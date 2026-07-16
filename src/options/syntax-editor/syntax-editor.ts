import { getMessage } from "../../platform/localization.ts";
import {
  analyzeSyntax,
  type SyntaxEditorDiagnostic,
  type SyntaxEditorLanguage,
  type SyntaxSnapshot,
} from "./syntax-editor-model.ts";
import { positionFloatingElement } from "../../shared/floating-position.ts";

export type SyntaxEditorController = {
  readonly textarea: HTMLTextAreaElement;
  readonly language: SyntaxEditorLanguage;
  refresh(): void;
  setDiagnostics(diagnostics: readonly SyntaxEditorDiagnostic[]): void;
  destroy(): void;
};

export const SYNTAX_EDITOR_LINE_SELECTED_EVENT = "syntax-editor-line-selected";

const controllers = new WeakMap<HTMLTextAreaElement, SyntaxEditorController>();
const pendingDiagnostics = new WeakMap<HTMLTextAreaElement, readonly SyntaxEditorDiagnostic[]>();

const diagnosticText = (message: string): string => {
  switch (message) {
    case "html_required":
      return getMessage("html_required") || message;
    case "matchPatternInvalid":
      return getMessage("matchPatternInvalid") || message;
    case "regularExpressionInvalid":
      return getMessage("regularExpressionInvalid") || message;
    case "ruleBadClause":
      return getMessage("ruleBadClause") || message;
    default:
      return message;
  }
};

const diagnosticLabel = (diagnostic: SyntaxEditorDiagnostic): string =>
  `L${diagnostic.line}: ${diagnosticText(diagnostic.message)}`;

const uniqueDiagnostics = (
  diagnostics: readonly SyntaxEditorDiagnostic[],
): readonly SyntaxEditorDiagnostic[] => {
  const result: SyntaxEditorDiagnostic[] = [];
  diagnostics.forEach((diagnostic) => {
    const message = diagnosticText(diagnostic.message);
    const duplicate = result.findIndex((candidate) => {
      if (candidate.line !== diagnostic.line || candidate.severity !== diagnostic.severity) {
        return false;
      }
      const candidateMessage = diagnosticText(candidate.message);
      return (
        (candidate.start === diagnostic.start && candidate.end === diagnostic.end) ||
        candidateMessage === message ||
        candidateMessage.startsWith(`${message}:`) ||
        message.startsWith(`${candidateMessage}:`)
      );
    });
    if (duplicate < 0) {
      result.push(diagnostic);
    } else {
      const existing = result[duplicate];
      if (
        existing &&
        ((existing.start === diagnostic.start && existing.end === diagnostic.end) ||
          message.length > diagnosticText(existing.message).length)
      ) {
        result[duplicate] = diagnostic;
      }
    }
  });
  return result;
};

const diagnosticsForLine = (
  diagnostics: readonly SyntaxEditorDiagnostic[],
  line: SyntaxSnapshot["lines"][number],
): readonly SyntaxEditorDiagnostic[] =>
  uniqueDiagnostics(
    diagnostics.filter(
      (diagnostic) =>
        diagnostic.line === line.number ||
        (diagnostic.start <= line.end && diagnostic.end >= line.start),
    ),
  );

const displayColumns = (value: string): number => {
  let column = 0;
  for (const character of value) {
    column = character === "\t" ? column + (8 - (column % 8)) : column + 1;
  }
  return column;
};

const boundedDiagnostics = (
  source: string,
  diagnostics: readonly SyntaxEditorDiagnostic[],
): SyntaxEditorDiagnostic[] =>
  diagnostics.map((diagnostic) => {
    let start = Math.max(0, Math.min(diagnostic.start, source.length));
    let end = Math.max(0, Math.min(diagnostic.end, source.length));
    if (end <= start && source.length > 0) {
      const lineStart = source.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
      const nextBreak = source.indexOf("\n", start);
      const lineEnd = nextBreak < 0 ? source.length : nextBreak;
      start = start > lineStart ? start - 1 : Math.min(start, Math.max(lineStart, lineEnd - 1));
      end = Math.min(source.length, start + 1);
    }
    return { ...diagnostic, start, end };
  });

const renderOverlay = (
  overlay: HTMLElement,
  snapshot: SyntaxSnapshot,
  externalDiagnostics: readonly SyntaxEditorDiagnostic[],
  includeEndMarker = true,
): readonly SyntaxEditorDiagnostic[] => {
  const diagnostics = boundedDiagnostics(snapshot.source, [
    ...snapshot.diagnostics,
    ...externalDiagnostics,
  ]);
  const boundaries = new Set([0, snapshot.source.length]);
  snapshot.tokens.forEach(({ start, end }) => {
    boundaries.add(start);
    boundaries.add(end);
  });
  diagnostics.forEach(({ start, end }) => {
    boundaries.add(start);
    boundaries.add(end);
  });
  const positions = [...boundaries].toSorted((left, right) => left - right);
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < positions.length - 1; index += 1) {
    const start = positions[index];
    const end = positions[index + 1];
    /* v8 ignore next -- The loop bound guarantees this adjacent boundary pair. */
    if (start === undefined || end === undefined) continue;
    const value = snapshot.source.slice(start, end);
    const syntaxToken = snapshot.tokens.findLast(
      (candidate) => candidate.start <= start && candidate.end >= end,
    );
    const activeDiagnostics = diagnostics.filter(
      (diagnostic) => diagnostic.start <= start && diagnostic.end >= end,
    );
    if (!syntaxToken && activeDiagnostics.length === 0) {
      fragment.append(value);
      continue;
    }
    const span = document.createElement("span");
    span.textContent = value;
    if (syntaxToken) span.classList.add(`syntax-token-${syntaxToken.kind}`);
    if (activeDiagnostics.length > 0) {
      const severity = activeDiagnostics.some((diagnostic) => diagnostic.severity === "error")
        ? "error"
        : "warning";
      span.classList.add("syntax-diagnostic", `syntax-diagnostic-${severity}`);
      span.dataset.diagnostic = activeDiagnostics.map(diagnosticLabel).join("\n");
    }
    fragment.append(span);
  }
  if (includeEndMarker) {
    const endMarker = document.createElement("span");
    endMarker.className = "syntax-editor-end-marker";
    endMarker.textContent = "\u200b";
    fragment.append(endMarker);
  }
  overlay.replaceChildren(fragment);
  return diagnostics;
};

export const renderSyntaxHighlight = (
  target: HTMLElement,
  language: SyntaxEditorLanguage,
  source: string,
): void => {
  renderOverlay(target, analyzeSyntax(language, source), [], false);
};

const renderGutter = (
  gutter: HTMLElement,
  snapshot: SyntaxSnapshot,
  diagnostics: readonly SyntaxEditorDiagnostic[],
): void => {
  const fragment = document.createDocumentFragment();
  snapshot.lines.forEach((line) => {
    const number = document.createElement("span");
    number.className = "syntax-editor-line-number";
    number.dataset.start = String(line.start);
    number.textContent = String(line.number);
    const lineDiagnostics = diagnosticsForLine(diagnostics, line);
    if (lineDiagnostics.length > 0) {
      const severity = lineDiagnostics.some((diagnostic) => diagnostic.severity === "error")
        ? "error"
        : "warning";
      number.classList.add("has-diagnostic", `has-diagnostic-${severity}`);
      number.dataset.line = String(line.number);
      number.dataset.diagnostic = lineDiagnostics.map(diagnosticLabel).join("\n");
    }
    fragment.append(number);
  });
  gutter.replaceChildren(fragment);
};

export const createSyntaxEditor = (
  textarea: HTMLTextAreaElement,
  language: SyntaxEditorLanguage,
): SyntaxEditorController => {
  const existing = controllers.get(textarea);
  if (existing) return existing;

  const shell = document.createElement("div");
  shell.className = "syntax-editor";
  shell.dataset.language = language;
  const gutterViewport = document.createElement("div");
  gutterViewport.className = "syntax-editor-gutter-viewport";
  gutterViewport.setAttribute("aria-hidden", "true");
  const gutter = document.createElement("div");
  gutter.className = "syntax-editor-gutter";
  gutterViewport.append(gutter);
  const stage = document.createElement("div");
  stage.className = "syntax-editor-stage";
  const overlay = document.createElement("pre");
  overlay.className = "syntax-editor-overlay";
  overlay.setAttribute("aria-hidden", "true");
  const tooltip = document.createElement("div");
  tooltip.className = "syntax-editor-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  document.body.append(tooltip);

  const parent = textarea.parentNode;
  if (!parent) throw new Error("Syntax editor textarea must be connected");
  parent.insertBefore(shell, textarea);
  stage.append(overlay);
  stage.append(textarea);
  shell.append(gutterViewport, stage);
  textarea.classList.add("syntax-editor-input");
  textarea.setAttribute("wrap", "off");

  let externalDiagnostics = pendingDiagnostics.get(textarea) ?? [];
  let snapshot = analyzeSyntax(language, textarea.value);
  let renderedDiagnostics: readonly SyntaxEditorDiagnostic[] = [];
  let characterWidth = 0;
  let tooltipPinned = false;
  let selectedSourceIndex: number | null = null;
  const validationSummaryId = textarea.dataset.syntaxValidationSummary;
  const validationSummary = validationSummaryId
    ? textarea.ownerDocument.getElementById(validationSummaryId)
    : null;

  const syncValidationSummary = (diagnostics: readonly SyntaxEditorDiagnostic[]) => {
    if (!validationSummary) return;
    const invalid = diagnostics.some(({ severity }) => severity === "error");
    validationSummary.hidden = !invalid;
    if (invalid) textarea.setAttribute("aria-invalid", "true");
    else textarea.removeAttribute("aria-invalid");
  };

  const syncCurrentLine = (notify = false) => {
    const offset = textarea.selectionStart;
    const line = snapshot.lines.find(
      (candidate) => offset >= candidate.start && offset <= candidate.end,
    );
    if (!line) return;
    const style = getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(style.lineHeight) || 24;
    const paddingTop = Number.parseFloat(style.paddingTop) || 0;
    overlay.style.backgroundPosition = `0 ${paddingTop + (line.number - 1) * lineHeight}px`;
    overlay.style.backgroundSize = `100% ${lineHeight}px`;
    gutter
      .querySelectorAll(".syntax-editor-line-number.is-current")
      .forEach((number) => number.classList.remove("is-current"));
    gutter
      .querySelector<HTMLElement>(`.syntax-editor-line-number[data-start="${line.start}"]`)
      ?.classList.add("is-current");
    const sourceIndex = line.number - 1;
    if (notify || sourceIndex !== selectedSourceIndex) {
      selectedSourceIndex = sourceIndex;
      textarea.dispatchEvent(
        new CustomEvent(SYNTAX_EDITOR_LINE_SELECTED_EVENT, {
          bubbles: true,
          detail: { sourceIndex },
        }),
      );
    }
  };

  const diagnosticsAtOffset = (offset: number): readonly SyntaxEditorDiagnostic[] =>
    uniqueDiagnostics(
      renderedDiagnostics.filter(
        (diagnostic) => diagnostic.start <= offset && diagnostic.end > offset,
      ),
    );

  const diagnosticsAtSelection = (): readonly SyntaxEditorDiagnostic[] =>
    textarea.selectionStart === textarea.selectionEnd
      ? diagnosticsAtOffset(textarea.selectionStart)
      : [];

  const syncScroll = () => {
    overlay.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
    gutter.style.transform = `translateY(${-textarea.scrollTop}px)`;
    syncCurrentLine();
  };

  const refresh = () => {
    snapshot = analyzeSyntax(language, textarea.value);
    renderedDiagnostics = renderOverlay(overlay, snapshot, externalDiagnostics);
    renderGutter(gutter, snapshot, renderedDiagnostics);
    syncValidationSummary(renderedDiagnostics);
    syncScroll();
  };

  const onInput = () => {
    hideTooltip();
    externalDiagnostics = [];
    pendingDiagnostics.set(textarea, []);
    refresh();
  };

  const measureCharacterWidth = (): number => {
    if (characterWidth > 0) return characterWidth;
    const probe = document.createElement("span");
    probe.className = "syntax-editor-character-probe";
    probe.textContent = "MMMMMMMMMM";
    document.body.append(probe);
    const measured = probe.getBoundingClientRect().width / 10;
    probe.remove();
    const fontSize = Number.parseFloat(getComputedStyle(textarea).fontSize) || 16;
    characterWidth = measured || fontSize * 0.62;
    return characterWidth;
  };

  const hideTooltip = () => {
    tooltipPinned = false;
    tooltip.hidden = true;
    tooltip.replaceChildren();
  };

  const hideHoverTooltip = () => {
    if (!tooltipPinned) hideTooltip();
  };

  const showTooltip = (
    diagnostics: readonly SyntaxEditorDiagnostic[],
    anchorX: number,
    anchorTop: number,
    pinned = false,
  ) => {
    const visibleDiagnostics = uniqueDiagnostics(diagnostics);
    if (visibleDiagnostics.length === 0) {
      hideTooltip();
      return;
    }
    const fragment = document.createDocumentFragment();
    visibleDiagnostics.forEach((diagnostic) => {
      const item = document.createElement("div");
      item.className = `syntax-editor-tooltip-item syntax-editor-tooltip-${diagnostic.severity}`;
      const location = document.createElement("span");
      location.className = "syntax-editor-tooltip-location";
      location.textContent = `L${diagnostic.line}:`;
      const message = document.createElement("span");
      message.className = "syntax-editor-tooltip-message";
      message.textContent = diagnosticText(diagnostic.message);
      item.append(location, message);
      fragment.append(item);
    });
    tooltip.replaceChildren(fragment);
    tooltip.hidden = false;
    tooltipPinned = pinned;
    positionFloatingElement(
      tooltip,
      { left: anchorX, right: anchorX, top: anchorTop, bottom: anchorTop },
      { prefer: "above", gap: 10 },
    );
  };

  const editorMetrics = () => {
    const style = getComputedStyle(textarea);
    return {
      rect: textarea.getBoundingClientRect(),
      lineHeight: Number.parseFloat(style.lineHeight) || 24,
      paddingTop: Number.parseFloat(style.paddingTop) || 0,
      paddingLeft: Number.parseFloat(style.paddingLeft) || 0,
    };
  };

  const lineAtOffset = (offset: number) => {
    const line = snapshot.lines.find(
      (candidate) => offset >= candidate.start && offset <= candidate.end,
    );
    /* v8 ignore next -- Callers pass caret and diagnostic offsets from snapshot.source. */
    if (!line) throw new RangeError(`No syntax line contains offset ${offset}.`);
    return line;
  };

  const showTooltipForCaret = () => {
    const diagnostics = diagnosticsAtSelection();
    if (diagnostics.length === 0) {
      hideTooltip();
      return;
    }
    const offset = textarea.selectionStart;
    const line = lineAtOffset(offset);
    const { rect, lineHeight, paddingTop, paddingLeft } = editorMetrics();
    const lineIndex = line.number - 1;
    const column = displayColumns(snapshot.source.slice(line.start, Math.min(offset, line.end)));
    showTooltip(
      diagnostics,
      rect.left + paddingLeft + column * measureCharacterWidth() - textarea.scrollLeft,
      rect.top + paddingTop + lineIndex * lineHeight - textarea.scrollTop,
      true,
    );
  };

  const onCaretChange = () => {
    syncCurrentLine();
    showTooltipForCaret();
  };

  const onGutterPointerMove = (event: MouseEvent) => {
    if (tooltipPinned) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const lineNumber = Number(target.dataset.line);
    const line = snapshot.lines[lineNumber - 1];
    if (!line) {
      hideTooltip();
      return;
    }
    const diagnostics = diagnosticsForLine(renderedDiagnostics, line);
    const rect = target.getBoundingClientRect();
    showTooltip(diagnostics, rect.right + 8, rect.top);
  };

  const onGutterClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const start = Number(target.dataset.start);
    if (!Number.isFinite(start)) return;
    textarea.focus();
    textarea.setSelectionRange(start, start);
    syncCurrentLine();
    const line = lineAtOffset(start);
    const rect = target.getBoundingClientRect();
    showTooltip(diagnosticsForLine(renderedDiagnostics, line), rect.right + 8, rect.top, true);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") hideTooltip();
  };

  const onVisibilityChange = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const visible: unknown = Reflect.get(event.detail ?? {}, "visible");
    if (visible === false) {
      hideTooltip();
    } else if (visible === true) {
      syncCurrentLine(true);
    }
  };

  const onBlur = () => {
    hideTooltip();
  };

  const controller: SyntaxEditorController = {
    textarea,
    language,
    refresh,
    setDiagnostics(diagnostics) {
      externalDiagnostics = diagnostics;
      pendingDiagnostics.set(textarea, diagnostics);
      refresh();
    },
    destroy() {
      textarea.removeEventListener("input", onInput);
      textarea.removeEventListener("options-value-applied", onInput);
      textarea.removeEventListener("scroll", syncScroll);
      textarea.removeEventListener("blur", onBlur);
      textarea.removeEventListener("focus", onCaretChange);
      textarea.removeEventListener("click", onCaretChange);
      textarea.removeEventListener("keyup", onCaretChange);
      textarea.removeEventListener("select", onCaretChange);
      textarea.removeEventListener("keydown", onKeyDown);
      textarea.removeEventListener("syntax-editor-visibility", onVisibilityChange);
      document.removeEventListener("options-restored", refresh);
      gutter.removeEventListener("click", onGutterClick);
      gutter.removeEventListener("mousemove", onGutterPointerMove);
      gutter.removeEventListener("mouseleave", hideHoverTooltip);
      textarea.classList.remove("syntax-editor-input");
      textarea.removeAttribute("wrap");
      textarea.removeAttribute("aria-invalid");
      if (validationSummary) validationSummary.hidden = true;
      shell.replaceWith(textarea);
      tooltip.remove();
      controllers.delete(textarea);
    },
  };
  controllers.set(textarea, controller);
  textarea.addEventListener("input", onInput);
  textarea.addEventListener("options-value-applied", onInput);
  textarea.addEventListener("scroll", syncScroll, { passive: true });
  textarea.addEventListener("blur", onBlur);
  textarea.addEventListener("focus", onCaretChange);
  textarea.addEventListener("click", onCaretChange);
  textarea.addEventListener("keyup", onCaretChange);
  textarea.addEventListener("select", onCaretChange);
  textarea.addEventListener("keydown", onKeyDown);
  textarea.addEventListener("syntax-editor-visibility", onVisibilityChange);
  document.addEventListener("options-restored", refresh);
  gutter.addEventListener("click", onGutterClick);
  gutter.addEventListener("mousemove", onGutterPointerMove);
  gutter.addEventListener("mouseleave", hideHoverTooltip);
  refresh();
  return controller;
};

export const setSyntaxEditorDiagnostics = (
  textarea: HTMLTextAreaElement,
  diagnostics: readonly SyntaxEditorDiagnostic[],
): void => {
  pendingDiagnostics.set(textarea, diagnostics);
  controllers.get(textarea)?.setDiagnostics(diagnostics);
};

export const setupSyntaxEditors = (): SyntaxEditorController[] => {
  const result: SyntaxEditorController[] = [];
  const editors: ReadonlyArray<readonly [string, SyntaxEditorLanguage]> = [
    ["#paths", "directories"],
    ["#filenamePatterns", "routing"],
    ["#preferLinksFilter", "regular-expressions"],
    ["#browserDownloadFilter", "match-patterns"],
    ["#browserDownloadExcludeFilter", "match-patterns"],
    ["#setRefererHeaderFilter", "match-patterns"],
    ["#perSiteDisableList", "match-patterns"],
  ];
  editors.forEach(([selector, language]) => {
    const textarea = document.querySelector<HTMLTextAreaElement>(selector);
    if (textarea) result.push(createSyntaxEditor(textarea, language));
  });
  return result;
};

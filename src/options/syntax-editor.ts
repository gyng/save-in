import { getMessage } from "../platform/localization.ts";
import {
  analyzeSyntax,
  type SyntaxEditorDiagnostic,
  type SyntaxEditorLanguage,
  type SyntaxSnapshot,
} from "./syntax-editor-model.ts";

export type SyntaxEditorController = {
  readonly textarea: HTMLTextAreaElement;
  readonly language: SyntaxEditorLanguage;
  refresh(): void;
  setDiagnostics(diagnostics: readonly SyntaxEditorDiagnostic[]): void;
  destroy(): void;
};

const controllers = new WeakMap<HTMLTextAreaElement, SyntaxEditorController>();
const pendingDiagnostics = new WeakMap<HTMLTextAreaElement, readonly SyntaxEditorDiagnostic[]>();

const LOCALIZED_DIAGNOSTIC_KEYS = new Set(["html_required", "ruleBadClause"]);
const diagnosticText = (message: string): string =>
  LOCALIZED_DIAGNOSTIC_KEYS.has(message) ? getMessage(message) || message : message;

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
    } else if (
      (result[duplicate]!.start === diagnostic.start &&
        result[duplicate]!.end === diagnostic.end) ||
      message.length > diagnosticText(result[duplicate]!.message).length
    ) {
      result[duplicate] = diagnostic;
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
    const start = positions[index]!;
    const end = positions[index + 1]!;
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
  const endMarker = document.createElement("span");
  endMarker.className = "syntax-editor-end-marker";
  endMarker.textContent = "\u200b";
  fragment.append(endMarker);
  overlay.replaceChildren(fragment);
  return diagnostics;
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

const renderInlineDiagnostics = (
  layer: HTMLElement,
  snapshot: SyntaxSnapshot,
  diagnostics: readonly SyntaxEditorDiagnostic[],
): void => {
  const fragment = document.createDocumentFragment();
  snapshot.lines.forEach((line) => {
    const row = document.createElement("span");
    row.className = "syntax-editor-inline-row";
    const lineDiagnostics = diagnosticsForLine(diagnostics, line);
    if (lineDiagnostics.length > 0) {
      const severity = lineDiagnostics.some((diagnostic) => diagnostic.severity === "error")
        ? "error"
        : "warning";
      const message = document.createElement("span");
      message.className = `syntax-editor-inline-diagnostic syntax-editor-inline-${severity}`;
      message.style.marginLeft = `${displayColumns(snapshot.source.slice(line.start, line.end)) + 2}ch`;
      message.textContent = lineDiagnostics.map(diagnosticLabel).join(" · ");
      row.append(message);
    }
    fragment.append(row);
  });
  layer.replaceChildren(fragment);
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
  const inlineDiagnostics = document.createElement("div");
  inlineDiagnostics.className = "syntax-editor-inline-diagnostics";
  inlineDiagnostics.setAttribute("aria-hidden", "true");
  const tooltip = document.createElement("div");
  tooltip.className = "syntax-editor-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  document.body.append(tooltip);

  const parent = textarea.parentNode;
  if (!parent) throw new Error("Syntax editor textarea must be connected");
  parent.insertBefore(shell, textarea);
  stage.append(overlay, inlineDiagnostics, textarea);
  shell.append(gutterViewport, stage);
  textarea.classList.add("syntax-editor-input");
  textarea.setAttribute("wrap", "off");

  let externalDiagnostics = pendingDiagnostics.get(textarea) ?? [];
  let snapshot = analyzeSyntax(language, textarea.value);
  let renderedDiagnostics: readonly SyntaxEditorDiagnostic[] = [];
  let characterWidth = 0;
  let tooltipPinned = false;

  const syncScroll = () => {
    overlay.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
    inlineDiagnostics.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
    gutter.style.transform = `translateY(${-textarea.scrollTop}px)`;
  };

  const refresh = () => {
    snapshot = analyzeSyntax(language, textarea.value);
    renderedDiagnostics = renderOverlay(overlay, snapshot, externalDiagnostics);
    renderGutter(gutter, snapshot, renderedDiagnostics);
    renderInlineDiagnostics(inlineDiagnostics, snapshot, renderedDiagnostics);
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
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const width = tooltip.getBoundingClientRect().width;
    const left = Math.max(8, Math.min(anchorX, viewportWidth - width - 8));
    const top = Math.max(8, anchorTop - tooltip.getBoundingClientRect().height - 10);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
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

  const lineAtOffset = (offset: number) =>
    snapshot.lines.find((line) => offset >= line.start && offset <= line.end)!;

  const showTooltipForCaret = () => {
    if (textarea.selectionStart !== textarea.selectionEnd) {
      hideTooltip();
      return;
    }
    const offset = textarea.selectionStart;
    const line = lineAtOffset(offset);
    const diagnostics = diagnosticsForLine(renderedDiagnostics, line);
    if (diagnostics.length === 0) {
      hideTooltip();
      return;
    }
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

  const onPointerMove = (event: MouseEvent) => {
    if (tooltipPinned) return;
    const { rect, lineHeight, paddingTop, paddingLeft } = editorMetrics();
    const lineIndex = Math.floor(
      (event.clientY - rect.top - paddingTop + textarea.scrollTop) / lineHeight,
    );
    const line = snapshot.lines[lineIndex];
    if (!line) {
      hideTooltip();
      return;
    }
    const column = Math.max(
      0,
      Math.floor(
        (event.clientX - rect.left - paddingLeft + textarea.scrollLeft) / measureCharacterWidth(),
      ),
    );
    const offset = Math.min(line.start + column, line.end);
    const diagnostics = renderedDiagnostics.filter(
      (diagnostic) => diagnostic.start <= offset && diagnostic.end > offset,
    );
    if (diagnostics.length === 0) {
      hideTooltip();
      return;
    }
    showTooltip(diagnostics, event.clientX + 12, event.clientY);
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
    showTooltipForCaret();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") hideTooltip();
  };

  const onVisibilityChange = (event: Event) => {
    if ((event as CustomEvent<{ visible?: boolean }>).detail?.visible === false) hideTooltip();
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
      textarea.removeEventListener("mousemove", onPointerMove);
      textarea.removeEventListener("mouseleave", hideHoverTooltip);
      textarea.removeEventListener("blur", hideTooltip);
      textarea.removeEventListener("click", showTooltipForCaret);
      textarea.removeEventListener("keyup", showTooltipForCaret);
      textarea.removeEventListener("select", showTooltipForCaret);
      textarea.removeEventListener("keydown", onKeyDown);
      textarea.removeEventListener("syntax-editor-visibility", onVisibilityChange);
      gutter.removeEventListener("click", onGutterClick);
      gutter.removeEventListener("mousemove", onGutterPointerMove);
      gutter.removeEventListener("mouseleave", hideHoverTooltip);
      textarea.classList.remove("syntax-editor-input");
      textarea.removeAttribute("wrap");
      shell.replaceWith(textarea);
      tooltip.remove();
      controllers.delete(textarea);
    },
  };
  controllers.set(textarea, controller);
  textarea.addEventListener("input", onInput);
  textarea.addEventListener("options-value-applied", onInput);
  textarea.addEventListener("scroll", syncScroll, { passive: true });
  textarea.addEventListener("mousemove", onPointerMove);
  textarea.addEventListener("mouseleave", hideHoverTooltip);
  textarea.addEventListener("blur", hideTooltip);
  textarea.addEventListener("click", showTooltipForCaret);
  textarea.addEventListener("keyup", showTooltipForCaret);
  textarea.addEventListener("select", showTooltipForCaret);
  textarea.addEventListener("keydown", onKeyDown);
  textarea.addEventListener("syntax-editor-visibility", onVisibilityChange);
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
  const paths = document.querySelector<HTMLTextAreaElement>("#paths");
  if (paths) result.push(createSyntaxEditor(paths, "directories"));
  const rules = document.querySelector<HTMLTextAreaElement>("#filenamePatterns");
  if (rules) result.push(createSyntaxEditor(rules, "routing"));
  return result;
};

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
      span.title = [
        ...new Set(activeDiagnostics.map((diagnostic) => diagnosticText(diagnostic.message))),
      ].join("\n");
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
    const lineDiagnostics = diagnostics.filter(
      (diagnostic) =>
        diagnostic.line === line.number ||
        (diagnostic.start <= line.end && diagnostic.end >= line.start),
    );
    if (lineDiagnostics.length > 0) {
      const severity = lineDiagnostics.some((diagnostic) => diagnostic.severity === "error")
        ? "error"
        : "warning";
      number.classList.add("has-diagnostic", `has-diagnostic-${severity}`);
      number.title = [
        ...new Set(lineDiagnostics.map((diagnostic) => diagnosticText(diagnostic.message))),
      ].join("\n");
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
  stage.append(overlay, textarea);
  shell.append(gutterViewport, stage);
  textarea.classList.add("syntax-editor-input");
  textarea.setAttribute("wrap", "off");

  let externalDiagnostics = pendingDiagnostics.get(textarea) ?? [];
  let snapshot = analyzeSyntax(language, textarea.value);
  let renderedDiagnostics: readonly SyntaxEditorDiagnostic[] = [];
  let characterWidth = 0;

  const syncScroll = () => {
    overlay.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
    gutter.style.transform = `translateY(${-textarea.scrollTop}px)`;
  };

  const refresh = () => {
    snapshot = analyzeSyntax(language, textarea.value);
    renderedDiagnostics = renderOverlay(overlay, snapshot, externalDiagnostics);
    renderGutter(gutter, snapshot, renderedDiagnostics);
    syncScroll();
  };

  const onInput = () => {
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
    tooltip.hidden = true;
    tooltip.textContent = "";
  };

  const onPointerMove = (event: MouseEvent) => {
    const style = getComputedStyle(textarea);
    const rect = textarea.getBoundingClientRect();
    const lineHeight = Number.parseFloat(style.lineHeight) || 24;
    const paddingTop = Number.parseFloat(style.paddingTop) || 0;
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
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
    tooltip.textContent = [
      ...new Set(diagnostics.map((diagnostic) => diagnosticText(diagnostic.message))),
    ].join("\n");
    tooltip.style.left = `${event.clientX + 12}px`;
    tooltip.style.top = `${event.clientY + 16}px`;
    tooltip.hidden = false;
  };

  const onGutterClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const start = Number(target.dataset.start);
    if (!Number.isFinite(start)) return;
    textarea.focus();
    textarea.setSelectionRange(start, start);
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
      textarea.removeEventListener("mouseleave", hideTooltip);
      gutter.removeEventListener("click", onGutterClick);
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
  textarea.addEventListener("mouseleave", hideTooltip);
  gutter.addEventListener("click", onGutterClick);
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

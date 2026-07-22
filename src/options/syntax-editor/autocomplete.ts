import { webExtensionApi } from "../../platform/web-extension-api.ts";
import { MESSAGE_TYPES } from "../../shared/constants.ts";
import { sendInternalMessage } from "../../platform/messaging.ts";
import { matcherDescription, matcherTestValue } from "../core/matcher-descriptions.ts";
import { referenceDescription } from "../core/reference-descriptions.ts";
import {
  clauseGroup,
  isLazyVariable,
  sortClauses,
  sortVariables,
  variableExample,
  variableGroup,
} from "../core/vocabulary-groups.ts";
import {
  completeDirectorySyntax,
  completeRoutingSyntax,
  type SyntaxCompletion,
} from "./syntax-editor-model.ts";
import { positionFloatingElement } from "../../shared/floating-position.ts";
import { routingActionValue } from "../../routing/action-values.ts";

export type AutocompleteStrategy = {
  match: RegExp;
  suggest: (term: string) => string[];
  insert: (prefix: string, name: string) => string;
};

export type AutocompleteResult = {
  strategy: AutocompleteStrategy;
  match: RegExpMatchArray;
  suggestions: string[];
};

type RoutingKeywords = {
  matchers: string[];
  variables: string[];
  variableValues?: Readonly<Record<string, string>>;
};

type TextField = HTMLInputElement | HTMLTextAreaElement;
const autocompleteCleanups = new WeakMap<TextField, () => void>();
let defaultVariableValues: Readonly<Record<string, string>> = {};
type AutocompleteProvider = (
  value: string,
  caret: number,
  explicit: boolean,
) => SyntaxCompletion | null;

type ActiveCompletion = {
  suggestions: readonly string[];
  selected: number;
  apply: (name: string) => { value: string; caret: number };
};

type AutocompleteOptions = {
  variableValues?: Readonly<Record<string, string>>;
};

type SuggestionDetails = {
  description: string;
  meta: string;
  placeholder: boolean;
};

const suggestionDetails = (name: string, options: AutocompleteOptions): SuggestionDetails => {
  if (!name.startsWith(":")) {
    const actionValue = routingActionValue(name);
    return {
      description: matcherDescription(name),
      meta: actionValue ?? matcherTestValue(name),
      placeholder: false,
    };
  }
  const liveValue = (options.variableValues ?? defaultVariableValues)[name] ?? "";
  return {
    description: referenceDescription("variables", name),
    meta: liveValue || (isLazyVariable(name) ? "(lazy)" : variableExample(name)),
    placeholder: !liveValue,
  };
};

// First-party autocomplete for the paths and rules textareas (replaces the
// vendored textcomplete library): suggests routing matchers and :variables:
// as you type, filtered by prefix, inserted with click/Enter/Tab.

export const matcherStrategy = (matcherList: string[]): AutocompleteStrategy => ({
  // A lowercase word at the start of a line: a routing matcher name
  match: /(^|\n)([a-z]+)$/,
  suggest: (term) => matcherList.filter((name) => name.startsWith(term)),
  insert: (prefix, name) => `${prefix}${name}: `,
});

export const routerVariableStrategy = (variableList: string[]): AutocompleteStrategy => ({
  // A :variable: being opened in an into: clause. The negative lookbehind keeps
  // the menu to the opening of a token: the ":" must not follow an alphanumeric
  // (so "v1:2" or a bare mid-word colon never triggers), then filter by prefix.
  match: /(\ninto:.*)((?<![a-zA-Z0-9]):[a-z]*)$/,
  suggest: (term) => variableList.filter((name) => name.startsWith(term)),
  insert: (prefix, name) => `${prefix}${name}`,
});

export const pathVariableStrategy = (variableList: string[]): AutocompleteStrategy => ({
  // A :variable: being opened in the paths list — same opening/prefix rule: the
  // ":" only triggers at a token boundary (start, "/", whitespace or another
  // ":"), not immediately after a letter or digit
  match: /(.*)((?<![a-zA-Z0-9]):[a-z]*)$/,
  suggest: (term) => variableList.filter((name) => name.startsWith(term)),
  insert: (prefix, name) => `${prefix}${name}`,
});

// Pure: given the text before the caret, returns the first strategy match
// with its suggestions, or null
export const suggestFor = (
  beforeCaret: string,
  strategies: AutocompleteStrategy[],
): AutocompleteResult | null => {
  for (const strategy of strategies) {
    const match = beforeCaret.match(strategy.match);
    if (match) {
      const term = match[2];
      if (term === undefined) continue;
      const suggestions = strategy.suggest(term);
      if (suggestions.length > 0) {
        return { strategy, match, suggestions };
      }
    }
  }
  return null;
};

// Styles the mirror <div> must copy from the field so wrapping, metrics and
// the caret position line up with what the browser actually renders
const MIRROR_PROPS = [
  "box-sizing",
  "width",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "font-style",
  "font-variant",
  "font-weight",
  "font-stretch",
  "font-size",
  "font-family",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-indent",
  "text-transform",
  "tab-size",
] as const;

// A <textarea>/<input> exposes no caret pixel coordinates, so mirror its text
// up to the caret into a hidden div and read where a marker span lands. Returns
// {top, left, height} relative to the field's border box.
export const caretCoordinates = (el: TextField, position: number) => {
  const isInput = el.tagName === "INPUT";
  const computed = getComputedStyle(el);
  const mirror = document.createElement("div");
  const s = mirror.style;
  s.position = "absolute";
  s.top = "0";
  s.left = "-9999px";
  s.visibility = "hidden";
  s.overflow = "hidden";
  // A textarea wraps; an input is a single non-wrapping line
  s.whiteSpace = isInput ? "pre" : "pre-wrap";
  s.wordWrap = isInput ? "normal" : "break-word";
  for (const prop of MIRROR_PROPS) {
    s.setProperty(prop, computed.getPropertyValue(prop));
  }
  document.body.appendChild(mirror);

  // Inputs can't contain newlines/tabs; normalise any stray whitespace to
  // spaces, which the mirror's white-space: pre then preserves verbatim
  const before = el.value.slice(0, position);
  mirror.textContent = isInput ? before.replaceAll(/\s/g, " ") : before;
  const marker = document.createElement("span");
  // A non-empty marker so the span has a box even at end-of-text
  marker.textContent = el.value.slice(position) || ".";
  mirror.appendChild(marker);

  const coords = {
    top: marker.offsetTop + (parseInt(computed.borderTopWidth, 10) || 0),
    left: marker.offsetLeft + (parseInt(computed.borderLeftWidth, 10) || 0),
    height: parseInt(computed.lineHeight, 10) || parseInt(computed.fontSize, 10) || 16,
  };
  mirror.remove();
  return coords;
};

// Pure: applies a chosen suggestion, returning the new value and caret
export const applySuggestion = (
  value: string,
  caret: number,
  result: AutocompleteResult,
  chosen: string,
) => {
  const beforeCaret = value.slice(0, caret);
  const start = beforeCaret.length - result.match[0].length;
  const inserted = result.strategy.insert(result.match[1] ?? "", chosen);
  const newBefore = beforeCaret.slice(0, start) + inserted;
  return {
    value: newBefore + value.slice(caret),
    caret: newBefore.length,
  };
};

export const attachAutocomplete = (
  textarea: TextField,
  source: AutocompleteStrategy[] | AutocompleteProvider,
  options: AutocompleteOptions = {},
) => {
  autocompleteCleanups.get(textarea)?.();
  const controller = new AbortController();
  const listenerOptions = { signal: controller.signal };
  const dropdown = document.createElement("ul");
  const dropdownId = `autocomplete-${textarea.id || document.querySelectorAll(".autocomplete-dropdown").length}`;
  dropdown.id = dropdownId;
  dropdown.className = "autocomplete-dropdown";
  dropdown.setAttribute("role", "listbox");
  dropdown.style.display = "none";
  document.body.appendChild(dropdown);
  textarea.setAttribute("role", "combobox");
  textarea.setAttribute("aria-autocomplete", "list");
  textarea.setAttribute("aria-controls", dropdownId);
  textarea.setAttribute("aria-expanded", "false");
  // Any press inside the dropdown (row, padding, scrollbar) must not blur the
  // field — keep focus so the list stays open and scrollable
  dropdown.addEventListener("mousedown", (e) => e.preventDefault(), listenerOptions);

  let current: ActiveCompletion | null = null;

  const completionAtCaret = (explicit: boolean): ActiveCompletion | null => {
    const caret = textarea.selectionStart ?? textarea.value.length;
    if (Array.isArray(source)) {
      const result = suggestFor(textarea.value.slice(0, caret), source);
      return result
        ? {
            suggestions: result.suggestions,
            selected: 0,
            apply: (name) => applySuggestion(textarea.value, caret, result, name),
          }
        : null;
    }
    const result = source(textarea.value, caret, explicit);
    if (!result || result.suggestions.length === 0) return null;
    return {
      suggestions: result.suggestions,
      selected: 0,
      apply: (name) => {
        const suffix = result.suggestionSuffixes?.[name] ?? result.suffix;
        return {
          value: `${textarea.value.slice(0, result.start)}${name}${suffix}${textarea.value.slice(result.end)}`,
          caret: result.start + name.length + suffix.length,
        };
      },
    };
  };

  const close = () => {
    current = null;
    dropdown.style.display = "none";
    dropdown.innerHTML = "";
    textarea.setAttribute("aria-expanded", "false");
    textarea.removeAttribute("aria-activedescendant");
  };

  const accept = (name: string) => {
    if (!current) {
      return;
    }
    const applied = current.apply(name);
    textarea.value = applied.value;
    textarea.selectionStart = applied.caret;
    textarea.selectionEnd = applied.caret;
    close();
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    textarea.focus();
  };

  const positionDropdown = () => {
    if (!current || dropdown.style.display === "none") return;
    const caret = caretCoordinates(textarea, textarea.selectionStart ?? textarea.value.length);
    const rect = textarea.getBoundingClientRect();
    const left = rect.left + caret.left - textarea.scrollLeft;
    const top = rect.top + caret.top - textarea.scrollTop;
    positionFloatingElement(
      dropdown,
      { left, right: left, top, bottom: top + caret.height },
      { prefer: "below", gap: 0 },
    );
  };

  const render = (state: ActiveCompletion) => {
    dropdown.innerHTML = "";
    let previousGroup = "";
    state.suggestions.forEach((name, i) => {
      const group = name.startsWith(":") ? variableGroup(name) : clauseGroup(name);
      if (group !== previousGroup) {
        const heading = document.createElement("li");
        heading.className = "autocomplete-group";
        heading.setAttribute("role", "presentation");
        heading.textContent = group;
        dropdown.appendChild(heading);
        previousGroup = group;
      }
      const li = document.createElement("li");
      li.id = `${dropdownId}-option-${i}`;
      li.className = "autocomplete-option";
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", i === state.selected ? "true" : "false");
      const label = document.createElement("span");
      label.className = "autocomplete-option-label";
      label.textContent = name;
      li.append(label);
      const details = suggestionDetails(name, options);
      if (details.meta) {
        const meta = document.createElement("span");
        meta.className = "autocomplete-option-meta";
        meta.classList.toggle("is-placeholder", details.placeholder);
        meta.textContent = details.meta;
        meta.title = details.meta;
        li.append(meta);
      }
      const description = document.createElement("small");
      description.className = "autocomplete-option-description";
      description.textContent = details.description;
      li.append(description);
      if (i === state.selected) {
        li.classList.add("selected");
      }
      // mousedown so the textarea keeps focus
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        accept(name);
      });
      dropdown.appendChild(li);
    });

    dropdown.style.display = "grid";
    textarea.setAttribute("aria-expanded", "true");
    textarea.setAttribute("aria-activedescendant", `${dropdownId}-option-${state.selected}`);
    positionDropdown();
    dropdown
      .querySelector<HTMLElement>(`#${dropdownId}-option-${state.selected}`)
      ?.scrollIntoView?.({ block: "nearest" });
  };

  textarea.addEventListener(
    "input",
    () => {
      const result = completionAtCaret(false);
      if (result) {
        current = result;
        render(result);
      } else {
        close();
      }
    },
    listenerOptions,
  );

  textarea.addEventListener(
    "keydown",
    (e) => {
      if (!(e instanceof KeyboardEvent)) {
        return;
      }
      const key = e.key;

      if ((e.ctrlKey || e.metaKey) && key === " ") {
        const result = completionAtCaret(true);
        if (result) {
          e.preventDefault();
          current = result;
          render(result);
        }
        return;
      }

      if (!current) return;

      if (key === "ArrowDown" || key === "ArrowUp") {
        e.preventDefault();
        const count = current.suggestions.length;
        const delta = key === "ArrowDown" ? 1 : -1;
        current.selected = (current.selected + delta + count) % count;
        render(current);
      } else if (key === "Home" || key === "End") {
        e.preventDefault();
        current.selected = key === "Home" ? 0 : current.suggestions.length - 1;
        render(current);
      } else if (key === "Enter" || key === "Tab") {
        e.preventDefault();
        const selected = current.suggestions[current.selected] as string;
        accept(selected);
      } else if (key === "Escape") {
        close();
      }
    },
    listenerOptions,
  );

  textarea.addEventListener("blur", close, listenerOptions);
  textarea.addEventListener("scroll", positionDropdown, {
    passive: true,
    signal: controller.signal,
  });
  window.addEventListener("resize", positionDropdown, listenerOptions);
  window.visualViewport?.addEventListener("resize", positionDropdown, listenerOptions);
  window.visualViewport?.addEventListener("scroll", positionDropdown, listenerOptions);
  document.addEventListener("scroll", positionDropdown, {
    capture: true,
    passive: true,
    signal: controller.signal,
  });

  // A press anywhere else — outside both the field and its dropdown — dismisses
  // the list (belt-and-suspenders with blur, and covers non-focus-stealing
  // targets). Presses inside the dropdown are ignored above, so this never
  // races the item-accept handler.
  document.addEventListener(
    "mousedown",
    (e) => {
      const target = e.target;
      if (
        !current ||
        target === textarea ||
        (target instanceof Node && dropdown.contains(target))
      ) {
        return;
      }
      close();
    },
    listenerOptions,
  );

  const cleanup = () => {
    // abort() and remove() are idempotent and own only this instance's
    // resources. The map identity check is the real guard: a caller-retained
    // stale handle, run again after a replacement instance attached to the
    // same field, must not tear down the replacement's ARIA wiring.
    controller.abort();
    dropdown.remove();
    if (autocompleteCleanups.get(textarea) !== cleanup) return;
    autocompleteCleanups.delete(textarea);
    textarea.removeAttribute("role");
    textarea.removeAttribute("aria-autocomplete");
    textarea.removeAttribute("aria-controls");
    textarea.removeAttribute("aria-expanded");
    textarea.removeAttribute("aria-activedescendant");
  };
  autocompleteCleanups.set(textarea, cleanup);
  return cleanup;
};

export const setupRoutingAutocomplete = (keywords: RoutingKeywords) => {
  const variables = sortVariables(keywords.variables);
  const matchers = sortClauses([
    ...keywords.matchers,
    "into",
    "fetch",
    "rename",
    "capture",
    "capturegroups",
    "exclude",
    "tab",
  ]);
  const options: AutocompleteOptions = keywords.variableValues
    ? { variableValues: keywords.variableValues }
    : {};
  const pathTextarea = document.getElementById("paths");
  if (pathTextarea instanceof HTMLTextAreaElement) {
    attachAutocomplete(
      pathTextarea,
      (value, caret) => completeDirectorySyntax(value, caret, variables),
      options,
    );
  }

  const routerTextarea = document.getElementById("filenamePatterns");
  if (routerTextarea instanceof HTMLTextAreaElement) {
    attachAutocomplete(
      routerTextarea,
      (value, caret, explicit) =>
        completeRoutingSyntax(value, caret, { matchers, variables }, explicit),
      options,
    );
  }

  // The quick-add builder's destination field is a plain path, so it gets
  // the same :variable: autocomplete as the paths list
  const ruleBuilderInto = document.getElementById("rule-builder-into");
  if (ruleBuilderInto instanceof HTMLInputElement) {
    attachAutocomplete(
      ruleBuilderInto,
      (value, caret) => completeDirectorySyntax(value, caret, variables),
      options,
    );
  }
};

sendInternalMessage(webExtensionApi.runtime, { type: MESSAGE_TYPES.GET_KEYWORDS })
  .then(async (response) => {
    if (!("matchers" in response.body) || !("variables" in response.body)) {
      throw new Error("Keyword lookup failed");
    }
    const routes = await sendInternalMessage(webExtensionApi.runtime, {
      type: MESSAGE_TYPES.CHECK_ROUTES,
    }).catch(() => null);
    const interpolated =
      routes && "interpolatedVariables" in routes.body
        ? routes.body.interpolatedVariables
        : undefined;
    const variableValues =
      typeof interpolated === "object" && interpolated !== null && !Array.isArray(interpolated)
        ? Object.fromEntries(
            Object.entries(interpolated).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          )
        : {};
    defaultVariableValues = variableValues;
    return { ...response.body, variableValues };
  })
  .then(setupRoutingAutocomplete)
  .catch(() => {});

import { webExtensionApi } from "../platform/web-extension-api.ts";
import { MESSAGE_TYPES } from "../shared/constants.ts";
import { sendInternalMessage } from "../shared/message-protocol.ts";
import { sortClauses, sortVariables, variableGroup } from "./vocabulary-groups.ts";

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
};

type TextField = HTMLInputElement | HTMLTextAreaElement;

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

export const attachAutocomplete = (textarea: TextField, strategies: AutocompleteStrategy[]) => {
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
  dropdown.addEventListener("mousedown", (e) => e.preventDefault());

  let current: { result: AutocompleteResult; selected: number } | null = null;

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
    const caret = textarea.selectionStart ?? textarea.value.length;
    const applied = applySuggestion(textarea.value, caret, current.result, name);
    textarea.value = applied.value;
    textarea.selectionStart = applied.caret;
    textarea.selectionEnd = applied.caret;
    close();
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    textarea.focus();
  };

  const render = () => {
    if (!current) {
      return;
    }
    const state = current;
    dropdown.innerHTML = "";
    let previousGroup = "";
    state.result.suggestions.forEach((name, i) => {
      if (name.startsWith(":")) {
        const group = variableGroup(name);
        if (group !== previousGroup) {
          const heading = document.createElement("li");
          heading.className = "autocomplete-group";
          heading.setAttribute("role", "presentation");
          heading.textContent = group;
          dropdown.appendChild(heading);
          previousGroup = group;
        }
      }
      const li = document.createElement("li");
      li.id = `${dropdownId}-option-${i}`;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", i === state.selected ? "true" : "false");
      li.textContent = name;
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

    // Anchor to the caret, not the whole field: measure where the caret sits,
    // add the field's on-screen position, and undo the field's own scroll
    const caret = caretCoordinates(textarea, textarea.selectionStart ?? textarea.value.length);
    const rect = textarea.getBoundingClientRect();
    const caretLeft = rect.left + window.scrollX + caret.left - textarea.scrollLeft;
    const caretTop = rect.top + window.scrollY + caret.top - textarea.scrollTop;

    dropdown.style.display = "block";
    textarea.setAttribute("aria-expanded", "true");
    textarea.setAttribute("aria-activedescendant", `${dropdownId}-option-${state.selected}`);
    dropdown.style.left = "0";
    dropdown.style.top = "0";
    // offsetWidth/Height need the box laid out, so measure after display:block
    const viewportRight = window.scrollX + document.documentElement.clientWidth;
    const viewportBottom = window.scrollY + document.documentElement.clientHeight;
    const left = Math.max(
      window.scrollX,
      Math.min(caretLeft, viewportRight - dropdown.offsetWidth - 8),
    );
    // Drop below the caret line; flip above it if that would clip the viewport
    const below = caretTop + caret.height;
    const top =
      below + dropdown.offsetHeight > viewportBottom &&
      caretTop - dropdown.offsetHeight > window.scrollY
        ? caretTop - dropdown.offsetHeight
        : below;
    dropdown.style.left = `${left}px`;
    dropdown.style.top = `${top}px`;
  };

  textarea.addEventListener("input", () => {
    const selectionStart = textarea.selectionStart ?? textarea.value.length;
    const result = suggestFor(textarea.value.slice(0, selectionStart), strategies);
    if (result) {
      current = { result, selected: 0 };
      render();
    } else {
      close();
    }
  });

  textarea.addEventListener("keydown", (e) => {
    if (!(e instanceof KeyboardEvent) || !current) {
      return;
    }
    const key = (e as KeyboardEvent).key;

    if (key === "ArrowDown" || key === "ArrowUp") {
      e.preventDefault();
      const count = current.result.suggestions.length;
      const delta = key === "ArrowDown" ? 1 : -1;
      current.selected = (current.selected + delta + count) % count;
      render();
    } else if (key === "Home" || key === "End") {
      e.preventDefault();
      current.selected = key === "Home" ? 0 : current.result.suggestions.length - 1;
      render();
    } else if (key === "Enter" || key === "Tab") {
      e.preventDefault();
      const suggestion = current.result.suggestions[current.selected];
      if (suggestion !== undefined) accept(suggestion);
    } else if (key === "Escape") {
      close();
    }
  });

  textarea.addEventListener("blur", close);

  // A press anywhere else — outside both the field and its dropdown — dismisses
  // the list (belt-and-suspenders with blur, and covers non-focus-stealing
  // targets). Presses inside the dropdown are ignored above, so this never
  // races the item-accept handler.
  document.addEventListener("mousedown", (e) => {
    const target = e.target;
    if (!current || target === textarea || (target instanceof Node && dropdown.contains(target))) {
      return;
    }
    close();
  });
};

export const setupRoutingAutocomplete = (keywords: RoutingKeywords) => {
  const variables = sortVariables(keywords.variables);
  const matchers = sortClauses([...keywords.matchers, "into"]);
  const pathTextarea = document.getElementById("paths");
  if (pathTextarea instanceof HTMLTextAreaElement) {
    attachAutocomplete(pathTextarea, [pathVariableStrategy(variables)]);
  }

  const routerTextarea = document.getElementById("filenamePatterns");
  if (routerTextarea instanceof HTMLTextAreaElement) {
    attachAutocomplete(routerTextarea, [
      matcherStrategy(matchers),
      routerVariableStrategy(variables),
    ]);
  }

  // The quick-add builder's destination field is a plain path, so it gets
  // the same :variable: autocomplete as the paths list
  const ruleBuilderInto = document.getElementById("rule-builder-into");
  if (ruleBuilderInto instanceof HTMLInputElement) {
    attachAutocomplete(ruleBuilderInto, [pathVariableStrategy(variables)]);
  }
};

sendInternalMessage(webExtensionApi.runtime, { type: MESSAGE_TYPES.GET_KEYWORDS })
  .then((response) => {
    if (!("matchers" in response.body) || !("variables" in response.body)) {
      throw new Error("Keyword lookup failed");
    }
    return response.body;
  })
  .then(setupRoutingAutocomplete)
  .catch(() => {});

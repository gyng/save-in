// First-party autocomplete for the paths and rules textareas (replaces the
// vendored textcomplete library): suggests routing matchers and :variables:
// as you type, filtered by prefix, inserted with click/Enter/Tab.

const matcherStrategy = (matcherList) => ({
  // A lowercase word at the start of a line: a routing matcher name
  match: /(^|\n)([a-z]+)$/,
  suggest: (term) => matcherList.filter((name) => name.startsWith(term)),
  insert: (prefix, name) => `${prefix}${name}: `,
});

const routerVariableStrategy = (variableList) => ({
  // A :variable: being opened in an into: clause. The negative lookbehind keeps
  // the menu to the opening of a token: the ":" must not follow an alphanumeric
  // (so "v1:2" or a bare mid-word colon never triggers), then filter by prefix.
  match: /(\ninto:.*)((?<![a-zA-Z0-9]):[a-z]*)$/,
  suggest: (term) => variableList.filter((name) => name.startsWith(term)),
  insert: (prefix, name) => `${prefix}${name}`,
});

const pathVariableStrategy = (variableList) => ({
  // A :variable: being opened in the paths list — same opening/prefix rule: the
  // ":" only triggers at a token boundary (start, "/", whitespace or another
  // ":"), not immediately after a letter or digit
  match: /(.*)((?<![a-zA-Z0-9]):[a-z]*)$/,
  suggest: (term) => variableList.filter((name) => name.startsWith(term)),
  insert: (prefix, name) => `${prefix}${name}`,
});

// Pure: given the text before the caret, returns the first strategy match
// with its suggestions, or null
const suggestFor = (beforeCaret, strategies) => {
  for (const strategy of strategies) {
    const match = beforeCaret.match(strategy.match);
    if (match) {
      const suggestions = strategy.suggest(match[2]);
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
  "boxSizing",
  "width",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "fontFamily",
  "lineHeight",
  "letterSpacing",
  "wordSpacing",
  "textIndent",
  "textTransform",
  "tabSize",
];

// A <textarea>/<input> exposes no caret pixel coordinates, so mirror its text
// up to the caret into a hidden div and read where a marker span lands. Returns
// {top, left, height} relative to the field's border box.
const caretCoordinates = (el, position) => {
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
    s[prop] = computed[prop];
  }
  document.body.appendChild(mirror);

  // Inputs can't contain newlines/tabs; normalise any stray whitespace to
  // spaces, which the mirror's white-space: pre then preserves verbatim
  const before = el.value.slice(0, position);
  mirror.textContent = isInput ? before.replaceAll(/\s/g, " ") : before;
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
const applySuggestion = (value, caret, result, chosen) => {
  const beforeCaret = value.slice(0, caret);
  const start = beforeCaret.length - result.match[0].length;
  const inserted = result.strategy.insert(result.match[1], chosen);
  const newBefore = beforeCaret.slice(0, start) + inserted;
  return {
    value: newBefore + value.slice(caret),
    caret: newBefore.length,
  };
};

const attachAutocomplete = (textarea, strategies) => {
  const dropdown = document.createElement("ul");
  dropdown.className = "autocomplete-dropdown";
  dropdown.style.display = "none";
  document.body.appendChild(dropdown);
  // Any press inside the dropdown (row, padding, scrollbar) must not blur the
  // field — keep focus so the list stays open and scrollable
  dropdown.addEventListener("mousedown", (e) => e.preventDefault());

  let current = null; // { result, selected }

  const close = () => {
    current = null;
    dropdown.style.display = "none";
    dropdown.innerHTML = "";
  };

  const accept = (name) => {
    const applied = applySuggestion(textarea.value, textarea.selectionStart, current.result, name);
    textarea.value = applied.value;
    textarea.selectionStart = applied.caret;
    textarea.selectionEnd = applied.caret;
    close();
    textarea.focus();
  };

  const render = () => {
    dropdown.innerHTML = "";
    current.result.suggestions.forEach((name, i) => {
      const li = document.createElement("li");
      li.textContent = name;
      if (i === current.selected) {
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
    const caret = caretCoordinates(textarea, textarea.selectionStart);
    const rect = textarea.getBoundingClientRect();
    const caretLeft = rect.left + window.scrollX + caret.left - textarea.scrollLeft;
    const caretTop = rect.top + window.scrollY + caret.top - textarea.scrollTop;

    dropdown.style.display = "block";
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
    const result = suggestFor(textarea.value.slice(0, textarea.selectionStart), strategies);
    if (result) {
      current = { result, selected: 0 };
      render();
    } else {
      close();
    }
  });

  textarea.addEventListener("keydown", (e) => {
    if (!current) {
      return;
    }

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const count = current.result.suggestions.length;
      const delta = e.key === "ArrowDown" ? 1 : -1;
      current.selected = (current.selected + delta + count) % count;
      render();
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      accept(current.result.suggestions[current.selected]);
    } else if (e.key === "Escape") {
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

const setupRoutingAutocomplete = (keywords) => {
  const pathTextarea = document.getElementById("paths");
  if (pathTextarea) {
    attachAutocomplete(pathTextarea, [pathVariableStrategy(keywords.variables)]);
  }

  const routerTextarea = document.getElementById("filenamePatterns");
  if (routerTextarea) {
    attachAutocomplete(routerTextarea, [
      matcherStrategy([...keywords.matchers, "into"].sort()),
      routerVariableStrategy(keywords.variables),
    ]);
  }

  // The quick-add builder's destination field is a plain path, so it gets
  // the same :variable: autocomplete as the paths list
  const ruleBuilderInto = document.getElementById("rule-builder-into");
  if (ruleBuilderInto) {
    attachAutocomplete(ruleBuilderInto, [pathVariableStrategy(keywords.variables)]);
  }
};

if (typeof browser !== "undefined" && browser.runtime && browser.runtime.sendMessage) {
  browser.runtime
    .sendMessage({ type: "GET_KEYWORDS" })
    .then((res) => res.body)
    .then((keywords) =>
      setupRoutingAutocomplete({
        matchers: keywords.matchers.sort(),
        variables: keywords.variables.sort(),
      }),
    )
    .catch(() => {});
}

// Export for testing
if (typeof module !== "undefined") {
  module.exports = {
    matcherStrategy,
    routerVariableStrategy,
    pathVariableStrategy,
    suggestFor,
    caretCoordinates,
    applySuggestion,
    attachAutocomplete,
    setupRoutingAutocomplete,
  };
}

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
  // A :variable: being typed in an into: clause
  match: /(\ninto:.*)(:[a-z]*)$/,
  suggest: (term) => variableList.filter((name) => name.startsWith(term)),
  insert: (prefix, name) => `${prefix}${name}`,
});

const pathVariableStrategy = (variableList) => ({
  // A :variable: being typed anywhere in the paths list
  match: /(.*)(:[a-z]+)$/,
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

    const rect = textarea.getBoundingClientRect();
    dropdown.style.left = `${rect.left + window.scrollX}px`;
    dropdown.style.top = `${rect.bottom + window.scrollY}px`;
    dropdown.style.minWidth = `${rect.width / 2}px`;
    dropdown.style.display = "block";
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
    applySuggestion,
    attachAutocomplete,
    setupRoutingAutocomplete,
  };
}

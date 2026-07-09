const Autocomplete = (await import("../src/options/autocomplete.js")).default;

const {
  matcherStrategy,
  routerVariableStrategy,
  pathVariableStrategy,
  suggestFor,
  applySuggestion,
  attachAutocomplete,
} = Autocomplete;

const VARIABLES = [":date:", ":day:", ":pagetitle:"];
const MATCHERS = ["fileext", "filename", "into"];

describe("suggestFor", () => {
  test("suggests variables for a :prefix in the paths box", () => {
    const result = suggestFor("images/:d", [pathVariableStrategy(VARIABLES)]);
    expect(result.suggestions).toEqual([":date:", ":day:"]);
  });

  test("suggests matchers at the start of a rule line", () => {
    const result = suggestFor("some: rule\nfile", [matcherStrategy(MATCHERS)]);
    expect(result.suggestions).toEqual(["fileext", "filename"]);
  });

  test("suggests variables inside an into: clause", () => {
    const result = suggestFor("filename: x\ninto: dir/:pa", [routerVariableStrategy(VARIABLES)]);
    expect(result.suggestions).toEqual([":pagetitle:"]);
  });

  test("returns null when nothing matches", () => {
    expect(suggestFor("plain text ", [pathVariableStrategy(VARIABLES)])).toBeNull();
    expect(suggestFor("images/:zz", [pathVariableStrategy(VARIABLES)])).toBeNull();
  });

  test("falls through to later strategies", () => {
    const result = suggestFor("filename: x\ninto: :d", [
      matcherStrategy(MATCHERS),
      routerVariableStrategy(VARIABLES),
    ]);
    expect(result.suggestions).toEqual([":date:", ":day:"]);
  });
});

describe("applySuggestion", () => {
  test("replaces the typed prefix with the chosen variable", () => {
    const value = "images/:d\nvideos";
    const result = suggestFor("images/:d", [pathVariableStrategy(VARIABLES)]);
    const applied = applySuggestion(value, 9, result, ":date:");

    expect(applied.value).toBe("images/:date:\nvideos");
    expect(applied.caret).toBe(13);
  });

  test("appends ': ' when completing a matcher", () => {
    const value = "fil";
    const result = suggestFor(value, [matcherStrategy(MATCHERS)]);
    const applied = applySuggestion(value, 3, result, "fileext");

    expect(applied.value).toBe("fileext: ");
    expect(applied.caret).toBe(9);
  });
});

describe("attachAutocomplete", () => {
  let textarea;

  const type = (value) => {
    textarea.value = value;
    textarea.selectionStart = value.length;
    textarea.selectionEnd = value.length;
    textarea.dispatchEvent(new window.InputEvent("input", { bubbles: true }));
  };

  const key = (k) => {
    textarea.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, cancelable: true }));
  };

  const dropdown = () => document.querySelector(".autocomplete-dropdown");

  beforeEach(() => {
    document.body.innerHTML = '<textarea id="ta"></textarea>';
    textarea = document.getElementById("ta");
    attachAutocomplete(textarea, [pathVariableStrategy(VARIABLES)]);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("opens with suggestions on input and closes when nothing matches", () => {
    type("a/:d");
    expect(dropdown().style.display).toBe("block");
    expect(dropdown().textContent).toBe(":date::day:");

    type("a/");
    expect(dropdown().style.display).toBe("none");
  });

  test("Enter inserts the selected suggestion", () => {
    type("a/:d");
    key("Enter");

    expect(textarea.value).toBe("a/:date:");
    expect(textarea.selectionStart).toBe(8);
    expect(dropdown().style.display).toBe("none");
  });

  test("arrow keys cycle the selection", () => {
    type("a/:d");
    key("ArrowDown");
    key("Enter");
    expect(textarea.value).toBe("a/:day:");

    type("a/:d");
    key("ArrowUp"); // wraps to the last entry
    key("Tab");
    expect(textarea.value).toBe("a/:day:");
  });

  test("Escape and blur close the dropdown", () => {
    type("a/:d");
    key("Escape");
    expect(dropdown().style.display).toBe("none");

    type("a/:d");
    textarea.dispatchEvent(new window.FocusEvent("blur"));
    expect(dropdown().style.display).toBe("none");
  });

  test("mousedown on an entry inserts it", () => {
    type("a/:d");
    const first = dropdown().querySelector("li");
    first.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(textarea.value).toBe("a/:date:");
  });

  test("keystrokes with no dropdown open are ignored", () => {
    key("Enter");
    expect(textarea.value).toBe("");
  });
});

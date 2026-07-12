import * as Autocomplete from "../src/options/autocomplete.ts";

const {
  matcherStrategy,
  routerVariableStrategy,
  pathVariableStrategy,
  suggestFor,
  caretCoordinates,
  applySuggestion,
  attachAutocomplete,
  setupRoutingAutocomplete,
} = Autocomplete;

const VARIABLES = [":date:", ":day:", ":pagetitle:"];
const MATCHERS = ["fileext", "filename", "into"];

describe("suggestFor", () => {
  test("suggests variables for a :prefix in the paths box", () => {
    const result = suggestFor("images/:d", [pathVariableStrategy(VARIABLES)]);
    expect(result!.suggestions).toEqual([":date:", ":day:"]);
  });

  test("suggests matchers at the start of a rule line", () => {
    const result = suggestFor("some: rule\nfile", [matcherStrategy(MATCHERS)]);
    expect(result!.suggestions).toEqual(["fileext", "filename"]);
  });

  test("suggests variables inside an into: clause", () => {
    const result = suggestFor("filename: x\ninto: dir/:pa", [routerVariableStrategy(VARIABLES)]);
    expect(result!.suggestions).toEqual([":pagetitle:"]);
  });

  test("returns null when nothing matches", () => {
    expect(suggestFor("plain text ", [pathVariableStrategy(VARIABLES)])).toBeNull();
    expect(suggestFor("images/:zz", [pathVariableStrategy(VARIABLES)])).toBeNull();
  });

  test("opens on a bare colon at a token boundary (the opening)", () => {
    // start of a segment: after "/", after whitespace, and at line start
    expect(suggestFor("images/:", [pathVariableStrategy(VARIABLES)])!.suggestions).toEqual(
      VARIABLES,
    );
    expect(suggestFor("a :", [pathVariableStrategy(VARIABLES)])!.suggestions).toEqual(VARIABLES);
    expect(suggestFor("x\n:", [pathVariableStrategy(VARIABLES)])!.suggestions).toEqual(VARIABLES);
  });

  test("does not open on a colon that follows a letter or digit", () => {
    expect(suggestFor("notes:d", [pathVariableStrategy(VARIABLES)])).toBeNull();
    expect(suggestFor("2024:d", [pathVariableStrategy(VARIABLES)])).toBeNull();
    expect(suggestFor("into: v1:2:d", [routerVariableStrategy(VARIABLES)])).toBeNull();
  });

  test("falls through to later strategies", () => {
    const result = suggestFor("filename: x\ninto: :d", [
      matcherStrategy(MATCHERS),
      routerVariableStrategy(VARIABLES),
    ]);
    expect(result!.suggestions).toEqual([":date:", ":day:"]);
  });
});

describe("applySuggestion", () => {
  test("replaces the typed prefix with the chosen variable", () => {
    const value = "images/:d\nvideos";
    const result = suggestFor("images/:d", [pathVariableStrategy(VARIABLES)]);
    const applied = applySuggestion(value, 9, result!, ":date:");

    expect(applied.value).toBe("images/:date:\nvideos");
    expect(applied.caret).toBe(13);
  });

  test("appends ': ' when completing a matcher", () => {
    const value = "fil";
    const result = suggestFor(value, [matcherStrategy(MATCHERS)]);
    const applied = applySuggestion(value, 3, result!, "fileext");

    expect(applied.value).toBe("fileext: ");
    expect(applied.caret).toBe(9);
  });
});

describe("caretCoordinates", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  // jsdom has no layout engine, so offsets are 0; this only guards the shape,
  // that it doesn't throw, and that the measuring mirror is cleaned up
  test("returns finite coordinates and leaves no mirror behind", () => {
    document.body.innerHTML = '<textarea id="ta">images/:d</textarea>';
    const ta = document.getElementById("ta") as HTMLTextAreaElement;
    ta.value = "images/:d";
    const coords = caretCoordinates(ta, ta.value.length);

    expect(Number.isFinite(coords.top)).toBe(true);
    expect(Number.isFinite(coords.left)).toBe(true);
    expect(coords.height).toBeGreaterThan(0);
    // only the textarea remains — the hidden mirror div was removed
    expect(document.querySelectorAll("div").length).toBe(0);
  });

  test("also measures single-line inputs", () => {
    document.body.innerHTML = '<input type="text" id="in" />';
    const input = document.getElementById("in") as HTMLInputElement;
    input.value = "docs/:d";
    expect(() => caretCoordinates(input, input.value.length)).not.toThrow();
    expect(document.querySelectorAll("div").length).toBe(0);
  });
});

describe("attachAutocomplete", () => {
  let textarea: HTMLTextAreaElement;

  const type = (value: string) => {
    textarea.value = value;
    textarea.selectionStart = value.length;
    textarea.selectionEnd = value.length;
    textarea.dispatchEvent(new window.InputEvent("input", { bubbles: true }));
  };

  const key = (k: string) => {
    textarea.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, cancelable: true }));
  };

  const dropdown = () => document.querySelector(".autocomplete-dropdown") as HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<textarea id="ta"></textarea>';
    textarea = document.getElementById("ta") as HTMLTextAreaElement;
    attachAutocomplete(textarea, [pathVariableStrategy(VARIABLES)]);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("opens with suggestions on input and closes when nothing matches", () => {
    type("a/:d");
    expect(dropdown().style.display).toBe("block");
    expect(dropdown().textContent).toBe("Date and time:date::day:");
    expect(dropdown().querySelector(".autocomplete-group")?.textContent).toBe("Date and time");
    expect(textarea.getAttribute("role")).toBe("combobox");
    expect(textarea.getAttribute("aria-expanded")).toBe("true");
    expect(textarea.getAttribute("aria-controls")).toBe(dropdown().id);
    expect(dropdown().getAttribute("role")).toBe("listbox");
    expect(dropdown().querySelector('[role="option"]')?.getAttribute("role")).toBe("option");
    expect(textarea.getAttribute("aria-activedescendant")).toBe(
      dropdown().querySelector<HTMLElement>('[role="option"]')?.id,
    );

    type("a/");
    expect(dropdown().style.display).toBe("none");
    expect(textarea.getAttribute("aria-expanded")).toBe("false");
    expect(textarea.hasAttribute("aria-activedescendant")).toBe(false);
  });

  test("Enter inserts the selected suggestion", () => {
    const input = vi.fn();
    textarea.addEventListener("input", input);
    type("a/:d");
    input.mockClear();
    key("Enter");

    expect(textarea.value).toBe("a/:date:");
    expect(textarea.selectionStart).toBe(8);
    expect(dropdown().style.display).toBe("none");
    expect(input).toHaveBeenCalledOnce();
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

  test("Home and End select the first and last suggestion", () => {
    type("a/:d");
    key("End");
    key("Enter");
    expect(textarea.value).toBe("a/:day:");

    type("a/:d");
    key("End");
    key("Home");
    key("Enter");
    expect(textarea.value).toBe("a/:date:");
  });

  test("Escape and blur close the dropdown", () => {
    type("a/:d");
    key("Escape");
    expect(dropdown().style.display).toBe("none");

    type("a/:d");
    textarea.dispatchEvent(new window.FocusEvent("blur"));
    expect(dropdown().style.display).toBe("none");
  });

  test("a press outside the field and dropdown closes it", () => {
    type("a/:d");
    expect(dropdown().style.display).toBe("block");

    document.body.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    expect(dropdown().style.display).toBe("none");
  });

  test("a press inside the dropdown keeps it open", () => {
    type("a/:d");
    dropdown().dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    expect(dropdown().style.display).toBe("block");
  });

  test("mousedown on an entry inserts it", () => {
    type("a/:d");
    const first = dropdown().querySelector('[role="option"]');
    first!.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(textarea.value).toBe("a/:date:");
  });

  test("keystrokes with no dropdown open are ignored", () => {
    key("Enter");
    expect(textarea.value).toBe("");
  });
});

describe("setupRoutingAutocomplete wiring", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("attaches variable autocomplete to the quick-add into: input", () => {
    document.body.innerHTML = `<input type="text" id="rule-builder-into" />`;
    setupRoutingAutocomplete({ matchers: ["fileext"], variables: [":date:", ":day:"] });

    const input = document.getElementById("rule-builder-into") as HTMLInputElement;
    input.value = "docs/:d";
    input.selectionStart = input.value.length;
    input.dispatchEvent(new window.InputEvent("input", { bubbles: true }));

    const dropdown = document.querySelector(".autocomplete-dropdown") as HTMLElement;
    expect(dropdown.style.display).toBe("block");
    expect([...dropdown.querySelectorAll('[role="option"]')].map((li) => li.textContent)).toEqual([
      ":date:",
      ":day:",
    ]);
  });
});

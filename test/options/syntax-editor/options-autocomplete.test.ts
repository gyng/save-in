// @vitest-environment jsdom
import * as Autocomplete from "../../../src/options/syntax-editor/autocomplete.ts";

const { pathVariableStrategy, caretCoordinates, attachAutocomplete, setupRoutingAutocomplete } =
  Autocomplete;

const VARIABLES = [":date:", ":day:", ":pagetitle:"];

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
  let cleanup: () => void;

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
    cleanup = attachAutocomplete(textarea, [pathVariableStrategy(VARIABLES)]);
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  test("opens with suggestions on input and closes when nothing matches", () => {
    type("a/:d");
    expect(dropdown().querySelector(".autocomplete-group")?.textContent).toBe("Date and time");
    expect(
      [...dropdown().querySelectorAll(".autocomplete-option-label")].map(
        (label) => label.textContent,
      ),
    ).toEqual([":date:", ":day:"]);
    expect(textarea.getAttribute("role")).toBe("combobox");
    expect(textarea.getAttribute("aria-expanded")).toBe("true");
    expect(textarea.getAttribute("aria-controls")).toBe(dropdown().id);
    expect(dropdown().getAttribute("role")).toBe("listbox");
    expect(dropdown().querySelector('[role="option"]')?.getAttribute("role")).toBe("option");
    expect(textarea.getAttribute("aria-activedescendant")).toBe(
      dropdown().querySelector<HTMLElement>('[role="option"]')?.id,
    );

    type("a/");
    expect(textarea.getAttribute("aria-expanded")).toBe("false");
    expect(textarea.hasAttribute("aria-activedescendant")).toBe(false);
  });

  test("uses reference rows with current values, examples, and descriptions", () => {
    cleanup();
    document.body.insertAdjacentHTML(
      "beforeend",
      `<section id="options-reference-variables"><table><tbody>
        <tr><td><code>:date:</code></td><td>2026-07-15</td><td>Current date</td></tr>
        <tr><td><code>:day:</code></td><td>15</td><td>Day of the month</td></tr>
      </tbody></table></section>`,
    );
    cleanup = attachAutocomplete(textarea, [pathVariableStrategy(VARIABLES)], {
      variableValues: { ":date:": "2030-12-31" },
    });

    type("a/:d");
    const options = [...dropdown().querySelectorAll<HTMLElement>('[role="option"]')];
    expect(options).toHaveLength(2);
    expect(options[0]?.querySelector(".autocomplete-option-label")?.textContent).toBe(":date:");
    expect(options[0]?.querySelector(".autocomplete-option-meta")?.textContent).toBe("2030-12-31");
    expect(options[0]?.querySelector(".autocomplete-option-meta")?.getAttribute("title")).toBe(
      "2030-12-31",
    );
    expect(options[0]?.querySelector(".autocomplete-option-description")?.textContent).toBe(
      "Current date",
    );
    expect(options[0]?.querySelector(".autocomplete-option-meta")?.classList).not.toContain(
      "is-placeholder",
    );
    expect(options[1]?.querySelector(".autocomplete-option-meta")?.textContent).toBe("07");
    expect(options[1]?.querySelector(".autocomplete-option-meta")?.classList).toContain(
      "is-placeholder",
    );
  });

  test("Enter inserts the selected suggestion", () => {
    const input = vi.fn();
    textarea.addEventListener("input", input);
    type("a/:d");
    input.mockClear();
    key("Enter");

    expect(textarea.value).toBe("a/:date:");
    expect(textarea.selectionStart).toBe(8);
    expect(textarea.getAttribute("aria-expanded")).toBe("false");
    expect(input).toHaveBeenCalledOnce();
  });

  test("re-attaching replaces the previous completion instead of duplicating insertion", () => {
    cleanup = attachAutocomplete(textarea, [pathVariableStrategy(VARIABLES)]);
    type("into: :d");
    key("Enter");

    expect(textarea.value).toBe("into: :date:");
    expect(document.querySelectorAll(".autocomplete-dropdown")).toHaveLength(1);
  });

  test("cleanup is idempotent", () => {
    cleanup();
    cleanup();
    expect(document.querySelector(".autocomplete-dropdown")).toBeNull();
  });

  test("a stale retained cleanup does not tear down a replacement instance's ARIA wiring", () => {
    const stale = cleanup;
    cleanup = attachAutocomplete(textarea, [pathVariableStrategy(VARIABLES)]);
    stale();

    expect(textarea.getAttribute("role")).toBe("combobox");
    expect(textarea.getAttribute("aria-autocomplete")).toBe("list");
    type("a/:d");
    key("Enter");
    expect(textarea.value).toBe("a/:date:");

    cleanup();
    expect(textarea.getAttribute("role")).toBeNull();
    expect(textarea.getAttribute("aria-autocomplete")).toBeNull();
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
    key("a");
    expect(textarea.getAttribute("aria-expanded")).toBe("true");
    key("Escape");
    expect(textarea.getAttribute("aria-expanded")).toBe("false");

    type("a/:d");
    textarea.dispatchEvent(new window.FocusEvent("blur"));
    expect(textarea.getAttribute("aria-expanded")).toBe("false");
  });

  test("a press outside the field and dropdown closes it", () => {
    type("a/:d");
    expect(textarea.getAttribute("aria-expanded")).toBe("true");

    document.body.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    expect(textarea.getAttribute("aria-expanded")).toBe("false");
  });

  test("a press inside the dropdown keeps it open", () => {
    type("a/:d");
    dropdown().dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    expect(textarea.getAttribute("aria-expanded")).toBe("true");
  });

  test("mousedown on an entry inserts it", () => {
    type("a/:d");
    const first = dropdown().querySelector('[role="option"]');
    first!.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(textarea.value).toBe("a/:date:");
  });

  test("keystrokes with no dropdown open are ignored", () => {
    window.dispatchEvent(new Event("resize"));
    key("Enter");
    expect(textarea.value).toBe("");
  });

  test("ignores stale option events after the completion has closed", () => {
    type("a/:d");
    const staleOption = dropdown().querySelector<HTMLElement>('[role="option"]')!;
    type("plain");
    staleOption.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(textarea.value).toBe("plain");
  });

  test("contains non-keyboard events and empty explicit completions", () => {
    textarea.dispatchEvent(new Event("keydown", { bubbles: true }));
    expect(textarea.value).toBe("");

    document.body.innerHTML = '<textarea id="empty"></textarea>';
    const empty = document.querySelector("textarea")!;
    attachAutocomplete(empty, () => ({ suggestions: [], start: 0, end: 0, suffix: "" }));
    empty.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", ctrlKey: true, cancelable: true }),
    );
    empty.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
    empty.dispatchEvent(new KeyboardEvent("keydown", { key: "a", cancelable: true }));
    expect(empty.value).toBe("");
    expect(empty.getAttribute("aria-expanded")).toBe("false");
  });

  test("keeps explicit completion closed when the provider has no result", () => {
    document.body.innerHTML = '<textarea id="none"></textarea>';
    const none = document.querySelector("textarea")!;
    attachAutocomplete(none, () => null);
    none.dispatchEvent(new KeyboardEvent("keydown", { key: " ", metaKey: true, cancelable: true }));
    expect(none.getAttribute("aria-expanded")).toBe("false");
  });

  test("uses fallback IDs and caret positions and flips a clipped menu above", () => {
    document.body.innerHTML = "<textarea></textarea>";
    const anonymous = document.querySelector("textarea")!;
    Object.defineProperty(anonymous, "selectionStart", { configurable: true, value: null });
    anonymous.getBoundingClientRect = () =>
      ({ left: 0, top: 100, right: 100, bottom: 120, width: 100, height: 20 }) as DOMRect;
    Object.defineProperty(document.documentElement, "clientHeight", {
      configurable: true,
      value: 110,
    });
    attachAutocomplete(anonymous, [pathVariableStrategy(VARIABLES)]);
    const menu = document.querySelector<HTMLElement>(".autocomplete-dropdown")!;
    menu.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20 }) as DOMRect;
    anonymous.value = ":d";
    anonymous.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(anonymous.getAttribute("aria-controls")).toBe("autocomplete-0");
    expect(menu.style.top).toBe("80px");
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
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(
      [...dropdown.querySelectorAll(".autocomplete-option-label")].map(
        (label) => label.textContent,
      ),
    ).toEqual([":date:", ":day:"]);
  });

  test("uses routing grammar context and supports explicit completion", () => {
    document.body.innerHTML = `
      <textarea id="filenamePatterns"></textarea>
      <input id="route-debugger-filename" value="saved-report.pdf">
      <section id="options-reference-clauses"><table><tbody>
        <tr><td><code>filename:</code></td><td>report.pdf</td><td>Matches the resolved filename.</td></tr>
        <tr><td><code>fileext:</code></td><td>pdf</td><td>Matches its extension.</td></tr>
      </tbody></table></section>`;
    setupRoutingAutocomplete({
      matchers: ["fileext", "filename"],
      variables: [":date:", ":day:", ":filename:"],
    });

    const textarea = document.querySelector("textarea")!;
    textarea.value = "fil";
    textarea.selectionStart = textarea.value.length;
    textarea.dispatchEvent(new window.InputEvent("input", { bubbles: true }));
    let dropdown = document.getElementById(textarea.getAttribute("aria-controls")!)!;
    expect(
      [...dropdown.querySelectorAll(".autocomplete-option-label")].map((item) => item.textContent),
    ).toEqual(["filename", "fileext"]);
    expect(dropdown.querySelector(".autocomplete-option-meta")?.textContent).toBe(
      "saved-report.pdf",
    );
    expect(dropdown.querySelector(".autocomplete-option-description")?.textContent).toBe(
      "Matches the resolved filename.",
    );

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
    expect(textarea.value).toBe("filename: ");

    textarea.value = "excl";
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
    expect(textarea.value).toBe("exclude: ");

    textarea.value = "fileext: pdf\ninto: :f";
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
    expect(textarea.value).toBe("fileext: pdf\ninto: :filename:");

    textarea.value = "";
    textarea.setSelectionRange(0, 0);
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", ctrlKey: true, cancelable: true }),
    );
    dropdown = document.getElementById(textarea.getAttribute("aria-controls")!)!;
    expect(textarea.getAttribute("aria-expanded")).toBe("true");
    expect(
      [...dropdown.querySelectorAll(".autocomplete-option-label")].map((item) => item.textContent),
    ).toEqual([
      "into",
      "fetch",
      "rename",
      "exclude",
      "tab",
      "capture",
      "capturegroups",
      "filename",
      "fileext",
    ]);
  });

  test("attaches directory completion to the paths textarea", () => {
    document.body.innerHTML = '<textarea id="paths"></textarea>';
    setupRoutingAutocomplete({ matchers: [], variables: [":date:"] });
    const textarea = document.querySelector("textarea")!;
    textarea.value = ":d";
    textarea.selectionStart = 2;
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(document.querySelector(".autocomplete-option-label")?.textContent).toBe(":date:");
  });

  test("loads saved variable values for autocomplete rows", async () => {
    vi.resetModules();
    document.body.innerHTML = '<textarea id="paths"></textarea>';
    vi.mocked(browser.runtime.sendMessage)
      .mockResolvedValueOnce({
        body: { matchers: [], variables: [":date:"] },
      })
      .mockResolvedValueOnce({
        body: { interpolatedVariables: { ":date:": "2042-03-04" } },
      });

    await import("../../../src/options/syntax-editor/autocomplete.ts");
    const textarea = document.querySelector("textarea")!;
    await vi.waitFor(() => expect(textarea.hasAttribute("aria-controls")).toBe(true));
    textarea.value = ":d";
    textarea.setSelectionRange(2, 2);
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));

    expect(document.querySelector(".autocomplete-option-meta")?.textContent).toBe("2042-03-04");
    expect(document.querySelector(".autocomplete-option-meta")?.classList).not.toContain(
      "is-placeholder",
    );
  });

  test("continues startup when current route values are temporarily unavailable", async () => {
    vi.resetModules();
    document.body.innerHTML = '<textarea id="paths"></textarea>';
    vi.mocked(browser.runtime.sendMessage).mockImplementation((message: unknown) => {
      const type = Reflect.get(message as object, "type");
      return type === "CHECK_ROUTES"
        ? Promise.reject(new Error("worker restarting"))
        : Promise.resolve({ body: { matchers: [], variables: [":sha256:"] } });
    });

    await import("../../../src/options/syntax-editor/autocomplete.ts");
    await vi.waitFor(() =>
      expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: "CHECK_ROUTES" }),
    );
    const textarea = document.querySelector<HTMLTextAreaElement>("#paths")!;
    textarea.value = ":s";
    textarea.setSelectionRange(2, 2);
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));

    expect(document.querySelector(".autocomplete-option-meta")?.textContent).toBe("(lazy)");
  });

  test.each([{ body: {} }, { body: { matchers: [] } }, { body: { matchers: [], variables: [] } }])(
    "contains and normalizes keyword response %j during module startup",
    async (response) => {
      vi.resetModules();
      vi.mocked(browser.runtime.sendMessage).mockResolvedValueOnce(response as never);
      await import("../../../src/options/syntax-editor/autocomplete.ts");
      await vi.waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalled());
      expect(document.querySelector(".autocomplete-dropdown")).toBeNull();
    },
  );
});

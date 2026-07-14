// @vitest-environment jsdom

import { attachTypeahead } from "../../src/options/typeahead.ts";

const items = [
  { value: "images", label: "Images", description: "Route image files" },
  { value: "documents", label: "Documents", description: "PDF and office files" },
  { value: "archives", label: "Archives", description: "Compressed downloads" },
];

describe("typeahead dropdown", () => {
  beforeEach(() => {
    document.body.innerHTML = '<input id="picker">';
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("opens a selectable dropdown and filters labels and descriptions", () => {
    const input = document.querySelector<HTMLInputElement>("#picker")!;
    const selected = vi.fn();
    attachTypeahead(input, { items, onSelect: selected });

    input.focus();
    const dropdown = document.getElementById(input.getAttribute("aria-controls")!);
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(dropdown?.querySelectorAll('[role="option"]')).toHaveLength(3);

    input.value = "office";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(dropdown?.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(dropdown?.textContent).toContain("Documents");

    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(input.value).toBe("documents");
    expect(selected).toHaveBeenCalledWith(items[1]);
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  test("supports arrow keys and dismisses on Escape or outside press", () => {
    const input = document.querySelector<HTMLInputElement>("#picker")!;
    const selected = vi.fn();
    attachTypeahead(input, { items, onSelect: selected });

    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }),
    );
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(selected).toHaveBeenCalledWith(items.at(-1));

    input.focus();
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    expect(input.getAttribute("aria-expanded")).toBe("false");

    input.click();
    expect(input.getAttribute("aria-expanded")).toBe("true");
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  test("cleanup removes the floating listbox and combobox relationship", () => {
    const input = document.querySelector<HTMLInputElement>("#picker")!;
    const cleanup = attachTypeahead(input, { items, onSelect: vi.fn() });
    const controls = input.getAttribute("aria-controls")!;

    cleanup();

    expect(document.getElementById(controls)).toBeNull();
    expect(input.hasAttribute("role")).toBe(false);
    expect(input.hasAttribute("aria-controls")).toBe(false);
  });
});

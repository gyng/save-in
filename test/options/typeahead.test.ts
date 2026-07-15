// @vitest-environment jsdom

import { attachTypeahead } from "../../src/options/typeahead.ts";

const items = [
  { value: "images", label: "Images", description: "Route image files", meta: "photo.jpg" },
  { value: "documents", label: "Documents", description: "PDF and office files" },
  { value: "archives", label: "Archives", description: "Compressed downloads" },
];

describe("typeahead dropdown", () => {
  beforeEach(() => {
    document.body.innerHTML = '<input id="picker">';
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    expect(dropdown?.querySelector(".typeahead-option-meta")?.textContent).toBe("photo.jpg");

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

  test("supports type-to-select without editing a read-only value", () => {
    const input = document.querySelector<HTMLInputElement>("#picker")!;
    const selected = vi.fn();
    input.value = "images";
    input.readOnly = true;
    attachTypeahead(input, { items, onSelect: selected });

    input.focus();
    expect(input.getAttribute("aria-activedescendant")).toBe("typeahead-picker-option-0");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true }));
    expect(input.value).toBe("images");
    expect(input.getAttribute("aria-activedescendant")).toBe("typeahead-picker-option-1");

    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(input.value).toBe("documents");
    expect(selected).toHaveBeenCalledWith(items[1]);
  });

  test("shows and activates a read-only value beyond the editable result limit", () => {
    const input = document.querySelector<HTMLInputElement>("#picker")!;
    const manyItems = Array.from({ length: 14 }, (_, index) => ({
      value: `value-${index}`,
      label: `Value ${index}`,
    }));
    input.value = "value-13";
    input.readOnly = true;
    attachTypeahead(input, { items: manyItems, onSelect: vi.fn() });

    input.focus();
    const dropdown = document.getElementById(input.getAttribute("aria-controls")!)!;
    expect(dropdown.querySelectorAll('[role="option"]')).toHaveLength(14);
    expect(input.getAttribute("aria-activedescendant")).toBe("typeahead-picker-option-13");
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

  test("flips the scrollable results above when that side has more room", () => {
    const input = document.querySelector<HTMLInputElement>("#picker")!;
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(320);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(240);
    vi.spyOn(input, "getBoundingClientRect").mockReturnValue({
      x: 24,
      y: 180,
      top: 180,
      right: 144,
      bottom: 216,
      left: 24,
      width: 120,
      height: 36,
      toJSON: () => ({}),
    });
    attachTypeahead(input, { items, onSelect: vi.fn(), preferredWidth: 440 });
    const dropdown = document.getElementById(input.getAttribute("aria-controls")!)!;
    dropdown.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 440, bottom: 160, width: 440, height: 160 }) as DOMRect;

    input.focus();

    expect(dropdown.style.top).toBe("16px");
    expect(dropdown.style.width).toBe("304px");
    expect(dropdown.style.maxHeight).toBe("160px");
  });

  test("clamps its preferred width when the viewport is narrower than both edges", () => {
    const input = document.querySelector<HTMLInputElement>("#picker")!;
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(12);
    attachTypeahead(input, { items, onSelect: vi.fn(), preferredWidth: 80 });

    input.focus();
    const dropdown = document.getElementById(input.getAttribute("aria-controls")!)!;
    expect(dropdown.style.width).toBe("0px");
  });

  test("renders presentation-only group headings without disturbing option selection", () => {
    const input = document.querySelector<HTMLInputElement>("#picker")!;
    input.value = "documents";
    attachTypeahead(input, {
      items: [
        { ...items[0]!, group: "Media" },
        { ...items[1]!, group: "Files" },
        { ...items[2]!, group: "Files" },
      ],
      onSelect: vi.fn(),
    });

    input.focus();
    const dropdown = document.getElementById(input.getAttribute("aria-controls")!)!;
    expect(
      [...dropdown.querySelectorAll(".typeahead-group")].map((heading) => heading.textContent),
    ).toEqual(["Media", "Files"]);
    expect(dropdown.querySelectorAll('[role="presentation"]')).toHaveLength(2);
    expect(dropdown.querySelectorAll('[role="option"]')).toHaveLength(3);
    expect(input.getAttribute("aria-activedescendant")).toBe("typeahead-picker-option-1");
  });

  test("handles dynamic results, stale rows, and every keyboard boundary", () => {
    const input = document.querySelector<HTMLInputElement>("#picker")!;
    let available = [
      { value: "plain", label: "Plain", searchText: "needle" },
      { value: "other", label: "Other", description: "Second result" },
    ];
    const selected = vi.fn();
    vi.spyOn(input, "getBoundingClientRect").mockReturnValue({
      top: 80,
      bottom: 100,
      left: 180,
      width: 20,
    } as DOMRect);
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(220);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(110);
    attachTypeahead(input, {
      items: () => available,
      onSelect: selected,
      preferredWidth: 80,
      maxResults: 2,
    });
    const listbox = document.getElementById(input.getAttribute("aria-controls")!)!;

    window.dispatchEvent(new Event("resize"));
    input.focus();
    expect(listbox.style.top).toBe("102px");
    input.click();

    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }),
    );
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(input.getAttribute("aria-expanded")).toBe("false");

    input.value = "needle";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    const staleRow = listbox.querySelector<HTMLButtonElement>('[role="option"]')!;
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    staleRow.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    input.value = "no match";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    staleRow.click();
    expect(selected).not.toHaveBeenCalled();

    input.value = "";
    input.click();
    listbox.replaceChildren();
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
    expect(input.getAttribute("aria-expanded")).toBe("false");

    available = [];
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }),
    );
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  test("selects a row by pointer without closing on an inside press", () => {
    const input = document.querySelector<HTMLInputElement>("#picker")!;
    const selected = vi.fn();
    attachTypeahead(input, { items, onSelect: selected });
    input.focus();
    const listbox = document.getElementById(input.getAttribute("aria-controls")!)!;
    const row = listbox.querySelector<HTMLButtonElement>('[role="option"]')!;

    row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(input.getAttribute("aria-expanded")).toBe("true");
    row.click();

    expect(selected).toHaveBeenCalledWith(items[0]);
    expect(input.value).toBe("images");
  });
});

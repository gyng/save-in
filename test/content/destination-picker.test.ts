// @vitest-environment jsdom
import {
  closeDestinationPicker,
  isDestinationPickerHost,
  openDestinationPicker,
} from "../../src/content/destination-picker.ts";
import type { PickerItem, PickerModel } from "../../src/shared/destination-picker.ts";

const copy = {
  title: "Choose a folder",
  filter: "Filter folders",
  empty: "No matching folders",
  lastUsed: "Last used",
};
const path = (id: string, title: string, parentId: string | null = null): PickerItem => ({
  kind: "path",
  id,
  title,
  parentId,
});
const model: PickerModel = {
  lastUsed: { id: "save-in-last-used", title: "Wallpapers" },
  items: [
    path("save-in-0", "Images"),
    path("save-in-1", "Work"),
    path("save-in-2", "Reports", "save-in-1"),
    { kind: "separator" },
    path("save-in-4", "Read later"),
  ],
  copy,
};

const setE2EBuild = (value: boolean): void => {
  (globalThis as { SAVE_IN_CONTENT_E2E?: boolean }).SAVE_IN_CONTENT_E2E = value;
};

const onPick = vi.fn();
const open = (overrides: Partial<Parameters<typeof openDestinationPicker>[0]> = {}): boolean =>
  openDestinationPicker({ model, theme: "system", onPick, ...overrides });

const host = (): HTMLElement => {
  const found = document.querySelector<HTMLElement>("save-in-picker");
  if (!found) throw new Error("picker host missing");
  return found;
};
const root = (): ShadowRoot => {
  const shadow = host().shadowRoot;
  if (!shadow) throw new Error("picker shadow root is not exposed");
  return shadow;
};
const filter = (): HTMLInputElement => {
  const input = root().querySelector<HTMLInputElement>("input.filter");
  if (!input) throw new Error("picker filter missing");
  return input;
};
const optionIds = (): Array<string | undefined> =>
  [...root().querySelectorAll<HTMLElement>(".option")].map((option) => option.dataset.id);
const activeId = (): string | undefined =>
  root().querySelector<HTMLElement>('.option[aria-selected="true"]')?.dataset.id;
const option = (id: string): HTMLElement => {
  const found = root().querySelector<HTMLElement>(`.option[data-id="${id}"]`);
  if (!found) throw new Error(`picker option ${id} missing`);
  return found;
};
const press = (key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    composed: true,
    cancelable: true,
    ...init,
  });
  filter().dispatchEvent(event);
  return event;
};
const type = (value: string): void => {
  filter().value = value;
  filter().dispatchEvent(new Event("input", { bubbles: true, composed: true }));
};

beforeEach(() => {
  onPick.mockClear();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  closeDestinationPicker();
  setE2EBuild(true);
  document.body.replaceChildren();
  document.querySelectorAll("save-in-picker").forEach((orphan) => orphan.remove());
});

describe("destination picker view", () => {
  test("lists Last used, then the menu with headings, and focuses the filter", () => {
    expect(open()).toBe(true);

    expect(isDestinationPickerHost(host())).toBe(true);
    expect(isDestinationPickerHost(document.body)).toBe(false);
    expect(isDestinationPickerHost(null)).toBe(false);
    expect(host().parentElement).toBe(document.documentElement);
    expect(host().dataset.theme).toBe("system");
    expect(optionIds()).toEqual(["save-in-last-used", "save-in-0", "save-in-2", "save-in-4"]);
    expect(root().querySelector(".heading")?.textContent).toBe("Work");
    expect(root().querySelectorAll(".separator")).toHaveLength(2);
    expect(document.activeElement).toBe(host());
    expect(root().activeElement).toBe(filter());
    expect(activeId()).toBe("save-in-last-used");
  });

  test("exposes the listbox relationships a screen reader needs", () => {
    open();
    const input = filter();
    const list = root().querySelector('[role="listbox"]');
    const lastUsed = option("save-in-last-used");

    expect(root().querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe(copy.title);
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-label")).toBe(copy.filter);
    expect(input.getAttribute("aria-controls")).toBe(list?.id);
    expect(input.getAttribute("aria-activedescendant")).toBe(lastUsed.id);
    expect(option("save-in-2").getAttribute("aria-label")).toBe("Work / Reports");
    expect(option("save-in-2").hasAttribute("aria-describedby")).toBe(false);
    const hintId = lastUsed.getAttribute("aria-describedby");
    expect(hintId).toBeTruthy();
    expect(root().querySelector(`[id="${hintId}"]`)?.textContent).toBe(copy.lastUsed);
  });

  test("opens at the gesture position, or centered when there is none", () => {
    open({ point: { x: 120, y: 48 } });
    expect(host().style.getPropertyValue("--picker-x")).toBe("120px");
    expect(host().style.getPropertyValue("--picker-y")).toBe("48px");

    open();
    expect(host().style.getPropertyValue("--picker-x")).toBe("");
  });

  test("shows nothing when the model offers no destination", () => {
    expect(open({ model: { lastUsed: null, items: [{ kind: "separator" }], copy } })).toBe(false);
    expect(document.querySelector("save-in-picker")).toBeNull();
  });

  test("arrow keys move, Enter saves the active destination, and the picker closes", () => {
    open();

    expect(press("ArrowDown").defaultPrevented).toBe(true);
    expect(activeId()).toBe("save-in-0");
    expect(filter().getAttribute("aria-activedescendant")).toBe(option("save-in-0").id);
    press("ArrowDown");
    expect(activeId()).toBe("save-in-2");
    press("ArrowUp");
    expect(activeId()).toBe("save-in-0");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });

    expect(press("Enter").defaultPrevented).toBe(true);
    expect(onPick).toHaveBeenCalledExactlyOnceWith("save-in-0");
    expect(document.querySelector("save-in-picker")).toBeNull();
  });

  test("typing filters the list and Enter saves the first match", () => {
    open();

    type("rep");
    expect(optionIds()).toEqual(["save-in-2"]);
    expect(option("save-in-2").textContent).toBe("Work / Reports");
    expect(root().querySelector(".heading")).toBeNull();
    expect(root().querySelector<HTMLElement>(".empty")?.hidden).toBe(true);

    press("Enter");
    expect(onPick).toHaveBeenCalledExactlyOnceWith("save-in-2");
  });

  test("a filter with no match says so and Enter saves nothing", () => {
    open();

    type("zzz");
    expect(optionIds()).toEqual([]);
    expect(root().querySelector<HTMLElement>(".empty")?.hidden).toBe(false);
    expect(root().querySelector(".empty")?.textContent).toBe(copy.empty);
    expect(filter().hasAttribute("aria-activedescendant")).toBe(false);

    press("Enter");
    press("ArrowDown");
    expect(onPick).not.toHaveBeenCalled();
    expect(document.querySelector("save-in-picker")).not.toBeNull();
  });

  test("Escape closes without saving, and Tab stays in the filter", () => {
    open();

    expect(press("Tab").defaultPrevented).toBe(true);
    expect(document.querySelector("save-in-picker")).not.toBeNull();
    expect(press("a").defaultPrevented).toBe(false);

    expect(press("Escape").defaultPrevented).toBe(true);
    expect(document.querySelector("save-in-picker")).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });

  test("leaves an IME composition's own keys alone", () => {
    open();

    expect(press("Enter", { isComposing: true }).defaultPrevented).toBe(false);
    expect(onPick).not.toHaveBeenCalled();
    expect(document.querySelector("save-in-picker")).not.toBeNull();
  });

  test("key events never reach the page's hotkey handlers", () => {
    const pageHandler = vi.fn();
    (["keydown", "keypress", "keyup"] as const).forEach((eventType) =>
      document.addEventListener(eventType, pageHandler),
    );
    open();

    (["keydown", "keypress", "keyup"] as const).forEach((eventType) =>
      filter().dispatchEvent(
        new KeyboardEvent(eventType, { key: "k", bubbles: true, composed: true }),
      ),
    );

    expect(pageHandler).not.toHaveBeenCalled();
    (["keydown", "keypress", "keyup"] as const).forEach((eventType) =>
      document.removeEventListener(eventType, pageHandler),
    );
  });

  test("pointing highlights a destination and clicking saves it", () => {
    open();
    const target = option("save-in-4");
    const label = target.querySelector("span");

    label?.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, composed: true }));
    expect(activeId()).toBe("save-in-4");
    // The row is restyled, not rebuilt, so a press in progress keeps its target.
    expect(option("save-in-4")).toBe(target);
    label?.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, composed: true }));
    root()
      .querySelector(".heading")
      ?.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, composed: true }));
    expect(activeId()).toBe("save-in-4");

    root()
      .querySelector(".heading")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    root()
      .querySelector(".list")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(onPick).not.toHaveBeenCalled();

    label?.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(onPick).toHaveBeenCalledExactlyOnceWith("save-in-4");
    expect(document.querySelector("save-in-picker")).toBeNull();
  });

  test("ignores events whose target is not an element", () => {
    open();
    const list = root().querySelector(".list");
    const text = option("save-in-0").querySelector("span")?.firstChild;

    text?.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(list).not.toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });

  test("a press outside dismisses and a press inside does not", () => {
    document.body.innerHTML = "<p>Page</p>";
    open();

    filter().dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
    expect(document.querySelector("save-in-picker")).not.toBeNull();

    document
      .querySelector("p")
      ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
    expect(document.querySelector("save-in-picker")).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });

  test("returns focus to the page only while the picker still holds it", () => {
    document.body.innerHTML = '<input id="before"><input id="elsewhere">';
    const before = document.querySelector<HTMLInputElement>("#before");
    const elsewhere = document.querySelector<HTMLInputElement>("#elsewhere");
    before?.focus();

    open();
    expect(document.activeElement).toBe(host());
    press("Escape");
    expect(document.activeElement).toBe(before);

    open();
    elsewhere?.focus();
    closeDestinationPicker();
    expect(document.activeElement).toBe(elsewhere);
  });

  test("does not return focus to an element that left the page or was never focusable", () => {
    document.body.innerHTML = '<input id="before">';
    const before = document.querySelector<HTMLInputElement>("#before");
    before?.focus();
    open();
    before?.remove();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    press("Escape");
    expect(focus).not.toHaveBeenCalled();
    focus.mockRestore();

    // Nothing focused beforehand: the active element is the body itself.
    open();
    press("Escape");
    expect(document.querySelector("save-in-picker")).toBeNull();
  });

  test("only one picker exists, and an orphaned host is reclaimed", () => {
    const orphan = document.createElement("save-in-picker");
    document.documentElement.append(orphan);

    open();
    const first = host();
    expect(orphan.isConnected).toBe(false);

    open({ model: { lastUsed: null, items: [path("save-in-9", "Other")], copy } });
    expect(first.isConnected).toBe(false);
    expect(document.querySelectorAll("save-in-picker")).toHaveLength(1);
    expect(optionIds()).toEqual(["save-in-9"]);

    // The replaced picker's listeners are gone with it.
    press("Enter");
    expect(onPick).toHaveBeenCalledExactlyOnceWith("save-in-9");
    closeDestinationPicker();
    closeDestinationPicker();
  });
});

describe("destination picker page isolation", () => {
  test("production builds keep the root closed", () => {
    setE2EBuild(false);
    open();

    expect(host().shadowRoot).toBeNull();
  });

  test("production builds ignore every synthesized event", () => {
    document.body.innerHTML = "<p>Page</p>";
    open();
    // Reach inside through the open test root, then switch to production trust.
    const input = filter();
    const target = option("save-in-4");
    const selected = (): string | undefined =>
      [...input.getRootNode().childNodes]
        .flatMap((node) =>
          node instanceof Element ? [...node.querySelectorAll<HTMLElement>(".option")] : [],
        )
        .find((candidate) => candidate.getAttribute("aria-selected") === "true")?.dataset.id;
    setE2EBuild(false);

    input.value = "rep";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    target.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, composed: true }));
    expect(selected()).toBe("save-in-last-used");

    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    input.dispatchEvent(enter);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    document
      .querySelector("p")
      ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));

    expect(enter.defaultPrevented).toBe(false);
    expect(onPick).not.toHaveBeenCalled();
    expect(document.querySelector("save-in-picker")).not.toBeNull();
    expect(target.isConnected).toBe(true);
  });
});

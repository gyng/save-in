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
  test("the header names what will be saved, and the dialog keeps its plain title", () => {
    open({ subject: { kind: "image", name: "forest.jpg" } });
    const header = root().querySelector(".header")!;

    expect(header.querySelector(".header-title")?.textContent).toBe(copy.title);
    expect(header.querySelector(".header-subject")?.textContent).toBe("forest.jpg");
    // The extension sits in its own unclipped span, so a long name loses its
    // middle rather than the part that says what the file is.
    expect(header.querySelector(".header-subject-tail")?.textContent).toBe("rest.jpg");
    expect(header.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(root().querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe(copy.title);
  });

  test.each([
    ["a page", { kind: "page" as const, name: "" }, 1],
    ["nothing in particular", undefined, 0],
  ])("the header shows no name for %s", (_label, subject, icons) => {
    open({ subject });

    expect(root().querySelector(".header-subject")).toBeNull();
    expect(root().querySelectorAll(".header svg")).toHaveLength(icons);
  });

  test("rows carry decorative icons and a key legend nothing reads aloud", () => {
    open();

    expect(option("save-in-last-used").querySelector("svg.row-icon")).not.toBeNull();
    // A submenu heading is drawn as the open folder holding the rows under it.
    expect(root().querySelector(".heading svg.row-icon")).not.toBeNull();
    expect(option("save-in-0").querySelector("svg.row-icon")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    const legend = root().querySelector(".keys")!;
    expect(legend.getAttribute("aria-hidden")).toBe("true");
    expect([...legend.querySelectorAll("kbd")].map((key) => key.textContent)).toEqual([
      "\u2191",
      "\u2193",
      "\u21B5",
      "Esc",
    ]);
  });

  describe("menu keys", () => {
    const keyedModel: PickerModel = {
      ...model,
      lastUsed: { id: "save-in-last-used", title: "Wallpapers", key: "e" },
      items: [
        { kind: "path", id: "save-in-0", title: "Images", parentId: null, key: "1" },
        { kind: "path", id: "save-in-1", title: "Work", parentId: null, key: "2" },
        { kind: "path", id: "save-in-2", title: "Reports", parentId: "save-in-1", key: "1" },
        { kind: "path", id: "save-in-4", title: "Read later", parentId: null },
      ],
    };
    const shownKeys = (): Array<string | null> =>
      [...root().querySelectorAll("kbd.row-key")].map((key) => key.textContent);

    test("rows show the keys of the current menu level and announce them", () => {
      open({ model: keyedModel });

      expect(shownKeys()).toEqual(["e", "1", "2"]);
      expect(option("save-in-0").getAttribute("aria-keyshortcuts")).toBe("1");
      expect(option("save-in-2").querySelector("kbd.row-key")).toBeNull();
      expect(option("save-in-4").querySelector("kbd.row-key")).toBeNull();
    });

    test("pressing a destination's key with the filter empty saves there at once", () => {
      open({ model: keyedModel });

      const event = press("E");

      expect(event.defaultPrevented).toBe(true);
      expect(onPick).toHaveBeenCalledWith("save-in-last-used");
      expect(document.querySelector("save-in-picker")).toBeNull();
    });

    test("a submenu's key steps into it, then its child's key saves", () => {
      open({ model: keyedModel });

      expect(press("2").defaultPrevented).toBe(true);
      expect(onPick).not.toHaveBeenCalled();
      expect(root().querySelector('.heading[data-scope="current"]')?.textContent).toContain("Work");
      // The list is named by the submenu its keys now apply to.
      expect(root().querySelector('[role="listbox"]')?.getAttribute("aria-label")).toBe("Work");
      expect(shownKeys()).toEqual(["1"]);
      expect(activeId()).toBe("save-in-2");

      press("1");
      expect(onPick).toHaveBeenCalledWith("save-in-2");
    });

    test("Backspace on an empty filter steps back out, and is otherwise the filter's", () => {
      open({ model: keyedModel });
      expect(press("Backspace").defaultPrevented).toBe(false);

      press("2");
      expect(press("Backspace").defaultPrevented).toBe(true);
      expect(root().querySelector('.heading[data-scope="current"]')).toBeNull();
      expect(root().querySelector('[role="listbox"]')?.getAttribute("aria-label")).toBe(copy.title);
      expect(shownKeys()).toEqual(["e", "1", "2"]);
    });

    test("a key held with a modifier, or one no row owns, is left to the filter", () => {
      open({ model: keyedModel });

      expect(press("1", { ctrlKey: true }).defaultPrevented).toBe(false);
      expect(press("1", { altKey: true }).defaultPrevented).toBe(false);
      expect(press("1", { metaKey: true }).defaultPrevented).toBe(false);
      expect(press("x").defaultPrevented).toBe(false);
      expect(onPick).not.toHaveBeenCalled();
    });

    // The key that opened the picker by a keyboard command may still be held
    // after its modifiers are released; its repeats arrive as a bare key.
    test("an auto-repeating key never saves", () => {
      open({ model: keyedModel });

      expect(press("e", { repeat: true }).defaultPrevented).toBe(false);
      expect(onPick).not.toHaveBeenCalled();
      expect(document.querySelector("save-in-picker")).not.toBeNull();

      press("e");
      expect(onPick).toHaveBeenCalledWith("save-in-last-used");
    });

    test("once a filter is typed, keys are plain characters and their hints go away", () => {
      open({ model: keyedModel });
      type("ima");

      expect(shownKeys()).toEqual([]);
      expect(option("save-in-0").hasAttribute("aria-keyshortcuts")).toBe(false);
      expect(press("1").defaultPrevented).toBe(false);
      expect(onPick).not.toHaveBeenCalled();
    });
  });

  test("offers a line break after each slash in a title, marked or not", () => {
    open({
      model: {
        ...model,
        items: [path("save-in-0", "Documents/Receipts/2026"), path("save-in-1", "Archive")],
      },
    });
    const title = option("save-in-0").querySelector(".option-title")!;
    expect(title.innerHTML).toBe("Documents/<wbr>Receipts/<wbr>2026");

    type("pts/2");
    expect(option("save-in-0").querySelector(".option-title")?.innerHTML).toBe(
      "Documents/<wbr>Recei<mark>pts/<wbr>2</mark>026",
    );
  });

  test("marks what the filter matched without changing the row's accessible name", () => {
    open();
    type("rep");
    const row = option("save-in-2");

    expect(row.querySelector("mark")?.textContent).toBe("Rep");
    expect(row.querySelector(".option-title")?.textContent).toBe("Work / Reports");
    expect(row.getAttribute("aria-label")).toBe("Work / Reports");
  });

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
    expect(option("save-in-2").hasAttribute("aria-description")).toBe(false);
    // The visible hint is inert, so it cannot be what describes the row.
    expect(lastUsed.hasAttribute("aria-describedby")).toBe(false);
    expect(lastUsed.getAttribute("aria-description")).toBe(copy.lastUsed);
  });

  // A page can read text through a closed shadow root with find-in-page and by
  // serializing a selection; both skip inert content, and nothing else.
  test.each([
    ["as opened", () => {}],
    ["with a filter matching", () => type("rep")],
    ["with a filter matching nothing", () => type("zzz")],
    ["inside a submenu", () => press("w")],
  ])("keeps every string it shows inside an inert element, %s", (_label, arrange) => {
    open({ subject: { kind: "image", name: "forest.jpg" } });
    arrange();

    const exposed: string[] = [];
    const walker = document.createTreeWalker(root(), NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (parent?.localName === "style" || parent?.closest("[inert]")) continue;
      exposed.push(node.textContent ?? "");
    }
    // Only the fixed no-match status is readable; it names no folder.
    expect(exposed.filter((text) => text !== copy.empty)).toEqual([]);
    // What a screen reader needs is carried by attributes instead.
    expect(root().querySelector<HTMLElement>(".header")?.title).toBe("forest.jpg");
    for (const row of root().querySelectorAll(".option")) {
      expect(row.hasAttribute("inert")).toBe(false);
      expect(row.getAttribute("aria-label")).toBeTruthy();
    }
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
    expect(root().querySelector('[role="status"]')?.textContent).toBe("");

    press("Enter");
    expect(onPick).toHaveBeenCalledExactlyOnceWith("save-in-2");
  });

  test("a filter with no match says so and Enter saves nothing", () => {
    open();

    type("zzz");
    expect(optionIds()).toEqual([]);
    expect(root().querySelector<HTMLElement>(".empty")?.hidden).toBe(false);
    expect(root().querySelector(".empty")?.textContent).toBe(copy.empty);
    // The visible copy is inert, so an always-present status carries it.
    const status = root().querySelector('[role="status"]');
    expect(status?.textContent).toBe(copy.empty);
    expect(status?.closest("[inert]")).toBeNull();
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

  // The rows are what the background listed when the picker opened; left open
  // behind another tab or window they would go stale.
  test("closes without saving when the tab is hidden or the window loses focus", () => {
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    open();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(document.querySelector("save-in-picker")).not.toBeNull();

    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(document.querySelector("save-in-picker")).toBeNull();

    open();
    window.dispatchEvent(new Event("blur"));
    expect(document.querySelector("save-in-picker")).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
    hidden.mockRestore();
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

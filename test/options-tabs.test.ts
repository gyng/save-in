// @vitest-environment jsdom
import * as Tabs from "../src/options/tabs.ts";

const { collectSections, headingLabel, orderSections, setupTabs, TAB_STORAGE_KEY } = Tabs;

const buildForm = () => {
  document.body.innerHTML = `
    <form id="options">
      <h2 id="section-downloads">Downloads</h2>
      <label id="opt-a"><input id="a" type="checkbox"></label>
      <div id="downloads-extra">extra</div>
      <h2 id="section-notifications">Notifications</h2>
      <label id="opt-b"><input id="b" type="checkbox"></label>
      <h2 id="section-shortcuts">Shortcuts</h2>
      <label id="opt-c"><input id="c" type="checkbox"></label>
    </form>`;
  return document.getElementById("options") as HTMLFormElement;
};

describe("collectSections", () => {
  test("groups form children into one run per h2", () => {
    const form = buildForm();
    const sections = collectSections(form);

    expect(sections.map((s) => s.heading.textContent)).toEqual([
      "Downloads",
      "Notifications",
      "Shortcuts",
    ]);
    expect(sections[0]!.nodes.map((n) => n.id).filter(Boolean)).toEqual([
      "section-downloads",
      "opt-a",
      "downloads-extra",
    ]);
  });

  test("treats a wrapper whose first child is an h2 as a section", () => {
    document.body.innerHTML = `
      <form id="options">
        <h2>Downloads</h2>
        <label id="a-label"><input id="a"></label>
        <div class="column"><h2>Dynamic</h2><textarea id="rules"></textarea></div>
      </form>`;
    const sections = collectSections(document.getElementById("options") as HTMLFormElement);

    expect(sections.map((s) => s.heading.textContent)).toEqual(["Downloads", "Dynamic"]);
    expect(sections[1]!.nodes[0]!.querySelector("#rules")).not.toBeNull();
  });

  test("ignores non-HTML children before the first section", () => {
    document.body.innerHTML = `
      <form id="options">
        <svg><title>Decoration</title></svg>
        <div>HTML preface</div>
        <h2>Downloads</h2><label>Option</label>
      </form>`;
    const sections = collectSections(document.getElementById("options") as HTMLFormElement);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.nodes).toHaveLength(2);
  });
});

describe("headingLabel", () => {
  test("ignores nested controls (e.g. a reset button in the heading)", () => {
    document.body.innerHTML = '<h2 id="h">More Options<div id="reset">Restore</div></h2>';
    expect(headingLabel(document.getElementById("h") as HTMLElement)).toBe("More Options");
  });
});

describe("orderSections", () => {
  test("puts frequent workflows before passive preferences", () => {
    const keys = [
      "section-notifications",
      "section-more-options",
      "section-history",
      "section-downloads",
      "section-save-as-shortcuts",
      "section-keyboard-shortcuts",
      "section-dynamic-downloads",
      "section-browser-downloads",
    ];
    const sections = keys.map((key) => ({
      key,
      heading: document.createElement("h2"),
      nodes: [],
    }));
    expect(orderSections(sections).map(({ key }) => key)).toEqual([
      "section-downloads",
      "section-dynamic-downloads",
      "section-browser-downloads",
      "section-history",
      "section-notifications",
      "section-save-as-shortcuts",
      "section-keyboard-shortcuts",
      "section-more-options",
    ]);
  });
});

describe("setupTabs", () => {
  beforeEach(() => {
    buildForm();
    try {
      localStorage.removeItem(TAB_STORAGE_KEY);
    } catch (e) {
      // ignore
    }
    setupTabs();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("builds a tab per section and shows the first by default", () => {
    const tabs = document.querySelectorAll<HTMLElement>(".tablist .tab");
    expect(tabs).toHaveLength(3);

    const panels = document.querySelectorAll<HTMLElement>(".tab-panel");
    expect(panels[0]!.hidden).toBe(false);
    expect(panels[1]!.hidden).toBe(true);
  });

  test("preserves every option element and its id", () => {
    ["a", "b", "c"].forEach((id) => {
      expect(document.getElementById(id)).not.toBeNull();
    });
    // Option controls moved into panels, not destroyed
    expect(document.getElementById("a")?.closest(".tab-panel")).not.toBeNull();
  });

  test("clicking a tab switches the visible panel", () => {
    const tabs = document.querySelectorAll<HTMLElement>(".tablist .tab");
    const panels = document.querySelectorAll<HTMLElement>(".tab-panel");

    tabs[1]!.click();

    expect(panels[0]!.hidden).toBe(true);
    expect(panels[1]!.hidden).toBe(false);
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
    expect(tabs[1]!.getAttribute("aria-controls")).toBe(panels[1]!.id);
    expect(panels[1]!.getAttribute("aria-labelledby")).toBe(tabs[1]!.id);
  });

  test("option navigation activates its panel before focusing the control", () => {
    const target = document.getElementById("b") as HTMLInputElement;
    document.dispatchEvent(new CustomEvent("save-in:navigate-option", { detail: { target } }));
    expect(document.querySelectorAll<HTMLElement>(".tab-panel")[1]!.hidden).toBe(false);
    expect(document.activeElement).toBe(target);
  });

  test("Home and End move to the first and last tab", () => {
    const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')];

    tabs[0]!.dispatchEvent(new window.KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(document.activeElement).toBe(tabs.at(-1));
    expect(tabs.at(-1)?.getAttribute("aria-selected")).toBe("true");

    tabs.at(-1)?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(document.activeElement).toBe(tabs[0]!);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
  });

  test("remembers the selected tab across setups", () => {
    document.querySelectorAll<HTMLElement>(".tablist .tab")[2]!.click();

    // Rebuild the page and re-run
    buildForm();
    setupTabs();

    const panels = document.querySelectorAll<HTMLElement>(".tab-panel");
    expect(panels[2]!.hidden).toBe(false);
  });

  test("persists a stable section id instead of a positional index", () => {
    document.querySelectorAll<HTMLElement>(".tablist .tab")[1]!.click();
    expect(localStorage.getItem(TAB_STORAGE_KEY)).toBe("section-notifications");
  });

  test("migrates the legacy numeric tab index", () => {
    buildForm();
    const headings = document.querySelectorAll("h2");
    headings[0]!.id = "section-a";
    headings[1]!.id = "section-b";
    headings[2]!.id = "section-c";
    localStorage.setItem(TAB_STORAGE_KEY, "2");

    setupTabs();

    expect(document.querySelectorAll<HTMLElement>('[role="tab"]')[2]!.ariaSelected).toBe("true");
    expect(localStorage.getItem(TAB_STORAGE_KEY)).toBe("section-c");
  });

  test("preserves the old numeric History position after task-ordering tabs", () => {
    document.body.innerHTML = `
      <form id="options">
        <h2 id="section-downloads">Downloads</h2>
        <h2 id="section-dynamic-downloads">Routing</h2>
        <h2 id="section-notifications">Notifications</h2>
        <h2 id="section-save-as-shortcuts">Shortcuts</h2>
        <h2 id="section-history">History</h2>
        <h2 id="section-more-options">Advanced</h2>
      </form>`;
    localStorage.setItem(TAB_STORAGE_KEY, "5");

    setupTabs();

    expect(document.querySelector<HTMLElement>("#tab-section-history")?.ariaSelected).toBe("true");
  });

  test("arrow keys move between tabs", () => {
    const tabs = document.querySelectorAll<HTMLElement>(".tablist .tab");
    tabs[0]!.focus();
    tabs[0]!.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );

    expect(document.querySelectorAll<HTMLElement>(".tab-panel")[1]!.hidden).toBe(false);
  });

  test("ArrowLeft wraps and unrelated keys leave selection unchanged", () => {
    const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
    tabs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(tabs[0]!.ariaSelected).toBe("true");

    tabs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(tabs.at(-1)!.ariaSelected).toBe("true");
  });

  test("ignores option-navigation events outside a tab panel", () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    document.dispatchEvent(new CustomEvent("save-in:navigate-option"));
    document.dispatchEvent(
      new CustomEvent("save-in:navigate-option", { detail: { target: outside } }),
    );
    expect(document.querySelectorAll<HTMLElement>('[role="tab"]')[0]!.ariaSelected).toBe("true");
  });

  test("highlights a non-choice option and removes the marker after the timeout", async () => {
    vi.useFakeTimers();
    try {
      const target = document.getElementById("c") as HTMLInputElement;
      target.type = "text";
      target.scrollIntoView = vi.fn();
      document.dispatchEvent(new CustomEvent("save-in:navigate-option", { detail: { target } }));

      expect(target.classList.contains("option-search-target")).toBe(true);
      expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
      await vi.advanceTimersByTimeAsync(1600);
      expect(target.classList.contains("option-search-target")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test("contains an out-of-range legacy position", () => {
    buildForm();
    localStorage.setItem(TAB_STORAGE_KEY, "6");
    expect(setupTabs()).toBeUndefined();
    expect(document.querySelector('[role="tab"][aria-selected="true"]')).toBeNull();
  });
});

describe("setupTabs guards", () => {
  test("does nothing without the options form", () => {
    document.body.innerHTML = "<div>no form here</div>";
    expect(() => setupTabs()).not.toThrow();
    expect(document.querySelector(".tablist")).toBeNull();
  });

  test("does not tab a single-section form", () => {
    document.body.innerHTML = '<form id="options"><h2>Only</h2><label>x</label></form>';
    setupTabs();
    expect(document.querySelector(".tablist")).toBeNull();
  });
});

describe("unsaved-changes guard on tab switch", () => {
  let confirmPendingChanges: (() => boolean | Promise<boolean>) | undefined;
  let onGuardError = vi.fn<(error: unknown) => void>();

  beforeEach(() => {
    buildForm();
    try {
      localStorage.removeItem(TAB_STORAGE_KEY);
    } catch (e) {
      // ignore
    }
    confirmPendingChanges = undefined;
    onGuardError = vi.fn<(error: unknown) => void>();
    setupTabs({
      confirmPendingChanges: () => confirmPendingChanges?.() ?? true,
      onGuardError,
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("calls the guard when switching to a different tab", () => {
    confirmPendingChanges = vi.fn(() => true);
    const tabs = document.querySelectorAll<HTMLElement>(".tablist .tab");

    tabs[1]!.click();
    expect(confirmPendingChanges).toHaveBeenCalledTimes(1);

    // Re-clicking the active tab is not a switch
    tabs[1]!.click();
    expect(confirmPendingChanges).toHaveBeenCalledTimes(1);

    tabs[0]!.click();
    expect(confirmPendingChanges).toHaveBeenCalledTimes(2);
  });

  test("stays on the current tab when the unsaved-changes guard declines", () => {
    confirmPendingChanges = vi.fn(() => false);
    const tabs = document.querySelectorAll<HTMLElement>(".tablist .tab");
    const panels = document.querySelectorAll<HTMLElement>(".tab-panel");

    tabs[1]!.click();

    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(panels[0]!.hidden).toBe(false);
    expect(panels[1]!.hidden).toBe(true);
  });

  test("waits for asynchronous persistence before switching tabs", async () => {
    let finish: (allowed: boolean) => void = () => {};
    confirmPendingChanges = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)));
    const tabs = document.querySelectorAll<HTMLElement>(".tablist .tab");
    const panels = document.querySelectorAll<HTMLElement>(".tab-panel");

    tabs[1]!.click();
    expect(panels[0]!.hidden).toBe(false);

    finish(true);
    await Promise.resolve();
    expect(panels[1]!.hidden).toBe(false);
  });

  test("stays on the current tab when asynchronous persistence detects a newer edit", async () => {
    let finish: (allowed: boolean) => void = () => {};
    confirmPendingChanges = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)));
    const tabs = document.querySelectorAll<HTMLElement>(".tablist .tab");
    const panels = document.querySelectorAll<HTMLElement>(".tab-panel");

    tabs[1]!.focus();
    tabs[1]!.click();
    finish(false);
    await Promise.resolve();

    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(panels[0]!.hidden).toBe(false);
    expect(panels[1]!.hidden).toBe(true);
    expect(document.activeElement).toBe(tabs[0]);
  });

  test("waits for an asynchronous save guard before switching", async () => {
    let finish!: (allowed: boolean) => void;
    confirmPendingChanges = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)));
    const tabs = document.querySelectorAll<HTMLElement>(".tablist .tab");
    tabs[1]!.click();
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    finish(true);
    await vi.waitFor(() => expect(tabs[1]!.getAttribute("aria-selected")).toBe("true"));
  });

  test("only the latest pending tab request may activate", async () => {
    const finishes: Array<(allowed: boolean) => void> = [];
    confirmPendingChanges = vi.fn(() => new Promise<boolean>((resolve) => finishes.push(resolve)));
    const tabs = document.querySelectorAll<HTMLElement>(".tablist .tab");
    tabs[1]!.click();
    tabs[2]!.click();
    finishes[1]!(true);
    await vi.waitFor(() => expect(tabs[2]!.getAttribute("aria-selected")).toBe("true"));
    finishes[0]!(true);
    await Promise.resolve();
    expect(tabs[2]!.getAttribute("aria-selected")).toBe("true");
  });

  test("ignores a stale guard rejection after a newer navigation starts", async () => {
    const finishes: Array<{ resolve: (allowed: boolean) => void; reject: (error: Error) => void }> =
      [];
    confirmPendingChanges = vi.fn(
      () =>
        new Promise<boolean>((resolve, reject) => {
          finishes.push({ resolve, reject });
        }),
    );
    const tabs = document.querySelectorAll<HTMLElement>(".tablist .tab");
    tabs[1]!.click();
    tabs[2]!.click();
    finishes[1]!.resolve(true);
    await vi.waitFor(() => expect(tabs[2]!.ariaSelected).toBe("true"));
    finishes[0]!.reject(new Error("stale failure"));
    await Promise.resolve();

    expect(tabs[2]!.ariaSelected).toBe("true");
  });

  test("keyboard focus follows activation and returns on failure", async () => {
    let finish!: (allowed: boolean) => void;
    confirmPendingChanges = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)));
    const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
    tabs[0]!.focus();
    tabs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(tabs[0]!);
    finish(false);
    await vi.waitFor(() => expect(document.activeElement).toBe(tabs[0]!));
  });

  test("contains rejected guards and restores keyboard focus", async () => {
    const failure = new Error("restore failed");
    confirmPendingChanges = vi.fn(() => Promise.reject(failure));
    const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
    tabs[0]!.focus();

    tabs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    await vi.waitFor(() => expect(onGuardError).toHaveBeenCalledWith(failure));
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[0]!);
  });

  test("contains guards that throw synchronously", () => {
    const failure = new Error("guard failed");
    confirmPendingChanges = vi.fn(() => {
      throw failure;
    });
    const tabs = document.querySelectorAll<HTMLElement>(".tablist .tab");

    tabs[1]!.click();

    expect(onGuardError).toHaveBeenCalledWith(failure);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
  });

  test("contains a throwing guard-error reporter", async () => {
    const failure = new Error("guard failed");
    confirmPendingChanges = vi.fn(() => Promise.reject(failure));
    onGuardError.mockImplementation(() => {
      throw new Error("reporter failed");
    });
    const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
    tabs[0]!.focus();
    tabs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    await vi.waitFor(() => expect(onGuardError).toHaveBeenCalledWith(failure));
    expect(document.activeElement).toBe(tabs[0]);
  });

  test("moves keyboard focus after an asynchronous guard allows navigation", async () => {
    confirmPendingChanges = vi.fn(async () => true);
    const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
    tabs[0]!.focus();
    tabs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    await vi.waitFor(() => expect(document.activeElement).toBe(tabs[1]));
  });

  test("still switches when no guard is registered", () => {
    const tabs = document.querySelectorAll<HTMLElement>(".tablist .tab");
    const panels = document.querySelectorAll<HTMLElement>(".tab-panel");
    tabs[1]!.click();
    expect(panels[1]!.hidden).toBe(false);
  });
});

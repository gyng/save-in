import * as Tabs from "../src/options/tabs.ts";

const { collectSections, headingLabel, setupTabs, TAB_STORAGE_KEY } = Tabs;

const buildForm = () => {
  document.body.innerHTML = `
    <form id="options">
      <h2>Downloads</h2>
      <label id="opt-a"><input id="a" type="checkbox"></label>
      <div id="downloads-extra">extra</div>
      <h2>Notifications</h2>
      <label id="opt-b"><input id="b" type="checkbox"></label>
      <h2>Shortcuts</h2>
      <label id="opt-c"><input id="c" type="checkbox"></label>
    </form>`;
  return document.getElementById("options");
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
    expect(sections[0].nodes.map((n) => n.id).filter(Boolean)).toEqual([
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
    const sections = collectSections(document.getElementById("options"));

    expect(sections.map((s) => s.heading.textContent)).toEqual(["Downloads", "Dynamic"]);
    expect(sections[1].nodes[0].querySelector("#rules")).not.toBeNull();
  });
});

describe("headingLabel", () => {
  test("ignores nested controls (e.g. a reset button in the heading)", () => {
    document.body.innerHTML = '<h2 id="h">More Options<div id="reset">Restore</div></h2>';
    expect(headingLabel(document.getElementById("h"))).toBe("More Options");
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
    const tabs = document.querySelectorAll(".tablist .tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[0].textContent).toBe("Downloads");

    const panels = document.querySelectorAll(".tab-panel");
    expect(panels[0].classList.contains("active")).toBe(true);
    expect(panels[1].classList.contains("active")).toBe(false);
  });

  test("preserves every option element and its id", () => {
    ["a", "b", "c"].forEach((id) => {
      expect(document.getElementById(id)).not.toBeNull();
    });
    // Option controls moved into panels, not destroyed
    expect(document.getElementById("a").closest(".tab-panel")).not.toBeNull();
  });

  test("clicking a tab switches the visible panel", () => {
    const tabs = document.querySelectorAll(".tablist .tab");
    const panels = document.querySelectorAll(".tab-panel");

    tabs[1].click();

    expect(panels[0].classList.contains("active")).toBe(false);
    expect(panels[1].classList.contains("active")).toBe(true);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
  });

  test("remembers the selected tab across setups", () => {
    document.querySelectorAll(".tablist .tab")[2].click();

    // Rebuild the page and re-run
    buildForm();
    setupTabs();

    const panels = document.querySelectorAll(".tab-panel");
    expect(panels[2].classList.contains("active")).toBe(true);
  });

  test("arrow keys move between tabs", () => {
    const tabs = document.querySelectorAll(".tablist .tab");
    tabs[0].focus();
    tabs[0].dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );

    expect(document.querySelectorAll(".tab-panel")[1].classList.contains("active")).toBe(true);
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
    delete window.confirmPendingChanges;
  });

  test("calls the guard when switching to a different tab", () => {
    window.confirmPendingChanges = vi.fn();
    const tabs = document.querySelectorAll(".tablist .tab");

    tabs[1].click();
    expect(window.confirmPendingChanges).toHaveBeenCalledTimes(1);

    // Re-clicking the active tab is not a switch
    tabs[1].click();
    expect(window.confirmPendingChanges).toHaveBeenCalledTimes(1);

    tabs[0].click();
    expect(window.confirmPendingChanges).toHaveBeenCalledTimes(2);
  });

  test("still switches when no guard is registered", () => {
    const tabs = document.querySelectorAll(".tablist .tab");
    const panels = document.querySelectorAll(".tab-panel");
    tabs[1].click();
    expect(panels[1].classList.contains("active")).toBe(true);
  });
});

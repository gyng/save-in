// @vitest-environment jsdom
import { optionSearchEntries, setupOptionSearch } from "../src/options/option-search.ts";

describe("options search", () => {
  beforeEach(() => {
    document.body.innerHTML = `<nav class="top-nav"><div><a id="popout">Popout</a></div><div class="save-status">Last saved</div></nav>
    <form id="options">
      <div class="tablist"><button aria-controls="panel-downloads">Downloads</button></div>
      <section class="tab-panel" id="panel-downloads">
        <h3>External integrations</h3>
        <h4>WebMCP <span>Experimental</span></h4>
        <label><input id="prompt" type="checkbox"> Open save dialog</label>
        <label for="duration">Notification duration</label><input id="duration" type="number">
        <label><input id="verbose" type="text"><span class="opt-title">Short title</span><span class="caption-line">Long explanation</span></label>
        <input id="internal-control" type="text">
      </section>
    </form>`;
  });

  afterEach(() => vi.useRealTimers());

  test("indexes wrapping and explicit labels with their section", () => {
    expect(
      optionSearchEntries(document.getElementById("options")!).map(({ label, section }) => ({
        label,
        section,
      })),
    ).toEqual([
      { label: "External integrations", section: "Downloads" },
      { label: "WebMCP Experimental", section: "Downloads" },
      { label: "Open save dialog", section: "Downloads" },
      { label: "Notification duration", section: "Downloads" },
      { label: "Short title", section: "Downloads" },
    ]);
  });

  test("finds subsection headings and navigates to them", () => {
    const navigate = vi.fn();
    document.addEventListener("save-in:navigate-option", navigate, { once: true });
    setupOptionSearch();
    const input = document.getElementById("option-search") as HTMLInputElement;
    input.value = "webmcp";
    input.dispatchEvent(new InputEvent("input"));

    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(document.querySelector(".option-search-result-label")?.textContent).toBe(
      "WebMCP Experimental",
    );
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect((navigate.mock.calls[0]![0]! as CustomEvent).detail.target.tagName).toBe("H4");
    expect((navigate.mock.calls[0]![0]! as CustomEvent).detail.target.tabIndex).toBe(-1);
  });

  test("keeps the runtime search control outside the persisted form", () => {
    setupOptionSearch();
    expect(document.getElementById("option-search")?.dataset.runtimeControl).toBe("true");
    expect(
      document.getElementById("options")?.contains(document.getElementById("option-search")),
    ).toBe(false);
  });

  test("selects the first match with Enter without requiring an arrow key", () => {
    const navigate = vi.fn();
    document.addEventListener("save-in:navigate-option", navigate, { once: true });
    setupOptionSearch();
    const input = document.getElementById("option-search") as HTMLInputElement;
    input.value = "notification";
    input.dispatchEvent(new InputEvent("input"));
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(input.getAttribute("aria-activedescendant")).toBe("option-search-result-0");
    expect(document.querySelector<HTMLElement>('[role="option"]')?.tabIndex).toBe(-1);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(navigate).toHaveBeenCalledOnce();
    expect((navigate.mock.calls[0]![0]! as CustomEvent).detail.target.id).toBe("duration");
  });

  test("closes stale results when the query has no matches", () => {
    setupOptionSearch();
    const input = document.getElementById("option-search") as HTMLInputElement;
    input.value = "notification";
    input.dispatchEvent(new InputEvent("input"));
    input.value = "not present";
    input.dispatchEvent(new InputEvent("input"));
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
  });

  test("reopens a populated query on focus and keyboard navigation", async () => {
    vi.useFakeTimers();
    setupOptionSearch();
    const input = document.getElementById("option-search") as HTMLInputElement;
    const results = document.getElementById("option-search-results") as HTMLElement;
    input.value = "notification";
    input.dispatchEvent(new InputEvent("input"));

    input.dispatchEvent(new FocusEvent("blur"));
    await vi.advanceTimersByTimeAsync(100);
    expect(results.hidden).toBe(true);

    input.dispatchEvent(new FocusEvent("focus"));
    expect(results.hidden).toBe(false);
    expect(input.getAttribute("aria-activedescendant")).toBe("option-search-result-0");

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(results.hidden).toBe(true);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(results.hidden).toBe(false);
    expect(input.getAttribute("aria-activedescendant")).toBe("option-search-result-0");
  });
});

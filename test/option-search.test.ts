import { optionSearchEntries, setupOptionSearch } from "../src/options/option-search.ts";

describe("options search", () => {
  beforeEach(() => {
    document.body.innerHTML = `<form id="options">
      <div class="tablist"><button aria-controls="panel-downloads">Downloads</button></div>
      <section class="tab-panel" id="panel-downloads">
        <label><input id="prompt" type="checkbox"> Open save dialog</label>
        <label for="duration">Notification duration</label><input id="duration" type="number">
      </section>
    </form>`;
  });

  test("indexes wrapping and explicit labels with their section", () => {
    expect(
      optionSearchEntries(document.getElementById("options")!).map(({ label, section }) => ({
        label,
        section,
      })),
    ).toEqual([
      { label: "Open save dialog", section: "Downloads" },
      { label: "Notification duration", section: "Downloads" },
    ]);
  });

  test("filters results and keyboard selection requests navigation", () => {
    const navigate = vi.fn();
    document.addEventListener("save-in:navigate-option", navigate, { once: true });
    setupOptionSearch();
    const input = document.getElementById("option-search") as HTMLInputElement;
    input.value = "notification";
    input.dispatchEvent(new InputEvent("input"));
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(navigate).toHaveBeenCalledOnce();
    expect((navigate.mock.calls[0][0] as CustomEvent).detail.target.id).toBe("duration");
  });
});

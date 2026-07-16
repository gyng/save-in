// @vitest-environment jsdom
import { optionSearchEntries, setupOptionSearch } from "../../../src/options/core/option-search.ts";

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

  test("indexes labels with their tab and heading path", () => {
    expect(
      optionSearchEntries(document.getElementById("options")!).map(({ label, path }) => ({
        label,
        path,
      })),
    ).toEqual([
      { label: "External integrations", path: ["Downloads"] },
      { label: "WebMCP Experimental", path: ["Downloads", "External integrations"] },
      {
        label: "Open save dialog",
        path: ["Downloads", "External integrations", "WebMCP Experimental"],
      },
      {
        label: "Notification duration",
        path: ["Downloads", "External integrations", "WebMCP Experimental"],
      },
      {
        label: "Short title",
        path: ["Downloads", "External integrations", "WebMCP Experimental"],
      },
    ]);
  });

  test("indexes accessible and additional controls while excluding hidden search entries", () => {
    const panel = document.querySelector(".tab-panel")!;
    panel.insertAdjacentHTML(
      "beforeend",
      `<h3> </h3>
       <div id="labelled-name">Labelled by heading</div>
       <input id="aria-only" aria-label="Accessible only">
       <textarea id="labelled-only" aria-labelledby="labelled-name"></textarea>
       <input id="excluded" data-option-search="false" aria-label="Excluded">`,
    );
    const additional = document.createElement("button");
    additional.id = "additional";
    additional.setAttribute("aria-label", "Language selector");
    document.body.append(additional);
    const orphanPanel = document.createElement("section");
    orphanPanel.className = "tab-panel";
    orphanPanel.id = "orphan";
    orphanPanel.innerHTML = '<input id="orphan-control" aria-label="Orphan">';
    document.body.append(orphanPanel);

    const entries = optionSearchEntries(document.getElementById("options")!, [
      additional,
      orphanPanel.querySelector("input")!,
    ]);
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Accessible only", path: expect.any(Array) }),
        expect.objectContaining({ label: "Labelled by heading", path: expect.any(Array) }),
        expect.objectContaining({ label: "Language selector", path: [] }),
        expect.objectContaining({ label: "Orphan", path: [] }),
      ]),
    );
    expect(entries.some(({ control }) => control.id === "excluded")).toBe(false);
  });

  test("includes nested fieldset legends and falls back from stale explicit targets", () => {
    document.querySelector(".tab-panel")!.insertAdjacentHTML(
      "beforeend",
      `<fieldset><legend>Network</legend>
         <fieldset><legend> </legend>
           <button id="legacy-action" data-option-search="true" data-option-search-target="removed-control">Webhook delivery</button>
         </fieldset>
       </fieldset>`,
    );

    const entry = optionSearchEntries(document.getElementById("options")!).find(
      ({ control }) => control.id === "legacy-action",
    );

    expect(entry?.path).toContain("Network");
    expect(entry?.target).toBe(entry?.control);
  });

  test("finds subsection headings and navigates to them", () => {
    const navigate = vi.fn();
    document.addEventListener("save-in:navigate-option", navigate, { once: true });
    setupOptionSearch();
    const input = document.getElementById("option-search") as HTMLInputElement;
    input.value = "webmcp";
    input.dispatchEvent(new InputEvent("input"));

    expect(document.querySelectorAll('[role="option"]')).toHaveLength(4);
    expect(document.querySelector(".option-search-result-label")?.textContent).toBe(
      "WebMCP Experimental",
    );
    expect(document.querySelector(".option-search-result-location")?.textContent).toBe(
      "Downloads › External integrations",
    );
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect((navigate.mock.calls[0]![0]! as CustomEvent).detail.target.tagName).toBe("H4");
    expect((navigate.mock.calls[0]![0]! as CustomEvent).detail.target.tabIndex).toBe(-1);
  });

  test("ranks exact, prefix, and whole-word label matches", () => {
    document.querySelector(".tab-panel")?.insertAdjacentHTML(
      "beforeend",
      `<h3>Ranking fixtures</h3>
       <button id="word-match" data-option-search="true">Send webhook now</button>
       <button id="prefix-match" data-option-search="true">Webhook delivery</button>
       <button id="exact-match" data-option-search="true">Webhook</button>`,
    );
    setupOptionSearch();
    const input = document.getElementById("option-search") as HTMLInputElement;

    input.value = "webhook";
    input.dispatchEvent(new InputEvent("input"));

    expect(
      [...document.querySelectorAll<HTMLElement>(".option-search-result-label")]
        .map(({ textContent }) => textContent)
        .filter((label) => label?.toLocaleLowerCase().includes("webhook")),
    ).toEqual(["Webhook", "Webhook delivery", "Send webhook now"]);
  });

  test("finds a query contained inside a longer word", () => {
    document
      .querySelector(".tab-panel")!
      .insertAdjacentHTML(
        "beforeend",
        '<button id="contained-match" data-option-search="true">Webhook delivery</button>',
      );
    setupOptionSearch();
    const input = document.getElementById("option-search") as HTMLInputElement;

    input.value = "hook";
    input.dispatchEvent(new InputEvent("input"));

    expect(document.querySelector(".option-search-result-label")?.textContent).toBe(
      "Webhook delivery",
    );
  });

  test("ranks matches in the nearest breadcrumb above deeper ancestor matches", () => {
    document.querySelector(".tab-panel")!.innerHTML = `<h3>Webhooks</h3>
      <section>
        <h4>Delivery</h4>
        <button id="nested-setting" data-option-search="true">Nested setting</button>
      </section>
      <button id="direct-setting" data-option-search="true">Direct setting</button>`;
    setupOptionSearch();
    const input = document.getElementById("option-search") as HTMLInputElement;

    input.value = "webhook";
    input.dispatchEvent(new InputEvent("input"));

    const labels = [...document.querySelectorAll<HTMLElement>(".option-search-result-label")].map(
      ({ textContent }) => textContent,
    );
    expect(labels[0]).toBe("Webhooks");
    expect(labels.indexOf("Direct setting")).toBeLessThan(labels.indexOf("Nested setting"));
  });

  test("searches full paths, compacts displayed breadcrumbs, and navigates indexed actions", () => {
    document.querySelector(".tab-panel")?.insertAdjacentHTML(
      "beforeend",
      `<section>
        <h5>Maintenance tools</h5>
        <button id="settings-export" data-option-search="true">Export settings</button>
        <button id="webhook-test" data-option-search="true" data-option-search-target="duration" disabled>Test webhook</button>
      </section>`,
    );
    const navigate = vi.fn();
    document.addEventListener("save-in:navigate-option", navigate);
    setupOptionSearch();
    const input = document.getElementById("option-search") as HTMLInputElement;

    input.value = "export settings";
    input.dispatchEvent(new InputEvent("input"));
    expect(document.querySelector(".option-search-result-label")?.textContent).toBe(
      "Export settings",
    );
    const location = document.querySelector<HTMLElement>(".option-search-result-location")!;
    expect(location.textContent).toBe("Downloads › WebMCP Experimental › Maintenance tools");
    expect(location.title).toBe(
      "Downloads › External integrations › WebMCP Experimental › Maintenance tools",
    );
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect((navigate.mock.calls[0]![0] as CustomEvent).detail.target.id).toBe("settings-export");

    input.value = "test webhook";
    input.dispatchEvent(new InputEvent("input"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect((navigate.mock.calls[1]![0] as CustomEvent).detail.target.id).toBe("duration");
  });

  test("keeps the runtime search control outside the persisted form", () => {
    setupOptionSearch();
    expect(document.getElementById("option-search")?.dataset.runtimeControl).toBe("true");
    expect(
      document.getElementById("options")?.contains(document.getElementById("option-search")),
    ).toBe(false);
    setupOptionSearch();
    expect(document.querySelectorAll("#option-search")).toHaveLength(1);
  });

  test("falls back into the form without navigation and uses fallback copy", () => {
    document.querySelector(".top-nav")?.remove();
    vi.mocked(browser.i18n.getMessage).mockReturnValueOnce("");
    setupOptionSearch();
    const input = document.getElementById("option-search")!;
    expect(input.parentElement?.parentElement).toBe(document.getElementById("options"));
    expect(input.getAttribute("placeholder")).toBe("Search options");
  });

  test("does nothing without the options form", () => {
    document.body.innerHTML = '<nav class="top-nav"><div></div></nav>';
    expect(() => setupOptionSearch()).not.toThrow();
    expect(document.getElementById("option-search")).toBeNull();
  });

  test("moves save status into primary navigation and search into the tools area", () => {
    document
      .querySelector(".top-nav")
      ?.insertAdjacentHTML("beforeend", '<div class="top-nav-tools"></div>');
    setupOptionSearch();
    expect(document.querySelector(".top-nav > div:first-child > .save-status")?.textContent).toBe(
      "Last saved",
    );
    expect(document.querySelector(".top-nav-tools > .option-search")).not.toBeNull();
  });

  test("indexes the language selector and tolerates a missing save status", () => {
    document.querySelector(".save-status")?.remove();
    document.body.insertAdjacentHTML(
      "beforeend",
      '<label for="uiLocale">Language</label><select id="uiLocale"><option>English</option></select>',
    );
    setupOptionSearch();
    const input = document.getElementById("option-search") as HTMLInputElement;
    input.value = "language";
    input.dispatchEvent(new InputEvent("input"));
    expect(document.querySelector(".option-search-result-label")?.textContent).toBe("Language");
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

  test("chooses a result by pointer without allowing mousedown to steal focus", () => {
    const navigate = vi.fn();
    document.addEventListener("save-in:navigate-option", navigate, { once: true });
    setupOptionSearch();
    const input = document.getElementById("option-search") as HTMLInputElement;
    input.value = "short";
    input.dispatchEvent(new InputEvent("input"));
    const option = document.querySelector<HTMLButtonElement>('[role="option"]')!;
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    option.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    option.click();
    expect(navigate).toHaveBeenCalledOnce();
    expect(input.value).toBe("");
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
    input.value = "";
    input.dispatchEvent(new InputEvent("input"));
    expect(input.getAttribute("aria-expanded")).toBe("false");
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

  test("wraps upward navigation and contains empty-result keyboard commands", () => {
    document
      .querySelector(".tab-panel")
      ?.insertAdjacentHTML("beforeend", '<label><input id="second-title"> Another title</label>');
    setupOptionSearch();
    const input = document.getElementById("option-search") as HTMLInputElement;
    input.value = "not found";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(input.getAttribute("aria-expanded")).toBe("false");

    input.value = "title";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe("option-search-result-1");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(input.getAttribute("aria-activedescendant")).toBe("option-search-result-0");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(input.getAttribute("aria-activedescendant")).toBe("option-search-result-1");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
  });

  test("contains result DOM removal before keyboard navigation", () => {
    setupOptionSearch();
    const input = document.getElementById("option-search") as HTMLInputElement;
    const results = document.getElementById("option-search-results") as HTMLElement;
    input.value = "notification";
    input.dispatchEvent(new InputEvent("input"));
    results.replaceChildren();

    expect(() =>
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
    ).not.toThrow();
    expect(results.hidden).toBe(true);
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
  });

  test("does not choose a stale result removed before Enter", () => {
    const navigate = vi.fn();
    document.addEventListener("save-in:navigate-option", navigate);
    setupOptionSearch();
    const input = document.getElementById("option-search") as HTMLInputElement;
    const results = document.getElementById("option-search-results") as HTMLElement;
    input.value = "notification";
    input.dispatchEvent(new InputEvent("input"));
    results.replaceChildren();

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(navigate).not.toHaveBeenCalled();
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
  });

  test("cancels pending blur closure on refocus and replaces repeated blur timers", async () => {
    vi.useFakeTimers();
    setupOptionSearch();
    const input = document.getElementById("option-search") as HTMLInputElement;
    input.value = "notification";
    input.dispatchEvent(new InputEvent("input"));
    input.dispatchEvent(new FocusEvent("blur"));
    input.dispatchEvent(new FocusEvent("blur"));
    input.dispatchEvent(new FocusEvent("focus"));
    await vi.advanceTimersByTimeAsync(100);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    input.dispatchEvent(new FocusEvent("focus"));
  });
});

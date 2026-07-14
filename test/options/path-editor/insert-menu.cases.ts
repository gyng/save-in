// Cases imported by ui.test.ts to share one jsdom environment.
import { setupPathInsertMenu } from "../../../src/options/path-editor-insert-menu.ts";

const input = (selector = ".clause-preview-filter") =>
  document.querySelector<HTMLInputElement>(selector)!;

const keydown = (element: Element, key: string) =>
  element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

describe("path editor insert menu", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("ignores missing menus and targets", () => {
    const insert = vi.fn();
    setupPathInsertMenu("#missing", insert);

    document.body.innerHTML = '<details id="menu"></details>';
    setupPathInsertMenu("#menu", insert);
    document.querySelector("#menu")!.setAttribute("data-insert-target", "missing");
    setupPathInsertMenu("#menu", insert);

    expect(insert).not.toHaveBeenCalled();
  });

  test("sorts and activates authored buttons without a filter", () => {
    document.body.innerHTML = `<textarea id="paths"></textarea>
      <details id="menu" open data-insert-target="paths">
        <div><button data-insert-line="pageurl: ">Page</button></div>
        <div><button data-insert-line="">Empty</button></div>
      </details>`;
    const insert = vi.fn();
    setupPathInsertMenu("#menu", insert);

    const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")];
    buttons.find((button) => button.dataset.insertLine === "")!.click();
    expect(insert).toHaveBeenCalledWith(document.querySelector("#paths"), "");
    expect(document.querySelector<HTMLDetailsElement>("#menu")!.open).toBe(false);
  });

  test("filters authored buttons and handles filter keys before vocabulary loads", async () => {
    let resolveResponse!: (value: { body: Record<string, unknown> }) => void;
    vi.mocked(browser.runtime.sendMessage).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveResponse = resolve;
      }) as never,
    );
    document.body.innerHTML = `<textarea id="paths"></textarea>
      <details id="menu" open data-insert-target="paths">
        <input class="clause-preview-filter">
        <table><tbody><tr><td><button data-insert-line="pageurl: ">Page URL</button></td></tr></tbody></table>
        <button data-insert-line="filename: ">Filename</button>
      </details>`;
    const insert = vi.fn();
    setupPathInsertMenu("#menu", insert);
    const filter = input();

    filter.value = "filename";
    filter.dispatchEvent(new InputEvent("input", { bubbles: true }));
    keydown(filter, "x");
    keydown(filter, "Enter");
    expect(insert).toHaveBeenCalledWith(document.querySelector("#paths"), "filename: ");

    document.querySelector<HTMLDetailsElement>("#menu")!.open = true;
    keydown(filter, "Escape");
    expect(document.querySelector<HTMLDetailsElement>("#menu")!.open).toBe(false);

    resolveResponse({ body: {} });
    await Promise.resolve();
  });

  test("renders, filters, and inserts a sanitized runtime vocabulary", async () => {
    vi.mocked(browser.runtime.sendMessage).mockResolvedValueOnce({
      body: { matchers: ["mystery", 4, "pageurl"] },
    } as never);
    document.body.innerHTML = `<textarea id="paths"></textarea>
      <details id="menu" open data-insert-target="paths">
        <input class="clause-preview-filter">
        <table class="clause-preview-table"><tbody></tbody></table>
      </details>`;
    const insert = vi.fn();
    setupPathInsertMenu("#menu", insert);
    await vi.waitFor(() =>
      expect(document.querySelector('[data-insert-line="mystery: "]')).not.toBeNull(),
    );

    expect(document.body.textContent).toContain("Match this download property");
    const filter = input();
    filter.value = "mystery";
    filter.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(
      [...document.querySelectorAll<HTMLTableRowElement>(".variables-preview-group")].some(
        (heading) => heading.hidden,
      ),
    ).toBe(true);
    keydown(filter, "Enter");
    expect(insert).toHaveBeenCalledWith(document.querySelector("#paths"), "mystery: ");

    filter.value = "missing";
    filter.dispatchEvent(new InputEvent("input", { bubbles: true }));
    keydown(filter, "Enter");
  });

  test.each([
    () => Promise.resolve({ body: { matchers: "invalid" } }),
    () => Promise.reject(new Error("offline")),
  ])("falls back to the built-in clauses for invalid runtime vocabulary", async (response) => {
    vi.mocked(browser.runtime.sendMessage).mockReturnValueOnce(response() as never);
    document.body.innerHTML = `<textarea id="paths"></textarea>
      <details id="menu" data-insert-target="paths">
        <input class="clause-preview-filter">
        <table class="clause-preview-table"><tbody></tbody></table>
      </details>`;
    setupPathInsertMenu("#menu", vi.fn());

    await vi.waitFor(() =>
      expect(document.querySelector('[data-insert-line="capturegroups: "]')).not.toBeNull(),
    );
    expect(document.querySelector('[data-insert-line="invalid: "]')).toBeNull();
  });
});

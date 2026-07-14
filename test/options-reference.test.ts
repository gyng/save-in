// @vitest-environment jsdom
import { setupOptionsReferences } from "../src/options/options-reference.ts";

const referenceMarkup = ({ filter = true }: { filter?: boolean } = {}) => `
  <button id="opener">Open reference</button>
  <a href="#" data-reference-tab="options-reference-variables">Variables</a>
  <a href="#" data-reference-tab="options-reference-clauses">Clauses</a>
  <a href="#" data-reference-tab="options-reference-templates">Templates</a>
  <a href="#" data-reference-tab="missing-panel">Missing</a>
  <a href="#" data-reference-tab>Empty</a>
  <dialog id="reference-dialog">
    <button class="reference-dialog-close"></button>
    ${filter ? '<input class="reference-dialog-filter">' : ""}
    <section id="options-reference-variables" role="tabpanel">
      <span class="reference-loading-status visually-hidden">Loading variables</span>
      <table><tr><td><code class="click-to-copy">:date:</code></td><td>2000-01-01</td><td>Date</td></tr></table>
    </section>
    <section id="options-reference-clauses" role="tabpanel" hidden>
      <span class="reference-loading-status visually-hidden">Loading clauses</span>
      <table><tr><td><code class="click-to-copy">into:</code></td><td>folder/:filename:</td><td>Destination</td></tr></table>
    </section>
    <section id="options-reference-templates" role="tabpanel" hidden></section>
  </dialog>`;

beforeEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

test("enhances inline variable and clause references in the main option tabs", async () => {
  document.body.innerHTML = referenceMarkup();
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
    body: { variables: [":date:"], matchers: ["into"] },
  });
  setupOptionsReferences();
  await vi.waitFor(() =>
    expect(document.querySelectorAll("#options-reference-variables thead th")).toHaveLength(3),
  );
  expect(document.querySelectorAll("#options-reference-clauses thead th")).toHaveLength(3);
  expect(fetch).not.toHaveBeenCalled();
  expect(document.querySelector(".reference-loading-status")).toBeNull();
  expect(
    document.querySelector("#options-reference-variables .click-to-copy")?.getAttribute("role"),
  ).toBe("button");

  const opener = document.querySelector<HTMLButtonElement>("#opener")!;
  opener.focus();
  document
    .querySelector<HTMLElement>("[data-reference-tab='options-reference-variables']")!
    .click();
  const dialog = document.querySelector<HTMLDialogElement>("#reference-dialog")!;
  const filter = document.querySelector<HTMLInputElement>(".reference-dialog-filter")!;
  expect(dialog.hasAttribute("open")).toBe(true);
  expect(document.querySelector<HTMLElement>("#options-reference-variables")!.hidden).toBe(false);
  expect(filter.placeholder).toBe("Filter variables");

  filter.value = "missing";
  filter.dispatchEvent(new InputEvent("input", { bubbles: true }));
  expect(
    document.querySelector<HTMLTableRowElement>(
      "#options-reference-variables tbody tr:not(.reference-group-row)",
    )!.hidden,
  ).toBe(true);

  document.querySelector<HTMLElement>("[data-reference-tab='options-reference-clauses']")!.click();
  expect(filter.placeholder).toBe("Filter clauses");
  expect(filter.value).toBe("");
  document
    .querySelector<HTMLElement>("[data-reference-tab='options-reference-templates']")!
    .click();
  expect(filter.placeholder).toBe("Filter templates");

  document.querySelector<HTMLElement>("[data-reference-tab='missing-panel']")!.click();
  [...document.querySelectorAll<HTMLElement>("[data-reference-tab]")].at(-1)!.click();

  const close = vi.fn();
  dialog.close = close;
  document.querySelector<HTMLElement>(".reference-dialog-close")!.click();
  expect(close).toHaveBeenCalledOnce();
  dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(close).toHaveBeenCalledTimes(2);
  dialog.dispatchEvent(new Event("close"));
  expect(document.activeElement).toBe(opener);
  expect(
    [...document.querySelectorAll<HTMLElement>("[data-reference-tab]")].every(
      (tab) => tab.getAttribute("aria-selected") === "false",
    ),
  ).toBe(true);
});

test("keeps authored reference rows when runtime vocabulary is unavailable", async () => {
  document.body.innerHTML = referenceMarkup();
  vi.mocked(browser.runtime.sendMessage)
    .mockRejectedValueOnce(new Error("background unavailable"))
    .mockResolvedValueOnce({ body: {} } as never);

  setupOptionsReferences();

  await vi.waitFor(() =>
    expect(document.querySelectorAll("table.reference-table")).toHaveLength(2),
  );
  expect(document.querySelector("#options-reference-variables code")?.textContent).toBe(":date:");
  expect(document.querySelector("#options-reference-clauses code")?.textContent).toBe("into:");
});

test("tolerates missing optional reference controls and panels", async () => {
  setupOptionsReferences();
  await Promise.resolve();
  expect(browser.runtime.sendMessage).not.toHaveBeenCalled();

  document.body.innerHTML = referenceMarkup({ filter: false });
  vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
    body: { variables: [":date:"], matchers: ["into"] },
  });
  const dialog = document.querySelector<HTMLDialogElement>("#reference-dialog")!;
  const showModal = vi.fn(() => {
    dialog.open = true;
  });
  dialog.showModal = showModal;
  setupOptionsReferences();
  document
    .querySelector<HTMLAnchorElement>("[data-reference-tab='options-reference-variables']")!
    .click();
  expect(showModal).toHaveBeenCalledOnce();
});

test("does not restore focus when the opener is not an HTML element", () => {
  document.body.innerHTML = `${referenceMarkup()}<svg tabindex="0"><circle /></svg>`;
  vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
    body: { variables: [], matchers: [] },
  });
  const svg = document.querySelector<SVGElement>("svg")!;
  svg.focus();
  expect(document.activeElement).toBe(svg);

  setupOptionsReferences();
  document
    .querySelector<HTMLAnchorElement>("[data-reference-tab='options-reference-variables']")!
    .click();
  const dialog = document.querySelector<HTMLDialogElement>("#reference-dialog")!;
  dialog.dispatchEvent(new Event("close"));
  expect(document.activeElement).not.toBe(svg);
});

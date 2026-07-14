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
    <div role="tablist">
      <button role="tab" data-reference-tab="options-reference-variables" aria-controls="options-reference-variables">Variables</button>
      <button role="tab" data-reference-tab="options-reference-clauses" aria-controls="options-reference-clauses">Clauses</button>
      <button role="tab" data-reference-tab="options-reference-templates" aria-controls="options-reference-templates">Templates</button>
    </div>
    <div class="reference-dialog-descriptions">
      <p id="reference-dialog-description-variables" data-reference-description="options-reference-variables">Variables are used in folder and filename patterns.</p>
      <p id="reference-dialog-description-clauses" data-reference-description="options-reference-clauses" hidden>Routing rules use clauses to decide which downloads to move or rename.</p>
    </div>
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
  expect(filter.placeholder).toBe("Translated<html_filterVariables>");
  expect(
    document.querySelector<HTMLElement>("#reference-dialog-description-variables")?.hidden,
  ).toBe(false);
  expect(filter.getAttribute("aria-describedby")).toBe("reference-dialog-description-variables");

  filter.value = "missing";
  filter.dispatchEvent(new InputEvent("input", { bubbles: true }));
  expect(
    document.querySelector<HTMLTableRowElement>(
      "#options-reference-variables tbody tr:not(.reference-group-row)",
    )!.hidden,
  ).toBe(true);
  expect(
    document.querySelector<HTMLElement>("#options-reference-variables .reference-empty-state")!
      .hidden,
  ).toBe(false);

  const variableTab = dialog.querySelector<HTMLElement>(
    "[role='tab'][data-reference-tab='options-reference-variables']",
  )!;
  variableTab.focus();
  variableTab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  expect(document.activeElement).toBe(
    dialog.querySelector("[role='tab'][data-reference-tab='options-reference-clauses']"),
  );
  expect(document.querySelector<HTMLElement>("#options-reference-clauses")!.hidden).toBe(false);

  document.querySelector<HTMLElement>("[data-reference-tab='options-reference-clauses']")!.click();
  expect(filter.placeholder).toBe("Translated<html_filterClauses>");
  expect(
    document.querySelector<HTMLElement>("#reference-dialog-description-variables")?.hidden,
  ).toBe(true);
  expect(document.querySelector<HTMLElement>("#reference-dialog-description-clauses")?.hidden).toBe(
    false,
  );
  expect(filter.getAttribute("aria-describedby")).toBe("reference-dialog-description-clauses");
  expect(filter.value).toBe("");
  document
    .querySelector<HTMLElement>("[data-reference-tab='options-reference-templates']")!
    .click();
  expect(filter.placeholder).toBe("Translated<html_filterRoutingTemplates>");
  expect(document.querySelector<HTMLElement>(".reference-dialog-descriptions")?.hidden).toBe(true);
  expect(filter.hasAttribute("aria-describedby")).toBe(false);

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
    [...dialog.querySelectorAll<HTMLElement>("[role='tab']")].every(
      (tab) => tab.getAttribute("aria-selected") === "false",
    ),
  ).toBe(true);
  expect(
    [...document.querySelectorAll<HTMLElement>("body > [data-reference-tab]")].every(
      (launcher) => !launcher.hasAttribute("aria-selected"),
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

test("uses readable filter placeholders when localization is unavailable", async () => {
  document.body.innerHTML = `${referenceMarkup()}
    <a href="#" data-reference-tab="options-reference-orphan">Orphan</a>`;
  const dialog = document.querySelector("#reference-dialog")!;
  dialog.insertAdjacentHTML(
    "beforeend",
    '<button role="tab" data-reference-tab>Incomplete</button><section id="options-reference-orphan" role="tabpanel"></section>',
  );
  vi.mocked(browser.i18n.getMessage).mockReturnValue("");
  vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
    body: { variables: [], matchers: [] },
  });
  setupOptionsReferences();

  for (const [tab, placeholder] of [
    ["variables", "Filter variables"],
    ["clauses", "Filter clauses"],
    ["templates", "Filter routing templates"],
  ] as const) {
    document.querySelector<HTMLElement>(`body > [data-reference-tab$='-${tab}']`)!.click();
    expect(document.querySelector<HTMLInputElement>(".reference-dialog-filter")!.placeholder).toBe(
      placeholder,
    );
  }
  document.querySelector<HTMLElement>("[data-reference-tab='options-reference-orphan']")!.click();
  document.querySelector<HTMLElement>("body > [data-reference-tab='']")!.click();
  dialog.querySelector<HTMLButtonElement>("[role='tab'][data-reference-tab='']")!.click();
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

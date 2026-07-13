// @vitest-environment jsdom
import { setupOptionsReferences } from "../src/options/options-reference.ts";

test("enhances inline variable and clause references in the main option tabs", async () => {
  document.body.innerHTML = `
    <a href="#" data-reference-tab="options-reference-variables">Variables</a>
    <dialog id="reference-dialog">
      <button class="reference-dialog-close"></button>
      <input class="reference-dialog-filter">
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

  document.querySelector<HTMLElement>("[data-reference-tab]")!.click();
  expect(document.querySelector("#reference-dialog")?.hasAttribute("open")).toBe(true);
  expect(document.querySelector<HTMLElement>("#options-reference-variables")!.hidden).toBe(false);
  expect(document.querySelector<HTMLInputElement>(".reference-dialog-filter")!.placeholder).toBe(
    "Filter variables",
  );
});

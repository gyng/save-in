// @vitest-environment jsdom
import { setupOutsideDismiss } from "../../src/options/dismissible-details.ts";

test("closes an open resources menu only when clicking outside", () => {
  document.body.innerHTML = `
    <details class="nav-resources" open><summary>Help resources</summary><a href="#">Guide</a></details>
    <button type="button">Outside</button>`;
  const details = document.querySelector("details") as HTMLDetailsElement;
  setupOutsideDismiss(details);

  details.querySelector("a")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(details.open).toBe(true);

  document.querySelector("button")?.click();
  expect(details.open).toBe(false);
});

test("closes an open history columns menu when clicking outside", () => {
  document.body.innerHTML = `
    <details class="history-columns" open><summary>Columns</summary><label>File</label></details>
    <button type="button">Outside</button>`;
  const details = document.querySelector("details") as HTMLDetailsElement;
  setupOutsideDismiss(details);
  document.querySelector("button")?.click();
  expect(details.open).toBe(false);
});

test("closes an open history more menu when clicking outside", () => {
  document.body.innerHTML = `
    <details class="history-more-menu" open><summary>More</summary><button>Delete all</button></details>
    <button type="button" id="outside">Outside</button>`;
  const details = document.querySelector("details") as HTMLDetailsElement;
  setupOutsideDismiss(details);
  document.querySelector<HTMLButtonElement>("#outside")?.click();
  expect(details.open).toBe(false);
});

test("closes an open menu with Escape and restores focus to its trigger", () => {
  document.body.innerHTML = `
    <details class="history-export-menu" open>
      <summary>Export</summary>
      <button type="button">CSV</button>
    </details>`;
  const details = document.querySelector("details") as HTMLDetailsElement;
  const summary = details.querySelector("summary") as HTMLElement;
  const action = details.querySelector("button") as HTMLButtonElement;
  setupOutsideDismiss(details);
  action.focus();

  action.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );

  expect(details.open).toBe(false);
  expect(document.activeElement).toBe(summary);
});

test("supports the default resources target and an absent target", () => {
  document.body.innerHTML =
    '<details class="nav-resources" open></details><button>Outside</button>';

  setupOutsideDismiss();
  document.querySelector("button")!.click();

  expect(document.querySelector<HTMLDetailsElement>("details")!.open).toBe(false);
  document.body.innerHTML = "";
  expect(() => setupOutsideDismiss()).not.toThrow();
});

test("automatically wires supported details menus", async () => {
  vi.resetModules();
  document.body.innerHTML = `
    <details class="history-export-menu" open></details>
    <button id="outside">Outside</button>`;

  await import("../../src/options/dismissible-details.ts");
  document.querySelector<HTMLButtonElement>("#outside")!.click();

  expect(document.querySelector<HTMLDetailsElement>("details")!.open).toBe(false);
});

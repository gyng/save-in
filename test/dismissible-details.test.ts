// @vitest-environment jsdom
import { setupOutsideDismiss } from "../src/options/dismissible-details.ts";

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

// @vitest-environment jsdom
import { setupCheckboxRows } from "../src/options/checkbox-rows.ts";

test("groups a checkbox title separately from its help text", () => {
  document.body.innerHTML = `
    <label id="option">
      <input type="checkbox"> Save linked media <em>now</em>
      <span class="caption">Explains the setting</span>
    </label>
    <label id="ready"><input type="checkbox"><span class="opt-title">Ready</span></label>`;

  setupCheckboxRows();
  setupCheckboxRows();

  const label = document.querySelector("#option")!;
  expect(label.querySelector(":scope > .opt-title")?.textContent).toContain(
    "Save linked media now",
  );
  expect(label.querySelector(":scope > .caption")?.textContent).toBe("Explains the setting");
  expect(label.querySelectorAll(":scope > .opt-title")).toHaveLength(1);
  expect(document.querySelectorAll("#ready > .opt-title")).toHaveLength(1);
});

test("prevents row and passive-help clicks without blocking interactive help", () => {
  document.body.innerHTML = `
    <label id="option">
      <input type="checkbox">
      <span class="caption"><span id="help">Help</span><a id="link" href="#details">Details</a></span>
    </label>
    <div class="caption" id="standalone-help">Standalone help</div>
    <div id="outside">Outside</div>`;
  setupCheckboxRows();
  const label = document.querySelector("#option")!;
  const help = document.querySelector("#help")!;
  const link = document.querySelector("#link")!;
  const outside = document.querySelector("#outside")!;
  const standaloneHelp = document.querySelector("#standalone-help")!;

  expect(label.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))).toBe(
    false,
  );
  expect(help.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))).toBe(
    false,
  );
  expect(link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))).toBe(
    true,
  );
  expect(outside.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))).toBe(
    true,
  );
  expect(
    standaloneHelp.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })),
  ).toBe(true);

  const text = document.createTextNode("plain text");
  document.body.append(text);
  expect(text.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))).toBe(
    true,
  );
});

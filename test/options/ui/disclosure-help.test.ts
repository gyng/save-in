// @vitest-environment jsdom
import { setupHelpDisclosures } from "../../../src/options/ui/disclosure-help.ts";

test("toggles the target's hidden state and aria-expanded", () => {
  document.body.innerHTML = `
    <button class="help" data-help-for="help-target">Help</button>
    <p id="help-target" hidden>More info</p>`;
  setupHelpDisclosures();

  const trigger = document.querySelector<HTMLButtonElement>(".help")!;
  trigger.scrollIntoView = vi.fn();
  expect(trigger.getAttribute("aria-controls")).toBe("help-target");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");

  trigger.click();
  const target = document.querySelector<HTMLElement>("#help-target")!;
  expect(target.hidden).toBe(false);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");

  trigger.click();
  expect(target.hidden).toBe(true);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

test("tolerates a trigger with no data-help-for target", () => {
  document.body.innerHTML = `<button class="help">Help</button>`;
  setupHelpDisclosures();
  const trigger = document.querySelector<HTMLButtonElement>(".help")!;
  expect(trigger.hasAttribute("aria-controls")).toBe(false);
  expect(() => trigger.click()).not.toThrow();
});

test("tolerates a data-help-for id that does not resolve to an element", () => {
  document.body.innerHTML = `<button class="help" data-help-for="missing">Help</button>`;
  setupHelpDisclosures();
  expect(() => document.querySelector<HTMLButtonElement>(".help")!.click()).not.toThrow();
});

test("skips the aria wiring for a non-HTMLElement match", () => {
  document.body.innerHTML = `<svg class="help"></svg>`;
  expect(() => setupHelpDisclosures()).not.toThrow();
  expect(document.querySelector(".help")!.hasAttribute("aria-controls")).toBe(false);
});

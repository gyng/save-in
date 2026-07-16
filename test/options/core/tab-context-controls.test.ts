// @vitest-environment jsdom
import { updateTabContextControls } from "../../../src/options/core/tab-context-controls.ts";

beforeEach(() => {
  document.body.innerHTML = `
    <input
      class="tab-context-required"
      id="tab-control"
      data-tab-context-requirement="tab-requirement"
      aria-describedby="permanent-help tab-requirement"
    >
    <span id="tab-requirement" hidden>Chrome 150+</span>
    <input class="tab-context-required" id="unbadged-control">
    <input
      class="tab-context-required"
      id="missing-badge-control"
      data-tab-context-requirement="missing-badge"
    >`;
});

test("shows and describes unavailable tab-context requirements", () => {
  updateTabContextControls(false);

  const control = document.querySelector<HTMLInputElement>("#tab-control")!;
  expect(control.disabled).toBe(true);
  expect(control.getAttribute("aria-describedby")).toBe("permanent-help tab-requirement");
  expect(document.querySelector<HTMLElement>("#tab-requirement")!.hidden).toBe(false);
  expect(document.querySelector<HTMLInputElement>("#unbadged-control")!.disabled).toBe(true);
  expect(
    document.querySelector<HTMLInputElement>("#unbadged-control")!.hasAttribute("aria-describedby"),
  ).toBe(false);
  expect(
    document
      .querySelector<HTMLInputElement>("#missing-badge-control")!
      .getAttribute("aria-describedby"),
  ).toBe("missing-badge");
});

test("hides conditional descriptions when tab contexts are supported", () => {
  updateTabContextControls(true, document.body);

  const control = document.querySelector<HTMLInputElement>("#tab-control")!;
  expect(control.disabled).toBe(false);
  expect(control.getAttribute("aria-describedby")).toBe("permanent-help");
  expect(document.querySelector<HTMLElement>("#tab-requirement")!.hidden).toBe(true);
  expect(document.querySelector<HTMLInputElement>("#missing-badge-control")!.disabled).toBe(false);
  expect(
    document
      .querySelector<HTMLInputElement>("#missing-badge-control")!
      .hasAttribute("aria-describedby"),
  ).toBe(false);
});

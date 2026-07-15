// @vitest-environment jsdom

import { afterEach, expect, test, vi } from "vitest";

import {
  positionDetailsMenu,
  setupDetailsMenuPositioning,
} from "../../src/options/details-menu-positioning.ts";

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  }) as DOMRect;

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

test("positions details menus against their trigger and logical alignment", () => {
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(320);
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(240);
  document.body.innerHTML = `
    <details class="details-popup" open>
      <summary>More</summary>
      <div class="menu-popover path-editor-action-menu"></div>
    </details>`;
  const details = document.querySelector("details")!;
  const trigger = document.querySelector("summary")!;
  const menu = document.querySelector<HTMLElement>(".menu-popover")!;
  trigger.getBoundingClientRect = vi.fn(() => rect(200, 40, 40, 32));
  menu.getBoundingClientRect = vi.fn(() => rect(0, 0, 100, 80));

  const placement = positionDetailsMenu(details);

  expect(placement).toMatchObject({ left: 140, top: 76, side: "below" });
  expect(menu.style.position).toBe("fixed");
  expect(menu.style.left).toBe("140px");
});

test("ignores closed and incomplete disclosures", () => {
  document.body.innerHTML = `<details><summary>Closed</summary></details>`;
  const details = document.querySelector("details")!;
  expect(positionDetailsMenu(details)).toBeNull();
  details.open = true;
  expect(positionDetailsMenu(details)).toBeNull();
  details.querySelector("summary")!.remove();
  details.append(Object.assign(document.createElement("div"), { className: "menu-popover" }));
  expect(positionDetailsMenu(details)).toBeNull();
});

test.each([
  ["path-editor-action-menu", "100px"],
  ["plain-menu", "60px"],
])("maps %s through a right-to-left disclosure", (className, expectedLeft) => {
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(320);
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(240);
  document.body.innerHTML = `
    <details open style="direction: rtl">
      <summary>More</summary>
      <div class="menu-popover ${className}"></div>
    </details>`;
  const details = document.querySelector("details")!;
  const trigger = document.querySelector("summary")!;
  const menu = document.querySelector<HTMLElement>(".menu-popover")!;
  trigger.getBoundingClientRect = vi.fn(() => rect(100, 40, 40, 32));
  menu.getBoundingClientRect = vi.fn(() => rect(0, 0, 80, 60));

  positionDetailsMenu(details);

  expect(menu.style.left).toBe(expectedLeft);
});

test("sizes floating reference lists to their disclosure and repositions newly opened menus", async () => {
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(480);
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(320);
  document.body.innerHTML = `
    <details class="details-popup">
      <summary>Variables</summary>
      <div class="variables-preview-list"></div>
    </details>`;
  const details = document.querySelector("details")!;
  const trigger = document.querySelector("summary")!;
  const list = document.querySelector<HTMLElement>(".variables-preview-list")!;
  details.getBoundingClientRect = vi.fn(() => rect(30, 30, 220, 34));
  trigger.getBoundingClientRect = vi.fn(() => rect(30, 30, 100, 34));
  list.getBoundingClientRect = vi.fn(() => rect(0, 0, 220, 180));
  setupDetailsMenuPositioning();

  details.open = true;
  await vi.waitFor(() => expect(list.style.position).toBe("fixed"));

  expect(list.style.width).toBe("220px");
  expect(Number.parseFloat(list.style.maxHeight)).toBeLessThanOrEqual(180);
});

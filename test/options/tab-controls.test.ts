// @vitest-environment jsdom

import {
  bindTabInteractions,
  nextTabIndex,
  syncTabSelection,
} from "../../src/options/tab-controls.ts";

test.each([
  ["ArrowRight", 0, 3, 1],
  ["ArrowDown", 2, 3, 0],
  ["ArrowLeft", 0, 3, 2],
  ["ArrowUp", 1, 3, 0],
  ["Home", 2, 3, 0],
  ["End", 0, 3, 2],
  ["Home", 0, 0, -1],
])("maps %s from %i of %i tabs to %i", (key, current, count, expected) => {
  expect(nextTabIndex(key, current, count)).toBe(expected);
});

test("synchronizes selection, panels, clicks, and keyboard focus", () => {
  document.body.innerHTML = `
    <button id="one" role="tab">One</button>
    <button id="two" role="tab">Two</button>
    <section id="panel-one" role="tabpanel"></section>
    <section id="panel-two" role="tabpanel"></section>`;
  const tabs = [...document.querySelectorAll<HTMLElement>("[role='tab']")];
  const panels = [...document.querySelectorAll<HTMLElement>("[role='tabpanel']")];
  const select = (index: number, focus: boolean) => {
    syncTabSelection(tabs, panels, index);
    if (focus) tabs[index]?.focus();
  };
  bindTabInteractions(tabs, select);
  select(0, false);

  expect(tabs[0]!.tabIndex).toBe(0);
  expect(tabs[1]!.tabIndex).toBe(-1);
  expect(panels[1]!.hidden).toBe(true);

  tabs[1]!.click();
  expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
  expect(panels[1]!.hidden).toBe(false);

  tabs[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  expect(document.activeElement).toBe(tabs[0]);
  expect(panels[0]!.hidden).toBe(false);

  tabs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(document.activeElement).toBe(tabs[0]);
  expect(panels[0]!.hidden).toBe(false);
});

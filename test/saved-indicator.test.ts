import { markSavedNow } from "../src/options/saved-indicator.ts";

test("marks the top status as successfully saved", () => {
  document.body.innerHTML = '<span id="lastSavedAt">never</span>';
  markSavedNow();
  const indicator = document.querySelector("#lastSavedAt")!;
  expect(indicator.textContent).not.toBe("never");
  expect(indicator.classList.contains("saved-confirmed")).toBe(true);
});

// @vitest-environment jsdom
import { showUnsavedChangesDialog } from "../src/options/unsaved-changes-dialog.ts";

test.each([
  [true, "keep"],
  [false, "discard"],
] as const)("resolves the selected choice", async (chooseDefault, expected) => {
  const result = showUnsavedChangesDialog("Discard your unsaved changes, or keep editing?");
  const dialog = document.querySelector("dialog")!;
  const buttons = [...dialog.querySelectorAll("button")];

  expect(buttons).toHaveLength(2);
  const selected = chooseDefault
    ? document.activeElement
    : buttons.find((button) => !button.matches(":focus"));
  expect(selected).toBeInstanceOf(HTMLButtonElement);
  (selected as HTMLButtonElement).click();

  await expect(result).resolves.toBe(expected);
  expect(document.querySelector("dialog")).toBeNull();
});

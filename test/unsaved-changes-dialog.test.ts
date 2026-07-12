import { showUnsavedChangesDialog } from "../src/options/unsaved-changes-dialog.ts";

test.each([
  ["Keep editing", "keep"],
  ["Discard changes", "discard"],
] as const)("offers an explicit %s choice", async (label, expected) => {
  const result = showUnsavedChangesDialog("Discard your unsaved changes, or keep editing?");
  const dialog = document.querySelector("dialog")!;

  expect([...dialog.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
    "Keep editing",
    "Discard changes",
  ]);
  [...dialog.querySelectorAll("button")].find((button) => button.textContent === label)!.click();

  await expect(result).resolves.toBe(expected);
  expect(document.querySelector("dialog")).toBeNull();
});

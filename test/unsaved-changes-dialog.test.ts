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
  expect(dialog.getAttribute("aria-describedby")).toBe("unsaved-changes-description");
  expect(document.getElementById("unsaved-changes-description")?.textContent).toBe(
    "Discard your unsaved changes, or keep editing?",
  );
  const selected = chooseDefault
    ? document.activeElement
    : buttons.find((button) => !button.matches(":focus"));
  expect(selected).toBeInstanceOf(HTMLButtonElement);
  (selected as HTMLButtonElement).click();

  await expect(result).resolves.toBe(expected);
  expect(document.querySelector("dialog")).toBeNull();
});

test("keeps editing when the modal is canceled", async () => {
  const showModal = vi.fn();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: showModal,
  });
  try {
    const result = showUnsavedChangesDialog("Keep these edits?");
    const dialog = document.querySelector("dialog")!;
    const cancel = new Event("cancel", { cancelable: true });

    dialog.dispatchEvent(cancel);

    expect(cancel.defaultPrevented).toBe(true);
    expect(showModal).toHaveBeenCalledOnce();
    await expect(result).resolves.toBe("keep");
  } finally {
    Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  }
});

test("uses readable action copy without localization or modal support", async () => {
  const result = showUnsavedChangesDialog("Keep these edits?", () => "");
  const dialog = document.querySelector("dialog")!;
  expect(dialog.querySelector("h2")?.textContent).toBe("Unsaved changes");
  expect([...dialog.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
    "Keep editing",
    "Discard changes",
  ]);
  expect(dialog.hasAttribute("open")).toBe(true);
  dialog.querySelector<HTMLButtonElement>("button")!.click();
  await expect(result).resolves.toBe("keep");
});

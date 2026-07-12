import {
  assertSettingsUndoCurrent,
  assertSettingsUndoSafe,
  markSavedNow,
} from "../src/options/saved-indicator.ts";

test("marks the top status as successfully saved", () => {
  document.body.innerHTML = '<span id="lastSavedAt">never</span>';
  markSavedNow();
  const indicator = document.querySelector("#lastSavedAt")!;
  expect(indicator.textContent).not.toBe("never");
  expect(indicator.classList.contains("saved-confirmed")).toBe(true);
});

test("shows the saved delta and offers undo", async () => {
  const undo = vi.fn();
  document.body.innerHTML = `
    <div class="save-status"><span>Updated</span><span id="lastSavedAt">never</span></div>`;
  markSavedNow([{ name: "notifyOnSuccess", before: true, after: false }], undo);
  expect(document.querySelector(".saved-change-popover")?.textContent).toContain(
    "Notify On SuccessOn → Off",
  );
  expect(document.querySelector(".saved-change-popover button")).toBeNull();
  document.querySelector<HTMLButtonElement>(".saved-change-undo")!.click();
  await vi.waitFor(() => expect(undo).toHaveBeenCalledOnce());
});

test("blocks Undo while another setting or editor still has a draft", () => {
  expect(() => assertSettingsUndoSafe(true, false)).toThrow("other edits");
  expect(() => assertSettingsUndoSafe(false, true)).toThrow("other edits");
  expect(() => assertSettingsUndoSafe(false, false)).not.toThrow();
});

test("blocks Undo when another options page changed the setting again", () => {
  const changes = [{ name: "notifyOnSuccess", before: true, after: false }];
  expect(() => assertSettingsUndoCurrent(changes, { notifyOnSuccess: true })).toThrow(
    "changed again",
  );
  expect(() => assertSettingsUndoCurrent(changes, { notifyOnSuccess: false })).not.toThrow();
});

test("explains why Undo could not run and keeps it available", async () => {
  document.body.innerHTML = `
    <div class="save-status"><span id="lastSavedAt">never</span></div>`;
  markSavedNow([], undefined);
  markSavedNow([{ name: "prompt", before: false, after: true }], () => {
    throw new Error("Finish or discard your other edits before undoing");
  });
  const undo = document.querySelector<HTMLButtonElement>(".saved-change-undo")!;
  undo.click();
  await vi.waitFor(() => expect(undo.disabled).toBe(false));
  expect(undo.textContent).toContain("other edits");
});

test("clears stale popover accessibility state after the change is dismissed", () => {
  document.body.innerHTML = `
    <div class="save-status"><span id="lastSavedAt">never</span></div>`;
  markSavedNow([{ name: "prompt", before: false, after: true }]);
  const status = document.querySelector<HTMLElement>(".save-status")!;
  expect(status.getAttribute("aria-describedby")).toBe("saved-change-popover");

  markSavedNow();
  expect(status.hasAttribute("aria-describedby")).toBe(false);
  expect(status.hasAttribute("tabindex")).toBe(false);
});

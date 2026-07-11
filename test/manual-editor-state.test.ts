import { createManualEditorState } from "../src/options/manual-editor-state.ts";

describe("manual editor state", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <textarea id="paths">saved</textarea>
      <div><button data-discard="paths">Discard</button><button data-apply="paths">Apply</button></div>`;
  });

  test("announces dirty state and enables actions, then re-baselines", () => {
    const state = createManualEditorState("Unsaved changes");
    state.setup("paths");
    const textarea = document.querySelector("textarea")!;
    const buttons = [...document.querySelectorAll("button")];
    const status = document.querySelector<HTMLElement>(".editor-dirty-status")!;

    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(status.hidden).toBe(true);
    expect(state.anyDirty()).toBe(false);

    textarea.value = "changed";
    textarea.dispatchEvent(new InputEvent("input"));
    expect(buttons.every((button) => !button.disabled)).toBe(true);
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe("Unsaved changes");
    expect(state.anyDirty()).toBe(true);

    state.refreshBaselines();
    expect(status.hidden).toBe(true);
    expect(state.anyDirty()).toBe(false);
  });

  test("discard restores the saved baseline through the existing input contract", () => {
    const state = createManualEditorState("Unsaved changes");
    state.setup("paths");
    const textarea = document.querySelector("textarea")!;
    const onInput = vi.fn();
    textarea.addEventListener("input", onInput);
    textarea.value = "changed";

    expect(state.discard("paths")).toBe(true);
    expect(textarea.value).toBe("saved");
    expect(onInput).toHaveBeenCalledOnce();
    expect(state.discard("missing")).toBe(false);
  });

  test("reports dirty editor ids for scoped save-before-navigation", () => {
    const state = createManualEditorState("Unsaved changes");
    state.setup("paths");
    const textarea = document.querySelector("textarea")!;
    textarea.value = "changed";
    textarea.dispatchEvent(new InputEvent("input"));
    expect(state.dirtyIds()).toEqual(["paths"]);
  });

  test("Ctrl/Cmd+Enter applies and Ctrl/Cmd+Escape discards", () => {
    const state = createManualEditorState("Unsaved changes");
    state.setup("paths");
    const textarea = document.querySelector("textarea")!;
    const apply = document.querySelector<HTMLButtonElement>("[data-apply]")!;
    const discard = document.querySelector<HTMLButtonElement>("[data-discard]")!;
    const onApply = vi.fn();
    const onDiscard = vi.fn(() => state.discard("paths"));
    apply.addEventListener("click", onApply);
    discard.addEventListener("click", onDiscard);

    textarea.value = "changed";
    textarea.dispatchEvent(new InputEvent("input"));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }));
    expect(onApply).toHaveBeenCalledOnce();

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onDiscard).not.toHaveBeenCalled();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", ctrlKey: true }));
    expect(onDiscard).toHaveBeenCalledOnce();
    expect(textarea.value).toBe("saved");
  });

  test("Escape only closes an open autocomplete instead of discarding", () => {
    const state = createManualEditorState("Unsaved changes");
    state.setup("paths");
    const textarea = document.querySelector("textarea")!;
    const discard = document.querySelector<HTMLButtonElement>("[data-discard]")!;
    const onDiscard = vi.fn();
    discard.addEventListener("click", onDiscard);
    textarea.value = "changed";
    textarea.dispatchEvent(new InputEvent("input"));
    textarea.setAttribute("aria-expanded", "true");
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onDiscard).not.toHaveBeenCalled();
    expect(textarea.value).toBe("changed");
  });

  test("fatal validation blocks Apply but leaves Discard available", () => {
    const state = createManualEditorState("Unsaved changes");
    state.setup("paths");
    const textarea = document.querySelector("textarea")!;
    const apply = document.querySelector<HTMLButtonElement>("[data-apply]")!;
    const discard = document.querySelector<HTMLButtonElement>("[data-discard]")!;
    textarea.value = "invalid";
    textarea.dispatchEvent(new InputEvent("input"));
    state.setValidity("paths", false);
    expect(apply.disabled).toBe(true);
    expect(discard.disabled).toBe(false);
    expect(textarea.getAttribute("aria-invalid")).toBe("true");
    state.setValidity("paths", true);
    expect(apply.disabled).toBe(false);
    expect(textarea.hasAttribute("aria-invalid")).toBe(false);
  });

  test("only marks an editor saved after explicit success", () => {
    const state = createManualEditorState("Unsaved changes");
    state.setup("paths");
    const textarea = document.querySelector("textarea")!;
    textarea.value = "changed";
    textarea.dispatchEvent(new InputEvent("input"));
    state.setSaving("paths", true, "Saving…");
    expect(state.anyDirty()).toBe(true);
    expect(document.querySelector<HTMLElement>(".editor-save-status")!.textContent).toBe("Saving…");
    state.setSaving("paths", false);
    expect(state.anyDirty()).toBe(true);
    const applied = vi.fn();
    textarea.addEventListener("options-value-applied", applied);
    state.markSaved("paths", "Saved", "normalized");
    expect(state.anyDirty()).toBe(false);
    expect(textarea.value).toBe("normalized");
    expect(document.querySelector<HTMLElement>(".editor-save-status")!.textContent).toBe("Saved");
    expect(document.querySelector<HTMLElement>(".editor-save-status")!.hidden).toBe(false);
    expect(applied).toHaveBeenCalledOnce();
  });

  test("does not overwrite edits made after a save started", () => {
    const state = createManualEditorState("Unsaved changes");
    state.setup("paths");
    const textarea = document.querySelector("textarea")!;
    textarea.value = "submitted";
    textarea.dispatchEvent(new InputEvent("input"));
    const revision = state.revision("paths");
    textarea.value = "newer edit";
    textarea.dispatchEvent(new InputEvent("input"));
    expect(state.markSaved("paths", "Saved", "submitted", revision)).toBe(false);
    expect(textarea.value).toBe("newer edit");
    expect(state.anyDirty()).toBe(true);
    expect(document.querySelector<HTMLElement>(".editor-save-status")!.hidden).toBe(true);
  });

  test("reports whether an editor can currently be saved", () => {
    const state = createManualEditorState("Unsaved changes");
    state.setup("paths");
    expect(state.canSave("paths")).toBe(true);
    state.setValidationPending("paths");
    expect(state.canSave("paths")).toBe(false);
    state.setValidity("paths", false);
    expect(state.canSave("paths")).toBe(false);
    state.setValidity("paths", true);
    state.setSaving("paths", true, "Saving…");
    expect(state.canSave("paths")).toBe(false);
  });

  test("validation failure clears pending state and exposes retry without enabling Apply", () => {
    const state = createManualEditorState("Unsaved changes");
    state.setup("paths");
    const textarea = document.querySelector("textarea")!;
    textarea.value = "changed";
    textarea.dispatchEvent(new InputEvent("input"));
    state.setValidationPending("paths");
    state.setValidationUnavailable("paths");
    expect(document.querySelector<HTMLButtonElement>("[data-apply]")!.disabled).toBe(true);
    expect(textarea.getAttribute("aria-busy")).toBe("false");
  });
});

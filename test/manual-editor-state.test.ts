// @vitest-environment jsdom
import { createManualEditorState } from "../src/options/manual-editor-state.ts";

describe("manual editor state", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <textarea id="paths">saved</textarea>
      <span data-manual-help-for="paths">Changes are saved when you select Apply.</span>
      <div><button data-discard="paths">Discard</button><button data-apply="paths">Apply</button></div>`;
  });

  test("announces dirty state and enables actions, then re-baselines", () => {
    const state = createManualEditorState("Unsaved changes");
    state.setup("paths");
    const textarea = document.querySelector("textarea")!;
    const buttons = [...document.querySelectorAll("button")];
    const status = document.querySelector<HTMLElement>(".editor-dirty-status")!;
    const help = document.querySelector<HTMLElement>("[data-manual-help-for=paths]")!;

    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(status.hidden).toBe(true);
    expect(help.hidden).toBe(true);
    expect(state.anyDirty()).toBe(false);

    textarea.value = "changed";
    textarea.dispatchEvent(new InputEvent("input"));
    expect(buttons.every((button) => !button.disabled)).toBe(true);
    expect(status.hidden).toBe(false);
    expect(help.hidden).toBe(false);
    expect(status.textContent).toBe("Unsaved changes");
    expect(state.anyDirty()).toBe(true);

    state.refreshBaselines();
    expect(status.hidden).toBe(true);
    expect(help.hidden).toBe(true);
    expect(state.anyDirty()).toBe(false);
  });

  test("keeps an unrecognized editor id functional without visual row assumptions", () => {
    document.body.innerHTML = `
      <textarea id="legacyEditor">saved</textarea>
      <div><button data-discard="legacyEditor">Discard</button><button data-apply="legacyEditor">Apply</button></div>`;
    const state = createManualEditorState("Unsaved changes");
    state.setup("legacyEditor");
    const textarea = document.querySelector("textarea")!;

    textarea.value = "changed";
    textarea.dispatchEvent(new InputEvent("input"));

    expect(state.anyDirty()).toBe(true);
    expect([...document.querySelectorAll("button")].every((button) => !button.disabled)).toBe(true);
  });

  test("marks only changed visual rows while the editor is dirty", () => {
    document.body.innerHTML = `
      <div class="syntax-editor"><textarea id="paths">saved\nother</textarea></div>
      <div id="paths-visual">
        <div class="path-editor-row" data-source-index="0"></div>
        <div class="path-editor-row" data-source-index="1"></div>
        <div><button data-discard="paths">Discard</button><button data-apply="paths">Apply</button></div>
      </div>`;
    const state = createManualEditorState("Unsaved changes");
    state.setup("paths");
    const textarea = document.querySelector("textarea")!;
    const rows = [...document.querySelectorAll<HTMLElement>(".path-editor-row")];

    expect(rows.every((row) => !row.classList.contains("is-dirty-row"))).toBe(true);

    textarea.value = "changed\nother";
    textarea.dispatchEvent(new InputEvent("input"));
    expect(rows[0]?.classList).toContain("is-dirty-row");
    expect(rows[1]?.classList).not.toContain("is-dirty-row");

    state.refreshBaselines();
    expect(rows.every((row) => !row.classList.contains("is-dirty-row"))).toBe(true);
  });

  test("restores dirty markers after a routing visual editor rerenders", () => {
    document.body.innerHTML = `
      <textarea id="filenamePatterns">filename: jpg\ninto: images\n\nfilename: pdf\ninto: docs</textarea>
      <div id="rules-visual">
        <section class="rule-editor-card" data-rule-index="0"></section>
        <section class="rule-editor-card" data-rule-index="1"></section>
        <div><button data-discard="filenamePatterns">Discard</button><button data-apply="filenamePatterns">Apply</button></div>
      </div>`;
    const state = createManualEditorState("Unsaved changes");
    state.setup("filenamePatterns");
    const textarea = document.querySelector("textarea")!;
    textarea.value = "filename: jpg\ninto: images\n\nfilename: pdf\ninto: archive";
    textarea.dispatchEvent(new InputEvent("input"));

    const visual = document.querySelector<HTMLElement>("#rules-visual")!;
    visual.querySelectorAll(".rule-editor-card").forEach((card) => card.remove());
    visual.insertAdjacentHTML(
      "afterbegin",
      '<section class="rule-editor-card" data-rule-index="0"></section><section class="rule-editor-card" data-rule-index="1"></section>',
    );
    textarea.dispatchEvent(new Event("visual-editor-rendered"));

    const cards = [...visual.querySelectorAll<HTMLElement>(".rule-editor-card")];
    expect(cards[0]?.classList).not.toContain("is-dirty-row");
    expect(cards[1]?.classList).toContain("is-dirty-row");
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
    state.setSaving("paths", true, "Saving…");
    textarea.value = "newer edit";
    textarea.dispatchEvent(new InputEvent("input"));
    expect(state.markSaved("paths", "Saved", "submitted", revision)).toBe(false);
    expect(textarea.value).toBe("newer edit");
    expect(state.anyDirty()).toBe(true);
    expect(document.querySelector<HTMLElement>(".editor-save-status")!.hidden).toBe(true);
    expect(state.discard("paths")).toBe(true);
    expect(textarea.value).toBe("submitted");
  });

  test("an externally restored baseline supersedes an in-flight save", () => {
    const state = createManualEditorState("Unsaved changes");
    state.setup("paths");
    const textarea = document.querySelector("textarea")!;
    textarea.value = "submitted";
    textarea.dispatchEvent(new InputEvent("input"));
    const revision = state.revision("paths");
    state.setSaving("paths", true, "Saving…");

    textarea.value = "imported";
    state.refreshBaselines();

    expect(state.markSaved("paths", "Saved", "submitted", revision)).toBe(false);
    expect(textarea.value).toBe("imported");
    expect(state.anyDirty()).toBe(false);
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
    expect(state.anySaving()).toBe(true);
    state.setSaving("paths", false);
    expect(state.anySaving()).toBe(false);
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

  test("supports dynamic unsaved copy and ignores incomplete editor markup", () => {
    let label = "First label";
    const state = createManualEditorState(() => label);
    document.body.innerHTML = '<textarea id="missing-actions"></textarea>';
    expect(state.setup("missing-actions")).toBeUndefined();
    expect(state.setup("missing-textarea")).toBeUndefined();

    document.body.innerHTML = `
      <textarea id="paths">saved</textarea>
      <div><button data-discard="paths">Discard</button><button data-apply="paths">Apply</button></div>`;
    state.setup("paths");
    label = "Updated label";
    const textarea = document.querySelector("textarea")!;
    textarea.value = "changed";
    textarea.dispatchEvent(new InputEvent("input"));
    expect(document.querySelector(".editor-dirty-status")?.textContent).toBe("Updated label");
  });

  test("returns false for operations targeting an unknown editor", () => {
    const state = createManualEditorState("Unsaved");
    expect(state.setValidity("missing", true)).toBe(false);
    expect(state.setValidationPending("missing")).toBe(false);
    expect(state.setValidationUnavailable("missing")).toBe(false);
    expect(state.setSaving("missing", true)).toBe(false);
    expect(state.markSaved("missing")).toBe(false);
    expect(state.canSave("missing")).toBe(false);
    expect(state.revision("missing")).toBeUndefined();
  });

  test("does not dispatch a disabled keyboard Apply", () => {
    const state = createManualEditorState("Unsaved");
    state.setup("paths");
    const textarea = document.querySelector("textarea")!;
    const apply = document.querySelector<HTMLButtonElement>("[data-apply]")!;
    const clicked = vi.fn();
    apply.addEventListener("click", clicked);

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }));
    expect(clicked).not.toHaveBeenCalled();
  });

  test("supports unlabeled save transitions without an applied replacement value", () => {
    const state = createManualEditorState("Unsaved");
    state.setup("paths");
    const textarea = document.querySelector("textarea")!;
    textarea.value = "changed";
    textarea.dispatchEvent(new InputEvent("input"));
    expect(state.setSaving("paths", true)).toBe(true);
    expect(document.querySelector<HTMLElement>(".editor-save-status")!.hidden).toBe(true);

    expect(state.markSaved("paths")).toBe(true);
    expect(state.anyDirty()).toBe(false);
    expect(document.querySelector<HTMLElement>(".editor-dirty-status")!.textContent).toBe(
      "Unsaved",
    );
    expect(document.querySelector<HTMLElement>(".editor-save-status")!.textContent).toBe("");
  });

  test("announces a non-string applied value without replacing the textarea", () => {
    const state = createManualEditorState("Unsaved");
    state.setup("paths");
    const textarea = document.querySelector("textarea")!;
    const applied = vi.fn();
    textarea.addEventListener("options-value-applied", applied);
    textarea.value = "changed";
    textarea.dispatchEvent(new InputEvent("input"));

    expect(state.markSaved("paths", undefined, { normalized: true })).toBe(true);
    expect(textarea.value).toBe("changed");
    expect((applied.mock.calls[0]![0] as CustomEvent).detail).toEqual({ normalized: true });
  });
});

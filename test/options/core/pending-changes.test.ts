// @vitest-environment jsdom
import {
  createPendingChangesTracker,
  type ManualEditorDirtyState,
  type PendingChangesPorts,
} from "../../../src/options/core/pending-changes.ts";
import { showUnsavedChangesDialog } from "../../../src/options/dialogs/unsaved-changes-dialog.ts";

vi.mock("../../../src/options/dialogs/unsaved-changes-dialog.ts", () => ({
  showUnsavedChangesDialog: vi.fn(),
}));

const makeManualEditorState = (
  overrides: Partial<ManualEditorDirtyState> = {},
): ManualEditorDirtyState => ({
  anySaving: vi.fn(() => false),
  anyDirty: vi.fn(() => false),
  dirtyIds: vi.fn(() => []),
  discard: vi.fn(() => true),
  ...overrides,
});

const makePorts = (overrides: Partial<PendingChangesPorts> = {}): PendingChangesPorts => ({
  saveOptions: vi.fn().mockResolvedValue(undefined),
  restoreOptions: vi.fn().mockResolvedValue(undefined),
  afterAutosave: vi.fn(),
  manualEditorState: makeManualEditorState(),
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(showUnsavedChangesDialog).mockReset();
  vi.mocked(browser.i18n.getMessage)
    .mockReset()
    .mockImplementation((key) => `Translated<${key}>`);
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("field autosave", () => {
  test("saves a text field immediately, clears the dirty flag, and refreshes derived UI shortly after", async () => {
    const ports = makePorts();
    const tracker = createPendingChangesTracker(ports);
    document.body.innerHTML = `<div><input id="recentDestinationCount" type="number"></div>`;
    const input = document.querySelector<HTMLInputElement>("#recentDestinationCount")!;
    tracker.setupAutosave(input);

    input.value = "3";
    input.dispatchEvent(new Event("input"));

    // Single-value fields save on the same tick as the edit, not debounced.
    expect(ports.saveOptions).toHaveBeenCalledWith(undefined, "recentDestinationCount", "3");
    expect(tracker.hasUnsavedField()).toBe(true);

    await vi.advanceTimersByTimeAsync(0);
    expect(tracker.hasUnsavedField()).toBe(false);
    expect(ports.afterAutosave).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(input.parentElement?.classList.contains("saved")).toBe(true);

    await vi.advanceTimersByTimeAsync(100);
    expect(ports.afterAutosave).toHaveBeenCalledOnce();
  });

  test("saves a detached field with no parent to show the saved indicator on", async () => {
    const ports = makePorts();
    const tracker = createPendingChangesTracker(ports);
    const input = document.createElement("input");
    input.type = "text";
    input.id = "detachedField";
    tracker.setupAutosave(input);

    input.value = "x";
    input.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(0);

    expect(ports.saveOptions).toHaveBeenCalledWith(undefined, "detachedField", "x");
  });

  test("autosaves a checkbox from its checked state on change", async () => {
    const ports = makePorts();
    const tracker = createPendingChangesTracker(ports);
    document.body.innerHTML = `<input id="notifyOnSuccess" type="checkbox">`;
    const input = document.querySelector<HTMLInputElement>("#notifyOnSuccess")!;
    tracker.setupAutosave(input);

    input.checked = true;
    input.dispatchEvent(new Event("change"));

    expect(ports.saveOptions).toHaveBeenCalledWith(undefined, "notifyOnSuccess", true);
    await vi.advanceTimersByTimeAsync(0);
  });

  test("debounces a textarea edit and saves once after the delay, restarting on further input", async () => {
    const ports = makePorts();
    const tracker = createPendingChangesTracker(ports);
    document.body.innerHTML = `<textarea id="filenamePatterns"></textarea>`;
    const textarea = document.querySelector<HTMLTextAreaElement>("#filenamePatterns")!;
    tracker.setupAutosave(textarea);

    textarea.value = "a";
    textarea.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(399);
    expect(ports.saveOptions).not.toHaveBeenCalled();

    // A second edit inside the debounce window pushes the deadline back out.
    textarea.value = "ab";
    textarea.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(399);
    expect(ports.saveOptions).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(ports.saveOptions).toHaveBeenCalledTimes(1);
    expect(ports.saveOptions).toHaveBeenCalledWith(undefined, "filenamePatterns", "ab");
  });

  test("flushes a pending textarea debounce on blur, and does nothing when none is pending", async () => {
    const ports = makePorts();
    const tracker = createPendingChangesTracker(ports);
    document.body.innerHTML = `<textarea id="paths"></textarea>`;
    const textarea = document.querySelector<HTMLTextAreaElement>("#paths")!;
    tracker.setupAutosave(textarea);

    textarea.value = "a";
    textarea.dispatchEvent(new Event("input"));
    textarea.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(0);
    expect(ports.saveOptions).toHaveBeenCalledWith(undefined, "paths", "a");

    // A blur with no pending debounce must not schedule a duplicate save.
    textarea.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(ports.saveOptions).toHaveBeenCalledTimes(1);
  });

  test("shows a retryable failure message when the save rejects, and clears it on retry success", async () => {
    const ports = makePorts({
      saveOptions: vi
        .fn()
        .mockRejectedValueOnce(new Error("network down"))
        .mockResolvedValueOnce(undefined),
    });
    const tracker = createPendingChangesTracker(ports);
    document.body.innerHTML = `<div><input id="downloadPathPattern" type="text"></div>`;
    const input = document.querySelector<HTMLInputElement>("#downloadPathPattern")!;
    tracker.setupAutosave(input);

    input.value = "x";
    input.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(0);

    expect(tracker.fieldStatus("downloadPathPattern")).toBe("failed");
    const failure = document.querySelector('[data-autosave-error="downloadPathPattern"]');
    expect(failure).not.toBeNull();
    expect(failure?.getAttribute("role")).toBe("alert");

    failure!.querySelector("button")!.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(ports.saveOptions).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[data-autosave-error="downloadPathPattern"]')).toBeNull();
    expect(tracker.hasUnsavedField()).toBe(false);
  });

  test("falls back to English copy for the failure banner and its retry button when no catalog message is available", async () => {
    vi.mocked(browser.i18n.getMessage).mockReset().mockReturnValue("");
    const ports = makePorts({ saveOptions: vi.fn().mockRejectedValueOnce(new Error("boom")) });
    const tracker = createPendingChangesTracker(ports);
    document.body.innerHTML = `<div><input id="downloadPathPattern" type="text"></div>`;
    const input = document.querySelector<HTMLInputElement>("#downloadPathPattern")!;
    tracker.setupAutosave(input);

    input.value = "x";
    input.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(0);

    const failure = document.querySelector('[data-autosave-error="downloadPathPattern"]')!;
    expect(failure.textContent).toContain("Could not save this setting.");
    expect(failure.querySelector("button")?.textContent).toBe("Retry save");
  });

  test("keeps the field dirty when an older in-flight save resolves after a newer edit superseded it", async () => {
    const ports = makePorts();
    const tracker = createPendingChangesTracker(ports);
    document.body.innerHTML = `<input id="downloadPathPattern" type="text">`;
    const input = document.querySelector<HTMLInputElement>("#downloadPathPattern")!;
    tracker.setupAutosave(input);

    // Both edits fire before the first save's completion microtask runs, so
    // the first save's own generation token is stale by the time it settles.
    input.value = "first";
    input.dispatchEvent(new Event("input"));
    input.value = "second";
    input.dispatchEvent(new Event("input"));

    await vi.advanceTimersByTimeAsync(0);
    expect(ports.saveOptions).toHaveBeenNthCalledWith(1, undefined, "downloadPathPattern", "first");
    await vi.advanceTimersByTimeAsync(0);
    expect(ports.saveOptions).toHaveBeenNthCalledWith(
      2,
      undefined,
      "downloadPathPattern",
      "second",
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(tracker.hasUnsavedField()).toBe(false);
  });

  test("skips wiring for opt-out, manual, and runtime-control elements", () => {
    const ports = makePorts();
    const tracker = createPendingChangesTracker(ports);
    document.body.innerHTML = `
      <input id="noAutosave" type="text" data-no-autosave>
      <textarea id="paths" data-manual="true"></textarea>
      <input id="runtimeOnly" type="text" data-runtime-control="true">
      <div id="notAField"></div>`;

    tracker.setupAutosave(document.querySelector("#noAutosave")!);
    tracker.setupAutosave(document.querySelector("#paths")!);
    tracker.setupAutosave(document.querySelector("#runtimeOnly")!);
    tracker.setupAutosave(document.querySelector("#notAField")!);

    document.querySelector<HTMLInputElement>("#noAutosave")!.dispatchEvent(new Event("input"));
    document.querySelector<HTMLTextAreaElement>("#paths")!.dispatchEvent(new Event("input"));
    document.querySelector<HTMLInputElement>("#runtimeOnly")!.dispatchEvent(new Event("input"));

    expect(ports.saveOptions).not.toHaveBeenCalled();
  });

  test("wires every eligible control on the page but skips quick-add rule builder fields", () => {
    const ports = makePorts();
    const tracker = createPendingChangesTracker(ports);
    document.body.innerHTML = `
      <select id="uiTheme"><option value="dark">Dark</option></select>
      <div class="rule-builder"><input id="ruleBuilderField" type="text"></div>`;

    tracker.setupAllFieldsAutosave();

    document.querySelector<HTMLSelectElement>("#uiTheme")!.value = "dark";
    document.querySelector<HTMLSelectElement>("#uiTheme")!.dispatchEvent(new Event("change"));
    expect(ports.saveOptions).toHaveBeenCalledWith(undefined, "uiTheme", "dark");

    vi.mocked(ports.saveOptions).mockClear();
    document
      .querySelector<HTMLInputElement>("#ruleBuilderField")!
      .dispatchEvent(new Event("input"));
    expect(ports.saveOptions).not.toHaveBeenCalled();
  });

  // An option is addressed by its schema name, which is its element id. The
  // clause-preview filter is a UI widget with neither, and a save scoped to ""
  // is the one collectOptionConfig reads as "no scope at all".
  test("skips a page widget that carries no option id", () => {
    const ports = makePorts();
    const tracker = createPendingChangesTracker(ports);
    document.body.innerHTML = `
      <input type="search" class="clause-preview-filter" name="routing-clause-filter">`;

    tracker.setupAllFieldsAutosave();
    const filter = document.querySelector<HTMLInputElement>(".clause-preview-filter")!;
    filter.value = "pagedomain";
    filter.dispatchEvent(new Event("change"));

    expect(ports.saveOptions).not.toHaveBeenCalled();
    expect(tracker.hasUnsavedField()).toBe(false);
  });
});

describe("beforeunload guard", () => {
  test("blocks navigation while a field is unsaved or the manual editor has a draft", () => {
    const manualEditorState = makeManualEditorState();
    const ports = makePorts({ manualEditorState });
    const tracker = createPendingChangesTracker(ports);
    tracker.setupBeforeUnloadGuard();

    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    tracker.markFieldDirty("downloadPathPattern");
    const dirtyField = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirtyField);
    expect(dirtyField.defaultPrevented).toBe(true);
  });

  test("also blocks navigation for a dirty manual editor with no autosave-tracked field", () => {
    const manualEditorState = makeManualEditorState({ anyDirty: vi.fn(() => true) });
    const ports = makePorts({ manualEditorState });
    const tracker = createPendingChangesTracker(ports);
    tracker.setupBeforeUnloadGuard();

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe("confirmPendingChanges", () => {
  test("returns true immediately when nothing is dirty or saving", async () => {
    const ports = makePorts();
    const tracker = createPendingChangesTracker(ports);

    await expect(tracker.confirmPendingChanges()).resolves.toBe(true);
    expect(showUnsavedChangesDialog).not.toHaveBeenCalled();
    expect(ports.restoreOptions).not.toHaveBeenCalled();
  });

  test("keeps the tab visible without prompting while the manual editor already owns a save request", async () => {
    const manualEditorState = makeManualEditorState({ anySaving: vi.fn(() => true) });
    const ports = makePorts({ manualEditorState });
    const tracker = createPendingChangesTracker(ports);

    await expect(tracker.confirmPendingChanges()).resolves.toBe(false);
    expect(showUnsavedChangesDialog).not.toHaveBeenCalled();
  });

  test("keeps the tab visible without prompting while a field autosave is in flight", async () => {
    let resolveSave: (() => void) | undefined;
    const ports = makePorts({
      saveOptions: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveSave = resolve;
          }),
      ),
    });
    const tracker = createPendingChangesTracker(ports);
    document.body.innerHTML = `<input id="downloadPathPattern" type="text">`;
    const input = document.querySelector<HTMLInputElement>("#downloadPathPattern")!;
    tracker.setupAutosave(input);
    input.value = "x";
    input.dispatchEvent(new Event("input"));

    await expect(tracker.confirmPendingChanges()).resolves.toBe(false);
    expect(showUnsavedChangesDialog).not.toHaveBeenCalled();

    resolveSave?.();
    await vi.advanceTimersByTimeAsync(200);
  });

  test("falls back to English copy for the unsaved-changes prompt when no catalog message is available", async () => {
    vi.mocked(browser.i18n.getMessage).mockReset().mockReturnValue("");
    vi.mocked(showUnsavedChangesDialog).mockResolvedValueOnce("keep");
    const ports = makePorts();
    const tracker = createPendingChangesTracker(ports);
    tracker.markFieldDirty("downloadPathPattern");

    await tracker.confirmPendingChanges();

    expect(showUnsavedChangesDialog).toHaveBeenCalledWith(
      "Discard your unsaved changes, or keep editing?",
    );
  });

  test("keeps editing and preserves the dirty field when the user chooses Keep editing", async () => {
    vi.mocked(showUnsavedChangesDialog).mockResolvedValueOnce("keep");
    const ports = makePorts();
    const tracker = createPendingChangesTracker(ports);
    tracker.markFieldDirty("downloadPathPattern");

    await expect(tracker.confirmPendingChanges()).resolves.toBe(false);

    expect(showUnsavedChangesDialog).toHaveBeenCalledOnce();
    expect(ports.restoreOptions).not.toHaveBeenCalled();
    expect(tracker.hasUnsavedField()).toBe(true);
  });

  test("discards a pending debounced save, dirty field state, and dirty manual editors on Discard", async () => {
    vi.mocked(showUnsavedChangesDialog).mockResolvedValueOnce("discard");
    const manualEditorState = makeManualEditorState({
      anyDirty: vi.fn(() => true),
      dirtyIds: vi.fn(() => ["paths"]),
    });
    const ports = makePorts({ manualEditorState });
    const tracker = createPendingChangesTracker(ports);
    document.body.innerHTML = `<textarea id="filenamePatterns"></textarea>`;
    const textarea = document.querySelector<HTMLTextAreaElement>("#filenamePatterns")!;
    tracker.setupAutosave(textarea);

    // Debounced edit still pending when the user asks to switch tabs.
    textarea.value = "draft";
    textarea.dispatchEvent(new Event("input"));
    expect(tracker.hasUnsavedField()).toBe(true);

    await expect(tracker.confirmPendingChanges()).resolves.toBe(true);

    expect(manualEditorState.discard).toHaveBeenCalledWith("paths");
    expect(ports.restoreOptions).toHaveBeenCalledOnce();
    expect(tracker.hasUnsavedField()).toBe(false);

    // The canceled debounce timer must not still fire and resurrect the edit.
    await vi.advanceTimersByTimeAsync(1000);
    expect(ports.saveOptions).not.toHaveBeenCalled();
  });
});

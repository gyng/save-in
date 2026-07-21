// @vitest-environment jsdom
import {
  assertSettingsUndoSafe,
  markSavedNow,
  savedIndicatorTarget,
} from "../../../src/options/core/saved-indicator.ts";

beforeEach(() => {
  vi.mocked(browser.i18n.getMessage).mockReset().mockReturnValue("");
  document.body.innerHTML = "";
});

afterEach(() => vi.restoreAllMocks());

test("updates the top status with the save time", () => {
  document.body.innerHTML = '<span id="lastSavedAt">never</span>';
  markSavedNow();
  const indicator = document.querySelector("#lastSavedAt")!;
  expect(indicator.textContent).not.toBe("never");
});

test("resolves explicit, generated, and fallback saved-check anchors", () => {
  document.body.innerHTML = `
    <label data-saved-target for="external">External</label><input id="external">
    <label><input id="nested"><span data-saved-target>Nested</span></label>
    <label><input id="generated"><span class="opt-title">Generated</span></label>
    <label id="label-fallback"><input id="label-control"></label>
    <div id="parent-fallback"><select id="unlabelled"></select></div>
    <textarea id="textarea"></textarea>`;

  expect(savedIndicatorTarget(document.querySelector<HTMLInputElement>("#external")!)).toBe(
    document.querySelector('[for="external"]'),
  );
  expect(savedIndicatorTarget(document.querySelector<HTMLInputElement>("#nested")!)).toBe(
    document.querySelector("#nested + [data-saved-target]"),
  );
  expect(savedIndicatorTarget(document.querySelector<HTMLInputElement>("#generated")!)).toBe(
    document.querySelector("#generated + .opt-title"),
  );
  expect(savedIndicatorTarget(document.querySelector<HTMLInputElement>("#label-control")!)).toBe(
    document.querySelector("#label-fallback"),
  );
  expect(savedIndicatorTarget(document.querySelector<HTMLSelectElement>("#unlabelled")!)).toBe(
    document.querySelector("#parent-fallback"),
  );
  expect(savedIndicatorTarget(document.querySelector<HTMLTextAreaElement>("#textarea")!)).toBe(
    document.querySelector("#textarea"),
  );
  expect(savedIndicatorTarget(document.createElement("input"))).toBeNull();
});

test("shows the saved delta and offers undo", async () => {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(
    (callback) => (frames.push(callback), frames.length),
  );
  vi.mocked(browser.i18n.getMessage).mockImplementation((key) =>
    key === "savedSettingUpdated" ? "Einstellung aktualisiert" : "",
  );
  const undo = vi.fn();
  document.body.innerHTML = `
    <label for="notifyOnSuccess"><span class="opt-title">Erfolgreiche Downloads</span></label>
    <input id="notifyOnSuccess">
    <div class="save-status"><span>Updated</span><span id="lastSavedAt">never</span></div>`;
  markSavedNow([{ name: "notifyOnSuccess", before: true, after: false }], undo);
  frames.shift()?.(0);
  expect(document.querySelector<HTMLElement>(".saved-change-popover")?.style.position).toBe(
    "fixed",
  );
  expect(document.querySelector(".saved-change-popover")?.textContent).toContain(
    "Erfolgreiche DownloadsOn → Off",
  );
  expect(document.querySelector(".saved-change-popover strong")?.textContent).toBe(
    "Einstellung aktualisiert",
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

test("summarizes multiple value shapes and uses a retryable fallback for unknown failures", async () => {
  vi.mocked(browser.i18n.getMessage).mockImplementation((key, substitutions) => {
    const count = Array.isArray(substitutions) ? substitutions[0] : substitutions;
    const messages: Record<string, string> = {
      savedSettingsUpdated: `${count} Einstellungen aktualisiert`,
      html_none: "Keine",
      savedUndo: "Rückgängig",
      savedUndoFailed: "Rückgängig fehlgeschlagen — erneut versuchen",
    };
    return messages[key] || "";
  });
  document.body.innerHTML = `
    <div class="save-status"><span id="lastSavedAt">never</span></div>`;
  markSavedNow(
    [
      { name: "emptyValue", before: null, after: "" },
      { name: "structuredValue", before: { enabled: true }, after: "x".repeat(60) },
    ],
    () => {
      throw "denied";
    },
  );

  const popover = document.querySelector<HTMLElement>(".saved-change-popover")!;
  expect(popover.textContent).toContain("2 Einstellungen aktualisiert");
  expect(popover.textContent).toContain("Keine → Keine");
  expect(popover.textContent).toContain('{"enabled":true}');
  expect(popover.textContent).toContain("…");
  const undo = document.querySelector<HTMLButtonElement>(".saved-change-undo")!;
  undo.click();
  await vi.waitFor(() => expect(undo.disabled).toBe(false));
  expect(undo.textContent).toBe("Rückgängig fehlgeschlagen — erneut versuchen");
});

test("uses English value and undo-error fallbacks", async () => {
  document.body.innerHTML = `
    <div class="save-status"><span id="lastSavedAt">never</span></div>`;
  markSavedNow(
    [
      { name: "emptyValue", before: null, after: "" },
      { name: "enabledValue", before: true, after: false },
    ],
    () => {
      throw new Error("");
    },
  );

  expect(document.querySelector(".saved-change-popover strong")?.textContent).toBe(
    "2 settings updated",
  );
  expect(document.querySelector(".saved-change-popover")?.textContent).toContain("None → None");
  const undo = document.querySelector<HTMLButtonElement>(".saved-change-undo")!;
  undo.click();
  await vi.waitFor(() => expect(undo.disabled).toBe(false));
  expect(undo.textContent).toBe("Undo failed — select to retry");
});

test("does nothing when the page has no saved-time indicator", () => {
  document.body.innerHTML = '<div class="save-status"></div>';
  markSavedNow([{ name: "prompt", before: false, after: true }]);
  expect(document.querySelector(".saved-change-popover")).toBeNull();
});

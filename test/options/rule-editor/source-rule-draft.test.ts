// @vitest-environment jsdom
import { SOURCE_RULE_DRAFT_SESSION_KEY } from "../../../src/shared/storage-keys.ts";

vi.mock(import("../../../src/options/rule-editor/rule-builder.ts"), { spy: true });

const storageWithOptionalSession = browser.storage as typeof browser.storage & {
  session?: typeof browser.storage.session;
};
const originalSession = storageWithOptionalSession.session;

const setSessionArea = (value: typeof browser.storage.session | undefined) => {
  Object.defineProperty(storageWithOptionalSession, "session", {
    configurable: true,
    writable: true,
    value,
  });
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  setSessionArea(originalSession);
  document.body.innerHTML = "";
});

afterAll(() => setSessionArea(originalSession));

test("applies a session draft and opens the visual routing editor", async () => {
  vi.mocked(browser.storage.session.get).mockResolvedValue({
    [SOURCE_RULE_DRAFT_SESSION_KEY]: { rule: "context: ^auto$\ninto: Images/" },
  });
  document.body.innerHTML = `
    <button id="tab-section-dynamic-downloads"></button>
    <textarea id="filenamePatterns">existing: rule</textarea>
    <button id="rules-mode-visual"></button>`;
  const tab = document.querySelector<HTMLButtonElement>("#tab-section-dynamic-downloads")!;
  const visual = document.querySelector<HTMLButtonElement>("#rules-mode-visual")!;
  const tabClick = vi.spyOn(tab, "click");
  const visualClick = vi.spyOn(visual, "click");
  const navigation = vi.fn();
  document.addEventListener("save-in:navigate-option", navigation);
  const { applySourceRuleDraft } =
    await import("../../../src/options/rule-editor/source-rule-draft.ts");

  await expect(applySourceRuleDraft()).resolves.toBe(true);

  expect(browser.storage.session.remove).toHaveBeenCalledWith(SOURCE_RULE_DRAFT_SESSION_KEY);
  expect(document.querySelector<HTMLTextAreaElement>("#filenamePatterns")?.value).toContain(
    "context: ^auto$",
  );
  expect(tabClick).toHaveBeenCalledOnce();
  expect(visualClick).toHaveBeenCalledOnce();
  expect(navigation).toHaveBeenCalledOnce();
});

test("falls back to local storage when session storage rejects", async () => {
  vi.mocked(browser.storage.session.get).mockRejectedValue(new Error("unsupported"));
  vi.mocked(browser.storage.local.get).mockResolvedValue({
    [SOURCE_RULE_DRAFT_SESSION_KEY]: { rule: "context: ^auto$" },
  });
  document.body.innerHTML = '<textarea id="filenamePatterns"></textarea>';
  const { applySourceRuleDraft } =
    await import("../../../src/options/rule-editor/source-rule-draft.ts");

  await expect(applySourceRuleDraft()).resolves.toBe(true);

  expect(browser.storage.local.remove).toHaveBeenCalledWith(SOURCE_RULE_DRAFT_SESSION_KEY);
});

test("uses local storage directly when session storage is unavailable", async () => {
  setSessionArea(undefined);
  vi.mocked(browser.storage.local.get).mockResolvedValue({
    [SOURCE_RULE_DRAFT_SESSION_KEY]: { rule: "context: ^auto$" },
  });
  document.body.innerHTML = '<textarea id="filenamePatterns"></textarea>';
  const { applySourceRuleDraft } =
    await import("../../../src/options/rule-editor/source-rule-draft.ts");

  await expect(applySourceRuleDraft()).resolves.toBe(true);
  expect(browser.storage.local.get).toHaveBeenCalledOnce();
});

test("rejects malformed, non-string, and blank stored drafts", async () => {
  vi.mocked(browser.storage.session.get).mockResolvedValue({
    [SOURCE_RULE_DRAFT_SESSION_KEY]: null,
  });
  vi.mocked(browser.storage.local.get).mockResolvedValue({
    [SOURCE_RULE_DRAFT_SESSION_KEY]: { rule: 7 },
  });
  let module = await import("../../../src/options/rule-editor/source-rule-draft.ts");
  await expect(module.applySourceRuleDraft()).resolves.toBe(false);

  vi.resetModules();
  vi.mocked(browser.storage.session.get).mockResolvedValue({
    [SOURCE_RULE_DRAFT_SESSION_KEY]: { rule: "   " },
  });
  vi.mocked(browser.storage.local.get).mockResolvedValue({});
  module = await import("../../../src/options/rule-editor/source-rule-draft.ts");
  await expect(module.applySourceRuleDraft()).resolves.toBe(false);
});

test("consumes a valid draft even when its editor is missing", async () => {
  vi.mocked(browser.storage.session.get).mockResolvedValue({
    [SOURCE_RULE_DRAFT_SESSION_KEY]: { rule: "context: ^auto$" },
  });
  const { applySourceRuleDraft } =
    await import("../../../src/options/rule-editor/source-rule-draft.ts");

  await expect(applySourceRuleDraft()).resolves.toBe(false);
  expect(browser.storage.session.remove).toHaveBeenCalledOnce();
});

test("recovers the serialized apply queue after an editor failure", async () => {
  vi.mocked(browser.storage.session.get).mockResolvedValue({
    [SOURCE_RULE_DRAFT_SESSION_KEY]: { rule: "context: ^auto$" },
  });
  document.body.innerHTML = '<textarea id="filenamePatterns"></textarea>';
  const { appendRule } = await import("../../../src/options/rule-editor/rule-builder.ts");
  vi.mocked(appendRule).mockImplementationOnce(() => {
    throw new Error("editor unavailable");
  });
  const { applySourceRuleDraft } =
    await import("../../../src/options/rule-editor/source-rule-draft.ts");

  await expect(applySourceRuleDraft()).rejects.toThrow("editor unavailable");
  await expect(applySourceRuleDraft()).resolves.toBe(true);

  expect(browser.storage.session.get).toHaveBeenCalledTimes(2);
  expect(document.querySelector<HTMLTextAreaElement>("#filenamePatterns")?.value).toContain(
    "context: ^auto$",
  );
});

test("installs one change listener and reacts only to the draft key", async () => {
  vi.mocked(browser.storage.session.get).mockResolvedValue({});
  vi.mocked(browser.storage.local.get).mockResolvedValue({});
  const { setupSourceRuleDraft } =
    await import("../../../src/options/rule-editor/source-rule-draft.ts");

  setupSourceRuleDraft();
  setupSourceRuleDraft();

  expect(browser.storage.onChanged.addListener).toHaveBeenCalledOnce();
  const listener = vi.mocked(browser.storage.onChanged.addListener).mock.calls[0]?.[0];
  expect(listener).toBeTypeOf("function");
  listener?.({}, "session");
  expect(browser.storage.session.get).not.toHaveBeenCalled();
  listener?.({ [SOURCE_RULE_DRAFT_SESSION_KEY]: {} }, "session");
  await vi.waitFor(() => expect(browser.storage.session.get).toHaveBeenCalledOnce());
});

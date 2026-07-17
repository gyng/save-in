// @vitest-environment jsdom
import { SOURCE_RULE_DRAFT_SESSION_KEY } from "../../../src/shared/storage-keys.ts";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  document.body.innerHTML = '<textarea id="filenamePatterns"></textarea>';
});

test("consumes a draft once when startup and storage notifications overlap", async () => {
  let stored: unknown = { rule: "context: ^auto$\ninto: Images/" };
  vi.mocked(browser.storage.session.get).mockImplementation(async () => ({
    [SOURCE_RULE_DRAFT_SESSION_KEY]: stored,
  }));
  vi.mocked(browser.storage.session.remove).mockImplementation(async () => {
    stored = undefined;
  });
  const { applySourceRuleDraft } =
    await import("../../../src/options/rule-editor/source-rule-draft.ts");

  const results = await Promise.all([applySourceRuleDraft(), applySourceRuleDraft()]);

  expect(results.toSorted()).toEqual([false, true]);
  expect(document.querySelector<HTMLTextAreaElement>("#filenamePatterns")?.value).toBe(
    "context: ^auto$\ninto: Images/\n",
  );
});

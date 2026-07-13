// @vitest-environment jsdom
import { setupAutoDownloadRuleEditor } from "../src/options/auto-download-rule-editor.ts";

const documentFixture = () => {
  document.body.innerHTML = `
    <button id="auto-rules-mode-visual"></button>
    <button id="auto-rules-mode-text"></button>
    <div id="auto-rules-visual"><div id="auto-rule-cards"></div><button id="auto-rule-add"></button></div>
    <div id="auto-rules-text"><textarea id="autoDownloadRules"></textarea></div>
  `;
  localStorage.clear();
};

describe("automatic rule visual editor", () => {
  beforeEach(documentFixture);

  test("renders stored rules and writes visual field edits back to the grammar", () => {
    const textarea = document.querySelector<HTMLTextAreaElement>("#autoDownloadRules")!;
    textarea.value = "name: Images\npageurl: example\\.test\nsourcekind: image\ninto: automatic/";
    const input = vi.fn();
    textarea.addEventListener("input", input);

    setupAutoDownloadRuleEditor();
    document.dispatchEvent(new Event("options-restored"));

    expect(document.querySelectorAll(".auto-rule-card")).toHaveLength(1);
    const destination = document.querySelector<HTMLInputElement>(".auto-rule-destination input")!;
    destination.value = "changed/:pagedomain:/";
    destination.dispatchEvent(new InputEvent("input", { bubbles: true }));

    expect(textarea.value).toContain("into: changed/:pagedomain:/");
    expect(input).toHaveBeenCalled();
  });

  test("adds a disabled, site-scoped starter rule", () => {
    setupAutoDownloadRuleEditor();
    document.querySelector<HTMLButtonElement>("#auto-rule-add")!.click();
    const source = document.querySelector<HTMLTextAreaElement>("#autoDownloadRules")!.value;

    expect(source).toContain("disabled: true");
    expect(source).toContain("pageurl: ^https://example\\.com/");
    expect(source).toContain("sourcekind: image");
    expect(source).toContain("into: automatic/:pagedomain:/");
  });

  test("keeps invalid text editable without destructively normalizing it", () => {
    const textarea = document.querySelector<HTMLTextAreaElement>("#autoDownloadRules")!;
    textarea.value = "pageurl: [\nsourcekind: image\ninto: files/";
    setupAutoDownloadRuleEditor();
    document.dispatchEvent(new Event("options-restored"));

    expect(document.querySelector(".auto-rule-visual-warning")).not.toBeNull();
    expect(textarea.value).toBe("pageurl: [\nsourcekind: image\ninto: files/");
  });
});

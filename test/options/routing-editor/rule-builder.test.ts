// @vitest-environment jsdom
// Guided rule input + template library on the options page.

import { RuleBuilder, setupRuleBuilder } from "../../../src/options/rule-builder.ts";
import { RULE_TEMPLATES } from "../../../src/options/rule-templates.ts";

describe("RuleBuilder.appendRule", () => {
  test("appends with a blank-line rule separator and fires input", () => {
    const textarea = document.createElement("textarea");
    const events: string[] = [];
    textarea.addEventListener("input", () => events.push("input"));

    RuleBuilder.appendRule(textarea, "fileext: pdf\ninto: documents/:filename:");
    RuleBuilder.appendRule(textarea, "mediatype: image\ninto: images/:filename:");

    expect(textarea.value).toBe(
      "fileext: pdf\ninto: documents/:filename:\n\nmediatype: image\ninto: images/:filename:\n",
    );
    expect(events).toEqual(["input", "input"]);
  });
});

describe("guided input", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <textarea id="filenamePatterns"></textarea>
      <select id="rule-builder-matcher"></select>
      <input type="text" id="rule-builder-pattern" />
      <span class="rule-builder-into-label">into:</span>
      <input type="text" id="rule-builder-into" />
      <button type="button" id="rule-builder-add" disabled>Add</button>
    `;
    // Not spied on — only the resolved value is used, so a plain function
    // suffices
    global.browser.runtime.sendMessage = () =>
      Promise.resolve({ body: { matchers: ["fileext", "pagedomain"] } });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("populates matchers, enables Add when filled, appends the rule", async () => {
    RuleBuilder.setupGuidedInput();
    await vi.waitFor(() =>
      expect(document.querySelectorAll("#rule-builder-matcher option")).toHaveLength(2),
    );

    const matcher = document.querySelector("#rule-builder-matcher") as HTMLSelectElement;
    const pattern = document.querySelector("#rule-builder-pattern") as HTMLInputElement;
    const into = document.querySelector("#rule-builder-into") as HTMLInputElement;
    const add = document.querySelector("#rule-builder-add") as HTMLButtonElement;
    const textarea = document.querySelector("#filenamePatterns") as HTMLTextAreaElement;

    expect([...matcher.options].map((o) => o.value)).toEqual(["pagedomain", "fileext"]);
    expect(pattern.placeholder).toBe("jpg|png");
    matcher.value = "pagedomain";
    matcher.dispatchEvent(new Event("change"));
    expect(pattern.placeholder).toBe("(^|\\.)example\\.com$");
    matcher.value = "fileext";

    // Disabled until every field is filled
    expect(add.disabled).toBe(true);
    pattern.value = "pdf";
    pattern.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(add.disabled).toBe(true);
    into.value = "documents/:filename:";
    into.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(add.disabled).toBe(false);

    add.click();
    expect(textarea.value).toBe("fileext: pdf\ninto: documents/:filename:\n");
    // Pattern clears for the next rule; Add disables again
    expect(pattern.value).toBe("");
    expect(add.disabled).toBe(true);
  });

  test("defaults new extension rules to URL-path matching", async () => {
    global.browser.runtime.sendMessage = () =>
      Promise.resolve({ body: { matchers: ["fileext", "urlfileext", "pagedomain"] } });

    RuleBuilder.setupGuidedInput();

    await vi.waitFor(() =>
      expect(document.querySelectorAll("#rule-builder-matcher option")).toHaveLength(3),
    );
    expect(document.querySelector<HTMLSelectElement>("#rule-builder-matcher")?.value).toBe(
      "urlfileext",
    );
  });

  test("tolerates missing controls and unavailable or legacy keyword responses", async () => {
    document.body.innerHTML = "";
    expect(RuleBuilder.setupGuidedInput()).toBeUndefined();

    document.body.innerHTML = `
      <textarea id="filenamePatterns"></textarea>
      <select id="rule-builder-matcher"></select>
      <input id="rule-builder-pattern">
      <input id="rule-builder-into">
      <button id="rule-builder-add"></button>`;
    global.browser.runtime.sendMessage = vi.fn().mockRejectedValueOnce(new Error("worker asleep"));
    RuleBuilder.setupGuidedInput();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector("#rule-builder-matcher option")).toBeNull();

    document.body.innerHTML = `
      <textarea id="filenamePatterns"></textarea>
      <select id="rule-builder-matcher"><option value="other">other</option></select>
      <input id="rule-builder-pattern">
      <input id="rule-builder-into">
      <button id="rule-builder-add"></button>`;
    global.browser.runtime.sendMessage = vi.fn().mockResolvedValue({ body: {} });
    RuleBuilder.setupGuidedInput();
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLInputElement>("#rule-builder-pattern")?.placeholder).toBe(
        ".*",
      ),
    );
  });

  test("ignores guided controls attached to the wrong element types", () => {
    document.body.innerHTML = `
      <div id="filenamePatterns"></div>
      <div id="rule-builder-matcher"></div>
      <div id="rule-builder-pattern"></div>
      <div id="rule-builder-into"></div>
      <div id="rule-builder-add"></div>`;
    const sendMessage = vi.fn();
    global.browser.runtime.sendMessage = sendMessage;

    expect(RuleBuilder.setupGuidedInput()).toBeUndefined();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe("template list rendering", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <textarea id="filenamePatterns"></textarea>
      <input type="search" class="rule-template-filter">
      <div class="template-feedback" hidden></div>
      <div id="rule-templates"></div>
    `;
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  test("renders one row per template and marks added ones", () => {
    RuleBuilder.renderTemplates();

    const rows = document.querySelectorAll(".rule-template");
    expect(rows).toHaveLength(RULE_TEMPLATES.length);
    expect(
      [...document.querySelectorAll(".rule-template-rule")].map((node) => node.textContent),
    ).toEqual(RULE_TEMPLATES.map(({ rule }) => rule));
    expect(document.querySelector(".rule-template-rule .syntax-token-matcher")).not.toBeNull();

    const firstAdd = rows[0]?.querySelector<HTMLButtonElement>("button");
    if (!firstAdd) {
      throw new Error("First template has no Add button");
    }
    firstAdd.click();

    const textarea = document.querySelector("#filenamePatterns") as HTMLTextAreaElement;
    expect(textarea.value).toContain(RULE_TEMPLATES[0]!.rule);
    expect(firstAdd.disabled).toBe(true);
    expect(document.querySelector<HTMLElement>(".template-feedback")?.hidden).toBe(false);
  });

  test("re-checks Added states after options restore fills the textarea", () => {
    RuleBuilder.renderTemplates();
    const textarea = document.querySelector("#filenamePatterns") as HTMLTextAreaElement;

    // Programmatic fill, as restoreOptions does (no input event)
    textarea.value = RULE_TEMPLATES[1]!.rule;
    document.dispatchEvent(new Event("options-restored"));

    const adds = document.querySelectorAll<HTMLButtonElement>(".rule-template button");
    expect(adds[1]!.disabled).toBe(true);
    expect(adds[0]!.disabled).toBe(false);
  });

  test("filters templates, with Enter adding the first match", () => {
    RuleBuilder.renderTemplates();

    const filter = document.querySelector<HTMLInputElement>(".rule-template-filter")!;
    filter.value = "hostname serving";
    filter.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(document.querySelectorAll(".rule-template:not([hidden])")).toHaveLength(1);
    filter.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(document.querySelector<HTMLTextAreaElement>("#filenamePatterns")!.value).toContain(
      "sites/:sourcedomain:",
    );
    expect(filter.value).toBe("");
    expect(document.querySelectorAll(".rule-template:not([hidden])")).toHaveLength(
      RULE_TEMPLATES.length,
    );
  });

  test("Add consumes the card click instead of bubbling into surrounding search UI", () => {
    const library = document.querySelector("#rule-templates")!;
    const bubbled = vi.fn();
    library.addEventListener("click", bubbled);
    RuleBuilder.renderTemplates();

    document.querySelector<HTMLButtonElement>(".rule-template-add")!.click();

    expect(bubbled).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLTextAreaElement>("#filenamePatterns")!.value).toContain(
      RULE_TEMPLATES[0]!.rule,
    );
  });

  test("renders and synchronizes inline and dialog libraries", () => {
    document.body.innerHTML = `
      <textarea id="filenamePatterns"></textarea>
      <div class="rule-template-surface">
        <input class="rule-template-filter" list="routing-template-options">
        <button class="rule-template-typeahead-add" disabled>Add</button>
        <div class="template-feedback" hidden></div>
        <datalist id="routing-template-options" data-rule-template-library></datalist>
      </div>
      <dialog id="reference-dialog">
        <input class="reference-dialog-filter rule-template-filter">
        <div class="template-feedback" hidden></div>
        <div id="rule-templates" data-rule-template-library></div>
      </dialog>`;
    RuleBuilder.renderTemplates();
    expect(document.querySelectorAll(".rule-template")).toHaveLength(RULE_TEMPLATES.length);
    expect(document.querySelectorAll("#routing-template-options option")).toHaveLength(
      RULE_TEMPLATES.length,
    );

    const picker = document.querySelector<HTMLInputElement>(".rule-template-surface input")!;
    const add = document.querySelector<HTMLButtonElement>(".rule-template-typeahead-add")!;
    picker.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    picker.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    picker.value = RULE_TEMPLATES[0]!.name;
    picker.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(add.disabled).toBe(false);
    picker.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(document.querySelector<HTMLTextAreaElement>("#filenamePatterns")?.value).toContain(
      `// ${RULE_TEMPLATES[0]!.name}\n${RULE_TEMPLATES[0]!.rule}`,
    );
    expect(picker.value).toBe("");
    expect(add.disabled).toBe(true);
    add.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector<HTMLButtonElement>(".rule-template-add")?.disabled).toBe(true);
    expect(
      document.querySelector<HTMLElement>(".rule-template-surface .template-feedback")?.hidden,
    ).toBe(false);
  });

  test("does nothing without both a library and the rules textarea", () => {
    document.body.innerHTML = '<div id="rule-templates"></div>';
    expect(RuleBuilder.renderTemplates()).toBeUndefined();
    document.body.innerHTML = '<textarea id="filenamePatterns"></textarea>';
    expect(RuleBuilder.renderTemplates()).toBeUndefined();
  });

  test("ignores a template library paired with a non-textarea rules element", () => {
    document.body.innerHTML = '<div id="filenamePatterns"></div><div id="rule-templates"></div>';

    expect(RuleBuilder.renderTemplates()).toBeUndefined();
    expect(document.querySelector(".rule-template")).toBeNull();
  });

  test("the feedback action closes the reference and navigates to the rules editor", () => {
    document.body.innerHTML = `
      <button type="button" id="rules-mode-text">Text</button>
      <div id="rules-text-editor" hidden></div>
      <textarea id="filenamePatterns"></textarea>
      <dialog id="reference-dialog">
        <input class="reference-dialog-filter rule-template-filter">
        <div class="template-feedback" hidden></div>
        <div id="rule-templates"></div>
      </dialog>`;
    document.querySelector("#rules-mode-text")!.addEventListener("click", () => {
      document.querySelector<HTMLElement>("#rules-text-editor")!.hidden = false;
    });
    const dialog = document.querySelector<HTMLDialogElement>("dialog")!;
    dialog.close = vi.fn();
    const navigate = vi.fn();
    document.addEventListener("save-in:navigate-option", navigate, { once: true });
    RuleBuilder.renderTemplates();
    document.querySelector<HTMLButtonElement>(".rule-template-add")!.click();
    document.querySelector<HTMLButtonElement>(".template-feedback button")!.click();

    expect(dialog.close).toHaveBeenCalledOnce();
    expect(document.querySelector<HTMLElement>("#rules-text-editor")!.hidden).toBe(false);
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { target: document.querySelector("#filenamePatterns") } }),
    );
    document.querySelector("#filenamePatterns")?.remove();
    expect(() =>
      document.querySelector<HTMLButtonElement>(".template-feedback button")!.click(),
    ).not.toThrow();
  });

  test("contains empty filter results and works without feedback or a filter surface", () => {
    document.body.innerHTML = `
      <textarea id="filenamePatterns"></textarea>
      <div class="rule-template-surface">
        <input class="rule-template-filter">
        <div data-rule-template-library></div>
      </div>
      <datalist data-rule-template-library></datalist>
      <div data-rule-template-library></div>`;
    RuleBuilder.renderTemplates();
    const filter = document.querySelector<HTMLInputElement>(".rule-template-filter")!;
    filter.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    filter.value = "no template can match this";
    filter.dispatchEvent(new InputEvent("input", { bubbles: true }));
    filter.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(document.querySelector<HTMLTextAreaElement>("#filenamePatterns")!.value).toBe("");

    document.querySelector<HTMLButtonElement>(".rule-template-add")!.click();
    expect(document.querySelector<HTMLTextAreaElement>("#filenamePatterns")!.value).not.toBe("");
  });

  test("setup composes both rule-builder surfaces", () => {
    document.body.innerHTML = "";
    expect(setupRuleBuilder()).toBeUndefined();
  });
});

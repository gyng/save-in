// Guided rule input + template library on the options page. Every built-in
// template must parse cleanly through the real routing parser and only reference
// variables that actually exist.

import * as constants from "../src/shared/constants.ts";
import { matchRules, parseRulesCollecting } from "../src/routing/router.ts";
import { Path } from "../src/routing/path.ts";
import { applyVariables } from "../src/routing/variable.ts";
import { RuleBuilder } from "../src/options/rule-builder.ts";
import { RULE_TEMPLATES } from "../src/options/rule-templates.ts";

describe("RULE_TEMPLATES", () => {
  test("covers a useful range of organization strategies", () => {
    expect(RULE_TEMPLATES.length).toBeGreaterThanOrEqual(13);
    expect(RULE_TEMPLATES.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "Downloads by month",
        "One folder per source site",
        "One folder per file extension",
        "Browser downloads inbox",
        "Screenshots by month",
        "E-books and comics",
        "Apps and installers",
        "One folder per page site",
      ]),
    );
  });

  RULE_TEMPLATES.forEach((tpl) => {
    test(`"${tpl.name}" parses as exactly one valid rule`, () => {
      const { rules, errors } = parseRulesCollecting(tpl.rule);
      expect(errors).toEqual([]);
      expect(rules).toHaveLength(1);
    });

    test(`"${tpl.name}" only references variables that exist`, () => {
      const intoLine = tpl.rule.split("\n").find((l) => l.startsWith("into:"));
      if (!intoLine) {
        throw new Error("Template has no into rule");
      }
      const known = new Set<string>(Object.values(constants.SPECIAL_DIRS));
      const tokens = intoLine.match(/:[a-z$][a-z0-9$]*:/gi) || [];
      tokens.forEach((token) => {
        const isCapture = /^:\$\d+:$/.test(token);
        expect(isCapture || known.has(token)).toBe(true);
      });
    });

    test(`"${tpl.name}" routes to a filename, not a bare directory`, () => {
      const intoLine = tpl.rule.split("\n").find((l) => l.startsWith("into:"));
      // into: replaces the whole path; a template that ends in a directory
      // would save the file AS that directory name
      expect(intoLine).toMatch(/:(filename|\$\d+):$/);
    });

    test(`"${tpl.name}" produces its advertised example`, async () => {
      const { rules, errors } = parseRulesCollecting(tpl.rule);
      const proofInfo = {
        url: "https://cdn.example.com/report.pdf",
        sourceUrl: "https://example.test/report.pdf",
        pageUrl: "https://example.com/an-interesting-page",
        filename: "report.pdf",
        currentTab: { title: "An Interesting Page" },
        now: new Date(2026, 6, 12, 12),
        counter: 42,
        ...tpl.proof.info,
      };
      expect(errors).toEqual([]);

      const destination = matchRules(rules, proofInfo);
      expect(destination).toBe(tpl.proof.destination);
      expect((await applyVariables(new Path(destination), proofInfo)).finalize()).toBe(
        tpl.example.replace(/^Example: /, ""),
      );
    });
  });
});

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

    const firstAdd = rows[0]?.querySelector<HTMLButtonElement>("button");
    if (!firstAdd) {
      throw new Error("First template has no Add button");
    }
    expect(firstAdd.textContent).toBe("Add");

    firstAdd.click();

    const textarea = document.querySelector("#filenamePatterns") as HTMLTextAreaElement;
    expect(textarea.value).toContain(RULE_TEMPLATES[0]!.rule);
    expect(firstAdd.textContent).toBe("Added");
    expect(firstAdd.disabled).toBe(true);
    expect(document.querySelector(".rule-template-rule")?.textContent).toContain("\ninto:");
    expect(document.querySelectorAll(".rule-template-example")).toHaveLength(0);
    expect(document.querySelector<HTMLElement>(".template-feedback")?.hidden).toBe(false);
    expect(document.querySelector(".template-feedback button")?.textContent).toBe(
      "View in rules editor",
    );
  });

  test("re-checks Added states after options restore fills the textarea", () => {
    RuleBuilder.renderTemplates();
    const textarea = document.querySelector("#filenamePatterns") as HTMLTextAreaElement;

    // Programmatic fill, as restoreOptions does (no input event)
    textarea.value = RULE_TEMPLATES[1]!.rule;
    vi.advanceTimersByTime(1500);

    const adds = document.querySelectorAll<HTMLButtonElement>(".rule-template button");
    expect(adds[1]!.disabled).toBe(true);
    expect(adds[0]!.disabled).toBe(false);
  });

  test("groups and filters templates, with Enter adding the first match", () => {
    RuleBuilder.renderTemplates();
    expect(
      [...document.querySelectorAll(".rule-template-category > h3")].map(
        (heading) => heading.textContent,
      ),
    ).toEqual(["Media", "File types", "Date and sequence", "Sites and URLs", "Save context"]);

    const filter = document.querySelector<HTMLInputElement>(".rule-template-filter")!;
    filter.value = "source site";
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
        <input class="rule-template-filter">
        <div class="template-feedback" hidden></div>
        <div data-rule-template-library></div>
      </div>
      <dialog id="reference-dialog">
        <input class="reference-dialog-filter rule-template-filter">
        <div class="template-feedback" hidden></div>
        <div id="rule-templates" data-rule-template-library></div>
      </dialog>`;

    RuleBuilder.renderTemplates();
    expect(document.querySelectorAll(".rule-template")).toHaveLength(RULE_TEMPLATES.length * 2);

    document
      .querySelector<HTMLButtonElement>("[data-rule-template-library] .rule-template-add")!
      .click();
    const firstButtons = [
      ...document.querySelectorAll<HTMLElement>("[data-rule-template-library]"),
    ].map((library) => library.querySelector<HTMLButtonElement>(".rule-template-add")!);
    expect(firstButtons).toHaveLength(2);
    expect(firstButtons.every((button) => button.disabled && button.textContent === "Added")).toBe(
      true,
    );
    expect(
      document.querySelector<HTMLElement>(".rule-template-surface .template-feedback")?.hidden,
    ).toBe(false);
  });
});

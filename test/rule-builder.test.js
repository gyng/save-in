// Guided rule input + template library on the options page. Every built-in
// template must parse cleanly through the real Router and only reference
// variables that actually exist.

const constants = (await import("../src/constants.js")).default;
Object.assign(global, constants);

const Router = (await import("../src/router.js")).default;
const { RULE_TEMPLATES, RuleBuilder } = await import("../src/options/rule-builder.js");

const flush = async (times = 5) => {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
};

describe("RULE_TEMPLATES", () => {
  beforeAll(() => {
    global.window.optionErrors = { paths: [], filenamePatterns: [] };
  });

  beforeEach(() => {
    global.window.optionErrors.filenamePatterns = [];
  });

  RULE_TEMPLATES.forEach((tpl) => {
    test(`"${tpl.name}" parses as exactly one valid rule`, () => {
      const rules = Router.parseRules(tpl.rule);
      expect(global.window.optionErrors.filenamePatterns).toEqual([]);
      expect(rules).toHaveLength(1);
    });

    test(`"${tpl.name}" only references variables that exist`, () => {
      const intoLine = tpl.rule.split("\n").find((l) => l.startsWith("into:"));
      const known = Object.values(constants.SPECIAL_DIRS);
      const tokens = intoLine.match(/:[a-z$][a-z0-9$]*:/gi) || [];
      tokens.forEach((token) => {
        const isCapture = /^:\$\d+:$/.test(token);
        expect(isCapture || known.includes(token)).toBe(true);
      });
    });

    test(`"${tpl.name}" routes to a filename, not a bare directory`, () => {
      const intoLine = tpl.rule.split("\n").find((l) => l.startsWith("into:"));
      // into: replaces the whole path; a template that ends in a directory
      // would save the file AS that directory name
      expect(intoLine).toMatch(/:(filename|\$\d+):$/);
    });
  });
});

describe("RuleBuilder.appendRule", () => {
  test("appends with a blank-line rule separator and fires input", () => {
    const textarea = document.createElement("textarea");
    const events = [];
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
    global.browser.runtime.sendMessage = vi.fn(() =>
      Promise.resolve({ body: { matchers: ["fileext", "pagedomain"] } }),
    );
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("populates matchers, enables Add when filled, appends the rule", async () => {
    RuleBuilder.setupGuidedInput();
    await flush();

    const matcher = document.querySelector("#rule-builder-matcher");
    const pattern = document.querySelector("#rule-builder-pattern");
    const into = document.querySelector("#rule-builder-into");
    const add = document.querySelector("#rule-builder-add");
    const textarea = document.querySelector("#filenamePatterns");

    expect([...matcher.options].map((o) => o.value)).toEqual(["fileext", "pagedomain"]);

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

    const firstAdd = rows[0].querySelector("button");
    expect(firstAdd.textContent).toBe("Add");

    firstAdd.click();

    const textarea = document.querySelector("#filenamePatterns");
    expect(textarea.value).toContain(RULE_TEMPLATES[0].rule);
    expect(firstAdd.textContent).toBe("Added");
    expect(firstAdd.disabled).toBe(true);
  });

  test("re-checks Added states after options restore fills the textarea", () => {
    RuleBuilder.renderTemplates();
    const textarea = document.querySelector("#filenamePatterns");

    // Programmatic fill, as restoreOptions does (no input event)
    textarea.value = RULE_TEMPLATES[1].rule;
    vi.advanceTimersByTime(1500);

    const adds = document.querySelectorAll(".rule-template button");
    expect(adds[1].disabled).toBe(true);
    expect(adds[0].disabled).toBe(false);
  });
});

// @vitest-environment jsdom

import { RuleBuilder } from "../src/options/rule-builder.ts";
import { RULE_TEMPLATES } from "../src/options/rule-templates.ts";
import { Path } from "../src/routing/path.ts";
import { matchRules, parseRulesCollecting, traceRules } from "../src/routing/router.ts";
import { applyVariables } from "../src/routing/variable.ts";

const templateNamed = (name: string) => {
  const template = RULE_TEMPLATES.find((candidate) => candidate.name === name);
  if (!template) throw new Error(`Missing template: ${name}`);
  return template;
};

const rulesFor = (name: string) => {
  const parsed = parseRulesCollecting(templateNamed(name).rule);
  expect(parsed.errors).toEqual([]);
  return parsed.rules;
};

describe("built-in matcher templates", () => {
  const genericTemplates = [
    "Date-stamp every download",
    "Daily inbox",
    "Downloads by month",
    "Weekly inbox",
    "Sequential archive",
    "Page-title prefix",
  ];
  const saveContexts = {
    link: {
      context: "LINK",
      linkUrl: "https://files.example/report.pdf",
      url: "https://files.example/report.pdf",
      filename: "report.pdf",
    },
    page: {
      context: "PAGE",
      pageUrl: "https://page.example/report",
      url: "https://page.example/report",
      filename: "report.html",
    },
    selection: {
      context: "SELECTION",
      url: "data:text/plain,selected",
      filename: "selection.txt",
    },
  } as const;

  test.each(genericTemplates)("%s applies across non-media save contexts", (name) => {
    const rules = rulesFor(name);
    for (const info of Object.values(saveContexts)) {
      expect(
        matchRules(rules, {
          ...info,
          currentTab: { title: "An Interesting Page" },
          now: new Date(2026, 6, 12, 12),
          counter: 42,
        }),
      ).not.toBeNull();
    }
  });

  test.each(RULE_TEMPLATES.filter((template) => template.category === "File types"))(
    "$name handles an extension before a query string",
    (template) => {
      const sourceUrl = template.proof.info.sourceUrl;
      expect(sourceUrl).toBeTypeOf("string");
      const rules = parseRulesCollecting(template.rule).rules;

      expect(
        matchRules(rules, {
          url: `${sourceUrl}?token=abc`,
          sourceUrl: `${sourceUrl}?token=abc`,
          filename: template.proof.info.filename || "report.pdf",
        }),
      ).toBe(template.proof.destination);
    },
  );

  test("the single-site template matches only the chosen host and its subdomains", () => {
    const rules = rulesFor("One site, one folder");
    const matches = (hostname: string) =>
      matchRules(rules, {
        pageUrl: `https://${hostname}/report`,
        filename: "report.pdf",
        currentTab: { title: "Report" },
      });

    expect(matches("example.com")).not.toBeNull();
    expect(matches("www.example.com")).not.toBeNull();
    expect(matches("notexample.com")).toBeNull();
    expect(matches("example.com.evil.test")).toBeNull();
  });
});

describe("matcher authoring and validation", () => {
  test("guided input defaults new extension rules to URL-path matching", async () => {
    document.body.innerHTML = `
      <textarea id="filenamePatterns"></textarea>
      <select id="rule-builder-matcher"></select>
      <input id="rule-builder-pattern">
      <input id="rule-builder-into">
      <button id="rule-builder-add"></button>
    `;
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

  test("trace expansion preserves production source URL semantics", async () => {
    const info = { pageUrl: "https://page.example/report", filename: "report.html" };
    const rules = parseRulesCollecting("pageurl: .*\ninto: :sourceurl:").rules;
    const trace = await traceRules(rules, info);
    const runtimePath = await applyVariables(new Path(":sourceurl:"), info);

    expect(trace.expandedDestination).toBe(runtimePath.toString() || null);
    expect(trace.finalPath).toBe(runtimePath.finalize());
  });
});

import { historyCsv, localizeHistoryColumns } from "../../src/options/history-view.ts";
import { localizeRuleTemplates, RULE_TEMPLATES } from "../../src/options/rule-templates.ts";

const translated = (key: string): string => `translated:${key}`;

test("rule-template localization replaces copy without changing routing behavior", () => {
  const templates = localizeRuleTemplates(translated);

  expect(templates).toHaveLength(RULE_TEMPLATES.length);
  expect(templates[0]).toMatchObject({
    category: "translated:ruleTemplateCategoryMedia",
    name: "translated:ruleTemplateImagesPerSiteName",
    description: "translated:ruleTemplateImagesPerSiteDescription",
    rule: RULE_TEMPLATES[0]!.rule,
    proof: RULE_TEMPLATES[0]!.proof,
  });
});

test("history localization supplies labels used by exports", () => {
  const columns = localizeHistoryColumns(translated);

  expect(columns.find(({ key }) => key === "time")?.label).toBe(
    "translated:historyColumnInitiated",
  );
  expect(columns.find(({ key }) => key === "folder")?.label).toBe("translated:historyColumnFolder");
  expect(historyCsv([], columns)).toContain('"translated:historyColumnInitiated"');
});

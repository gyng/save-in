import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  HISTORY_COLUMNS,
  historyCsv,
  localizeHistoryColumns,
} from "../src/options/history-view.ts";
import { localizeRuleTemplates, RULE_TEMPLATES } from "../src/options/rule-templates.ts";

type Catalog = Record<string, { message: string }>;

const readCatalog = (path: string): Catalog =>
  JSON.parse(readFileSync(resolve(path), "utf8")) as Catalog;

test("Japanese localizes every routing-template card", () => {
  const japanese = readCatalog("src/i18n/generated/ja/messages.json");
  const templates = localizeRuleTemplates((key) => japanese[key]?.message ?? "");

  expect(templates).toHaveLength(RULE_TEMPLATES.length);
  templates.forEach((template, index) => {
    expect(template.category).not.toBe(RULE_TEMPLATES[index]?.category);
    expect(template.name).not.toBe(RULE_TEMPLATES[index]?.name);
    expect(template.description).not.toBe(RULE_TEMPLATES[index]?.description);
  });
});

test("Japanese localizes history headings and spreadsheet export headers", () => {
  const japanese = readCatalog("src/i18n/generated/ja/messages.json");
  const columns = localizeHistoryColumns((key) => japanese[key]?.message ?? "");

  expect(columns.find(({ key }) => key === "time")?.label).toBe("開始日時");
  expect(columns.find(({ key }) => key === "folder")?.label).toBe("フォルダー");
  expect(
    columns
      .filter(({ key }) => key !== "index")
      .every(
        ({ label }) =>
          [...label].some((character) => character.codePointAt(0)! > 127) || label === "URL",
      ),
  ).toBe(true);
  expect(historyCsv([], columns)).toContain('"開始日時","保存元","方式","状態"');
  expect(HISTORY_COLUMNS.find(({ key }) => key === "time")?.label).toBe("Initiated");
});

test("Japanese uses consistent Downloads-folder and experimental-feature terminology", () => {
  const japanese = readCatalog("src/i18n/generated/ja/messages.json");

  expect(japanese.o_lExperimental?.message).toBe("試験運用");
  expect(japanese.html_defaultDownloadsDirectory?.message).toBe(
    "デフォルトのダウンロードフォルダー",
  );
  expect(japanese.html_openTheDefaultDownloadsDirectory?.message).not.toMatch(/Downloads?/);
  expect(japanese.o_lSourcePanelShortcutResetHelp?.message).toContain("既定値");
});

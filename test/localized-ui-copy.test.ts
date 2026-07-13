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

const cjkLocales = ["ja", "ko", "zh_CN", "zh_TW"] as const;

test("every CJK catalog localizes routing-template cards and history columns", () => {
  for (const locale of cjkLocales) {
    const catalog = readCatalog(`src/i18n/generated/${locale}/messages.json`);
    const templates = localizeRuleTemplates((key) => catalog[key]?.message ?? "");
    const columns = localizeHistoryColumns((key) => catalog[key]?.message ?? "");

    expect(templates, locale).toHaveLength(RULE_TEMPLATES.length);
    templates.forEach((template, index) => {
      expect(template.category, `${locale} category`).not.toBe(RULE_TEMPLATES[index]?.category);
      expect(template.name, `${locale} name`).not.toBe(RULE_TEMPLATES[index]?.name);
      expect(template.description, `${locale} description`).not.toBe(
        RULE_TEMPLATES[index]?.description,
      );
    });
    columns
      .filter(({ key }) => !["index", "url"].includes(key))
      .forEach((column) => {
        expect(column.label, `${locale} history ${column.key}`).not.toBe(
          HISTORY_COLUMNS.find(({ key }) => key === column.key)?.label,
        );
      });
    expect(catalog.o_lSourcePanelShortcutResetHelp?.message, `${locale} reset help`).toBeTruthy();
  }
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

test("CJK copy avoids known literal-translation and regional-terminology regressions", () => {
  const japanese = readCatalog("src/i18n/generated/ja/messages.json");
  const korean = readCatalog("src/i18n/generated/ko/messages.json");
  const simplified = readCatalog("src/i18n/generated/zh_CN/messages.json");
  const traditional = readCatalog("src/i18n/generated/zh_TW/messages.json");

  for (const catalog of [japanese, korean, simplified, traditional]) {
    expect(catalog.ruleMissingInto?.message).toContain("into:");
  }

  expect(japanese.ruleMissingMatcher?.message).not.toContain("matcher");
  expect(japanese.tabstripMenuMultipleSelectedTab?.message).not.toContain("強調表示");
  expect(korean.tabstripMenuMultipleSelectedTab?.message).not.toContain("강조 표시");
  expect(simplified.tabstripMenuMultipleSelectedTab?.message).not.toContain("突出显示");
  expect(traditional.tabstripMenuMultipleSelectedTab?.message).not.toContain("反白");

  expect(japanese.o_cSourcePanelResourceHints?.message).not.toContain("ベストエフォート");
  expect(korean.o_cSourcePanelResourceHints?.message).not.toContain("최선의 노력");
  expect(simplified.o_cSourcePanelResourceHints?.message).not.toContain("尽力而为");
  expect(traditional.o_cSourcePanelResourceHints?.message).not.toContain("盡力而為");

  expect(korean.html_oneRelativeDirectoryOrMenuInstructionPerLineDownloads?.message).not.toContain(
    "관련 폴더",
  );
  expect(
    simplified.html_oneRelativeDirectoryOrMenuInstructionPerLineDownloads?.message,
  ).not.toContain("相关文件夹");
  expect(
    traditional.html_oneRelativeDirectoryOrMenuInstructionPerLineDownloads?.message,
  ).not.toContain("相關資料夾");

  expect(traditional.rulePathInvalidCharacter?.message).toContain("字元");
  expect(traditional.o_sExistingFiles?.message).toBe("現有檔案");
  expect(traditional.html_currentDatetimeAsAUnixTimestamp?.message).toContain("目前");
  expect(traditional.html_charactersForDeeperNesting?.message).toContain("巢狀");
  expect(traditional.o_lClauseList?.message).toBe("子句清單");
  expect(traditional.o_lMenuPreview?.message).toBe("選單預覽");
  expect(traditional.html_jsonCompleteData?.message).toContain("資料");
});

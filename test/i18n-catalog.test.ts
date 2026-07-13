import { readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { GENERATED_LOCALES } from "../src/shared/generated-locales.ts";

type Message = {
  message: string;
  description?: string;
  placeholders?: Record<string, { content: string; example?: string }>;
};

type Catalog = Record<string, Message>;

const edgeWhitespace = (message: string): [string, string] => [
  message.match(/^\s*/)?.[0] ?? "",
  message.match(/\s*$/)?.[0] ?? "",
];

const readCatalog = (locale: string): Catalog =>
  JSON.parse(readFileSync(resolve(`_locales/${locale}/messages.json`), "utf8"));

const readGeneratedCatalog = (locale: string): Catalog =>
  JSON.parse(readFileSync(resolve(`src/i18n/generated/${locale}/messages.json`), "utf8"));

const listSourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    return [".html", ".ts"].includes(extname(entry.name)) ? [path] : [];
  });

const collectRuntimeMessageKeys = (): Set<string> => {
  const keys = new Set<string>();
  const manifestAndHtml = [
    resolve("manifest.json"),
    ...listSourceFiles(resolve("src")).filter((file) => extname(file) === ".html"),
  ];
  for (const file of manifestAndHtml) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) keys.add(match[1]!);
  }

  for (const file of listSourceFiles(resolve("src")).filter((path) => extname(path) === ".ts")) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\b(?:getMessage|localize)\(\s*["']([A-Za-z0-9_]+)["']/g)) {
      keys.add(match[1]!);
    }
  }
  return keys;
};

const intentionallyLiteralText = new Set([
  "Chrome",
  "Chrome 150+",
  "CSV",
  "Firefox",
  "GitHub",
  "JSON",
  "macOS / Linux",
  "MDN",
  "Save In",
  "TSV",
  "WebMCP",
  "Windows",
]);

const isReferenceExample = (node: Node): boolean => {
  const cell = node.parentElement?.closest("td");
  const row = cell?.parentElement;
  return Boolean(cell && row?.closest("table.box") && [...row.children].indexOf(cell) === 1);
};

const isIntentionalLiteral = (node: Node): boolean => {
  const text = node.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return (
    !/[A-Za-z]/.test(text) ||
    text.includes("__MSG_") ||
    Boolean(node.parentElement?.closest("code, pre, #uiLocale, [data-technical-literal]")) ||
    isReferenceExample(node) ||
    intentionallyLiteralText.has(text) ||
    /^(?:https?:\/\/|[A-Za-z0-9_.-]+\.(?:gif|jpe?g|m3u8|mp4|png|webp))/.test(text)
  );
};

const locales = readdirSync(resolve("_locales"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .toSorted();

test("locale catalogs follow the WebExtension message schema", () => {
  for (const locale of locales) {
    const catalog = readCatalog(locale);
    for (const [key, value] of Object.entries(catalog)) {
      expect(value, `${locale}.${key}`).toEqual(
        expect.objectContaining({ message: expect.any(String) }),
      );
      expect(Object.keys(value), `${locale}.${key}`).toEqual(expect.arrayContaining(["message"]));
      expect(
        Object.keys(value).every((field) =>
          ["description", "message", "placeholders"].includes(field),
        ),
        `${locale}.${key}`,
      ).toBe(true);
      if (value.description !== undefined) expect(value.description).toEqual(expect.any(String));
      for (const [placeholder, definition] of Object.entries(value.placeholders ?? {})) {
        expect(definition, `${locale}.${key}.placeholders.${placeholder}`).toEqual(
          expect.objectContaining({ content: expect.any(String) }),
        );
        expect(
          Object.keys(definition).every((field) => ["content", "example"].includes(field)),
          `${locale}.${key}.placeholders.${placeholder}`,
        ).toBe(true);
        if (definition.example !== undefined)
          expect(definition.example).toEqual(expect.any(String));
      }
    }
  }
});

test("English is the exact schema for runtime message keys", () => {
  expect(Object.keys(readCatalog("en")).toSorted()).toEqual(
    [...collectRuntimeMessageKeys()].toSorted(),
  );
});

test("static options copy is localized or explicitly technical", () => {
  const attributes = ["alt", "aria-label", "placeholder", "title"] as const;
  for (const file of listSourceFiles(resolve("src/options")).filter(
    (path) => extname(path) === ".html",
  )) {
    const document = new DOMParser().parseFromString(readFileSync(file, "utf8"), "text/html");
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
    const rawText: string[] = [];
    while (walker.nextNode()) {
      if (!isIntentionalLiteral(walker.currentNode)) {
        rawText.push(walker.currentNode.textContent?.replace(/\s+/g, " ").trim() ?? "");
      }
    }
    expect(rawText, file).toEqual([]);

    const rawAttributes = [...document.querySelectorAll("*")].flatMap((element) =>
      attributes.flatMap((attribute) => {
        const value = element.getAttribute(attribute);
        if (
          !value ||
          !/[A-Za-z]/.test(value) ||
          value.includes("__MSG_") ||
          element.closest("#uiLocale, code, pre") ||
          /^(?:\*:\/\/|images\/|jpg\|png$|Y$)/.test(value)
        ) {
          return [];
        }
        return [`${attribute}=${JSON.stringify(value)}`];
      }),
    );
    expect(rawAttributes, file).toEqual([]);
  }
});

test("English is the only browser-native catalog", () => {
  expect(locales).toEqual(["en"]);
});

test("AI-generated catalogs match the complete English schema", () => {
  const canonical = readCatalog("en");
  for (const { locale } of GENERATED_LOCALES) {
    const catalog = readGeneratedCatalog(locale);
    const catalogKeys = Object.keys(catalog).toSorted();
    expect(
      catalogKeys.filter((key) => !canonical[key]),
      `${locale} unknown keys`,
    ).toEqual([]);
    expect(
      Object.keys(canonical).filter((key) => !catalog[key]),
      `${locale} missing keys`,
    ).toEqual([]);
    expect(
      catalogKeys.filter(
        (key) =>
          JSON.stringify(catalog[key]?.placeholders ?? {}) !==
          JSON.stringify(canonical[key]?.placeholders ?? {}),
      ),
      `${locale} placeholders`,
    ).toEqual([]);
    expect(
      catalogKeys.filter((key) => catalog[key]?.message.includes("__SI_TOKEN_")),
      `${locale} protected translation tokens`,
    ).toEqual([]);
    expect(
      catalogKeys.filter(
        (key) =>
          JSON.stringify(edgeWhitespace(catalog[key]?.message ?? "")) !==
          JSON.stringify(edgeWhitespace(canonical[key]?.message ?? "")),
      ),
      `${locale} intentional edge whitespace`,
    ).toEqual([]);
    expect(
      catalogKeys.filter(
        (key) =>
          key !== "translationCredits" && /[\u200B-\u200D\uFEFF]/.test(catalog[key]?.message ?? ""),
      ),
      `${locale} invisible translation artifacts`,
    ).toEqual([]);
    expect(
      catalogKeys.filter((key) => catalog[key]?.message !== canonical[key]?.message).length,
      `${locale} translated messages`,
    ).toBeGreaterThan(catalogKeys.length * 0.8);
  }
});

test("AI-generated catalogs preserve technical tokens and localized UI terminology", () => {
  const canonical = readCatalog("en");
  const ruleTemplateKeys = Object.keys(canonical).filter((key) => key.startsWith("ruleTemplate"));
  const fileFormatKeys = [
    "o_cSaveShortcutsTypeMac",
    "o_cSaveShortcutsTypeMacWebloc",
    "o_cSaveShortcutsTypeWindows",
    "o_cSaveShortcutsTypeFreedesktop",
  ];
  const modifierLabelKeys = [
    "html_altOption",
    "html_command",
    "html_commandWindowsKey",
    "html_ctrl",
    "html_macctrl",
    "html_none",
    "html_shift",
  ];
  const keyboardTokenKeys = [
    "o_cKeyboardShortcutClickToHelp",
    "o_cKeyboardShortcutModifierHelp",
    "o_cOpenDialogShift",
    "o_lShortcutFormat",
    "o_lShortcutPrimaryModifier",
    "o_lShortcutValidKey",
    "o_lSourcePanelShortcutHelp",
  ];
  const keyboardTokenPattern = /\b(?:Alt|Shift|Ctrl|Command|MacCtrl|None|F12|PageDown)\b/g;
  const protectedTokenPattern =
    /Save In|Chrome|Firefox|macOS|Windows|GitHub|MDN|WebMCP|WebExtensions?|Content-(?:Disposition|Type)|Referer|SHA-256|ISO 8601|JavaScript|HTML|HTTP\(S\)|HTTPS?|POST|MIME|UUID|JSON|CSV|TSV|HLS|DASH|API|CSS|UTC|PDF|\bURL(?=s?\b)|Ctrl\+Shift\+Y|Command\+Shift\+Y|\*:\/\/[^\s]+?\/\*|:[A-Za-z0-9$]+:|\$[A-Z0-9_]+\$/g;

  for (const { locale } of GENERATED_LOCALES) {
    const catalog = readGeneratedCatalog(locale);
    expect(
      ruleTemplateKeys.filter((key) => !catalog[key]),
      `${locale} routing-template translations`,
    ).toEqual([]);
    for (const key of fileFormatKeys) {
      expect(catalog[key]?.message, `${locale}.${key}`).toBe(canonical[key]?.message);
    }
    for (const key of modifierLabelKeys) {
      expect(catalog[key]?.message, `${locale}.${key} literal modifier label`).toBe(
        canonical[key]?.message,
      );
    }
    for (const key of keyboardTokenKeys) {
      for (const token of canonical[key]?.message.match(keyboardTokenPattern) ?? []) {
        expect(catalog[key]?.message, `${locale}.${key} keyboard token ${token}`).toContain(token);
      }
    }
    expect(catalog.o_lSourcePanelShortcutHelp?.message, `${locale} shortcut Ctrl syntax`).toContain(
      "Ctrl+Shift+Y",
    );
    expect(
      catalog.o_lSourcePanelShortcutHelp?.message,
      `${locale} shortcut Command syntax`,
    ).toContain("Command+Shift+Y");
    expect(
      catalog.o_cSetRefererHeaderFilterHelp?.message,
      `${locale} Referer match pattern`,
    ).toContain("*://i.pximg.net/*");
    expect(catalog.o_lManualEditorSaveHelp?.message, `${locale} Apply terminology`).toContain(
      catalog.o_bApply?.message,
    );
    for (const [key, definition] of Object.entries(catalog)) {
      const canonicalMessage = canonical[key]?.message ?? "";
      for (const token of canonicalMessage.match(protectedTokenPattern) ?? []) {
        expect(definition.message, `${locale}.${key} technical token ${token}`).toContain(token);
      }
      if (canonicalMessage.endsWith("…")) {
        expect(definition.message, `${locale}.${key} ellipsis`).toMatch(/…$/);
      }
    }
  }
});

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
    for (const match of source.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) keys.add(match[1]);
  }

  for (const file of listSourceFiles(resolve("src")).filter((path) => extname(path) === ".ts")) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\bgetMessage\(\s*["']([A-Za-z0-9_]+)["']/g)) {
      keys.add(match[1]);
    }
  }
  return keys;
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

test("English is the only browser-native catalog", () => {
  expect(locales).toEqual(["en"]);
});

test("AI-generated catalogs completely implement the English schema", () => {
  const canonical = readCatalog("en");
  const canonicalKeys = Object.keys(canonical).toSorted();
  for (const { locale } of GENERATED_LOCALES) {
    const catalog = readGeneratedCatalog(locale);
    expect(Object.keys(catalog).toSorted(), locale).toEqual(canonicalKeys);
    expect(
      canonicalKeys.filter(
        (key) =>
          JSON.stringify(catalog[key]?.placeholders ?? {}) !==
          JSON.stringify(canonical[key]?.placeholders ?? {}),
      ),
      `${locale} placeholders`,
    ).toEqual([]);
    expect(
      canonicalKeys.filter((key) => catalog[key]?.message.includes("__SI_TOKEN_")),
      `${locale} protected translation tokens`,
    ).toEqual([]);
    expect(
      canonicalKeys.filter(
        (key) =>
          JSON.stringify(edgeWhitespace(catalog[key]?.message ?? "")) !==
          JSON.stringify(edgeWhitespace(canonical[key]?.message ?? "")),
      ),
      `${locale} intentional edge whitespace`,
    ).toEqual([]);
    expect(
      canonicalKeys.filter(
        (key) =>
          key !== "translationCredits" && /[\u200B-\u200D\uFEFF]/.test(catalog[key]?.message ?? ""),
      ),
      `${locale} invisible translation artifacts`,
    ).toEqual([]);
    expect(
      canonicalKeys.filter((key) => catalog[key]?.message !== canonical[key]?.message).length,
      `${locale} translated messages`,
    ).toBeGreaterThan(canonicalKeys.length * 0.8);
  }
});

test("AI-generated catalogs preserve technical tokens and localized UI terminology", () => {
  const canonical = readCatalog("en");
  const fileFormatKeys = [
    "o_cSaveShortcutsTypeMac",
    "o_cSaveShortcutsTypeMacWebloc",
    "o_cSaveShortcutsTypeWindows",
    "o_cSaveShortcutsTypeFreedesktop",
  ];
  const brandedKeys = Object.keys(canonical).filter((key) =>
    canonical[key]?.message.includes("Save In"),
  );

  for (const { locale } of GENERATED_LOCALES) {
    const catalog = readGeneratedCatalog(locale);
    for (const key of fileFormatKeys) {
      expect(catalog[key]?.message, `${locale}.${key}`).toBe(canonical[key]?.message);
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
    for (const key of brandedKeys) {
      expect(catalog[key]?.message, `${locale}.${key} branding`).toContain("Save In");
    }
  }
});

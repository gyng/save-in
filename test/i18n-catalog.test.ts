import { readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { GENERATED_LOCALES } from "../src/shared/generated-locales.ts";

type Message = {
  message: string;
  description?: string;
  placeholders?: Record<string, { content: string; example?: string }>;
};

type Catalog = Record<string, Message>;

const readCatalog = (locale: string): Catalog =>
  JSON.parse(readFileSync(resolve(`_locales/${locale}/messages.json`), "utf8"));

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

test("partial legacy translations do not retain keys outside the English schema", () => {
  const canonicalKeys = new Set(Object.keys(readCatalog("en")));
  for (const locale of locales.filter((candidate) => candidate !== "en")) {
    const extraKeys = Object.keys(readCatalog(locale)).filter((key) => !canonicalKeys.has(key));
    expect(extraKeys, locale).toEqual([]);
  }
});

test("AI-generated catalogs completely implement the English schema", () => {
  const canonical = readCatalog("en");
  const canonicalKeys = Object.keys(canonical).toSorted();
  for (const { locale } of GENERATED_LOCALES) {
    const catalog = JSON.parse(
      readFileSync(resolve(`src/i18n/generated/${locale}/messages.json`), "utf8"),
    ) as Catalog;
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
      canonicalKeys.filter((key) => catalog[key]?.message !== canonical[key]?.message).length,
      `${locale} translated messages`,
    ).toBeGreaterThan(canonicalKeys.length * 0.8);
  }
});

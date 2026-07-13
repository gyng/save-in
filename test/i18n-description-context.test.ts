import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

type Message = {
  message: string;
  description?: string;
};

const listSourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    return [".html", ".ts"].includes(extname(entry.name)) ? [path] : [];
  });

const sourcePath = (path: string): string => relative(resolve(), path).replaceAll("\\", "/");

const collectRuntimeMessageUses = (): Map<string, Set<string>> => {
  const uses = new Map<string, Set<string>>();
  const record = (key: string, path: string): void => {
    const paths = uses.get(key) ?? new Set<string>();
    paths.add(sourcePath(path));
    uses.set(key, paths);
  };

  const manifestAndHtml = [
    resolve("manifest.json"),
    ...listSourceFiles(resolve("src")).filter((path) => extname(path) === ".html"),
  ];
  for (const path of manifestAndHtml) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) {
      record(match[1]!, path);
    }
  }

  for (const path of listSourceFiles(resolve("src")).filter((path) => extname(path) === ".ts")) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/\b(?:getMessage|localize)\(\s*["']([A-Za-z0-9_]+)["']/g)) {
      record(match[1]!, path);
    }
  }

  return uses;
};

test("every English message describes each source location where it is used", () => {
  const catalog = JSON.parse(readFileSync(resolve("_locales/en/messages.json"), "utf8")) as Record<
    string,
    Message
  >;
  const uses = collectRuntimeMessageUses();

  for (const [key, definition] of Object.entries(catalog)) {
    expect(definition.description?.trim(), `${key} translator context`).toBeTruthy();
    expect(uses.get(key), `${key} runtime use`).toBeDefined();
    for (const path of uses.get(key) ?? []) {
      expect(definition.description, `${key} use in ${path}`).toContain(path);
    }
  }
});

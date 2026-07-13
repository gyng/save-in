import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(path), "utf8");

test("user documentation matches current browser requirements and Referer architecture", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const docs = [read("README.md"), read("docs/INTEGRATIONS.md")].join("\n");

  expect(manifest.minimum_chrome_version).toBe("123");
  expect(docs).toContain("Chrome 123+");
  expect(docs).toContain("Firefox");
  expect(docs).toContain("downloads.download({ headers })");
  expect(docs).toContain("Chrome does not support");
  expect(docs).not.toMatch(/declarativeNetRequest (?:injects|session rule)/i);
});

test("integration docs distinguish Firefox and Chrome extension IDs", () => {
  const docs = read("docs/INTEGRATIONS.md");

  expect(docs).toContain("{72d92df5-2aa0-4b06-b807-aa21767545cd}");
  expect(docs).toContain("jpblofcpgfjikaapfedldfeilmpgkedf");
  expect(docs).toContain("platform-specific");
});

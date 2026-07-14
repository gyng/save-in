import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const { GENERATED_DIRECTORIES, cleanGenerated } = require("../scripts/clean-generated.js") as {
  GENERATED_DIRECTORIES: readonly string[];
  cleanGenerated: (root: string) => string[];
};

const roots: string[] = [];

afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("generated-output cleanup", () => {
  test("removes only the declared generated directories", () => {
    const root = mkdtempSync(join(tmpdir(), "save-in-clean-generated-"));
    roots.push(root);
    for (const directory of GENERATED_DIRECTORIES) {
      mkdirSync(join(root, directory), { recursive: true });
      writeFileSync(join(root, directory, "artifact.txt"), "generated");
    }
    writeFileSync(join(root, "keep.txt"), "source");

    expect(cleanGenerated(root)).toEqual(GENERATED_DIRECTORIES);
    expect(GENERATED_DIRECTORIES.every((directory) => !existsSync(join(root, directory)))).toBe(
      true,
    );
    expect(existsSync(join(root, "keep.txt"))).toBe(true);
  });

  test("is idempotent when generated output is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "save-in-clean-generated-empty-"));
    roots.push(root);

    expect(cleanGenerated(root)).toEqual([]);
  });
});

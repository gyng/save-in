import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { assertPackageVersion } = require("../../scripts/lib/package-metadata.js");

const fixture = (packageVersion: unknown, manifestVersion: unknown) => {
  const root = mkdtempSync(join(tmpdir(), "save-in-metadata-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ version: packageVersion }));
  writeFileSync(join(root, "manifest.json"), JSON.stringify({ version: manifestVersion }));
  return root;
};

describe("package metadata", () => {
  test("returns a shared package and manifest version", () => {
    expect(assertPackageVersion(fixture("4.0.0", "4.0.0"))).toBe("4.0.0");
  });

  test("rejects mismatched or invalid versions before packaging", () => {
    expect(() => assertPackageVersion(fixture("4.0.0", "4.0.1"))).toThrow("do not match");
    expect(() => assertPackageVersion(fixture("", ""))).toThrow("non-empty version");
  });
});

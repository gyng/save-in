import { afterEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { prepare, releaseVersion } = require("../../scripts/prepare-release.js");

const roots: string[] = [];

// A whole fake repo root, outside the working tree: prepare() reads the two
// manifests and copies real bytes, so it needs files rather than mocks.
const makeRoot = (version: string) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "save-in-release-"));
  roots.push(root);
  for (const name of ["package.json", "manifest.json"]) {
    fs.writeFileSync(path.join(root, name), JSON.stringify({ version }));
  }
  const artifacts = path.join(root, "web-ext-artifacts");
  fs.mkdirSync(path.join(artifacts, "source"), { recursive: true });
  fs.writeFileSync(path.join(artifacts, `save-in-${version}.zip`), "runtime-bytes");
  fs.writeFileSync(path.join(artifacts, "source", `save-in-${version}-source.zip`), "source-bytes");
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("prepare-release", () => {
  it("accepts a v-prefixed tag matching both manifests", () => {
    expect(releaseVersion("v4.0.0", "4.0.0", "4.0.0")).toBe("4.0.0");
  });

  it("rejects a tag or manifest version mismatch", () => {
    expect(() => releaseVersion("v4.0.1", "4.0.0", "4.0.0")).toThrow("does not match");
    expect(() => releaseVersion("v4.0.0", "4.0.0", "4.0.1")).toThrow("do not match");
  });

  it("requires the repository's v-prefixed release tag format", () => {
    expect(() => releaseVersion("4.0.0", "4.0.0", "4.0.0")).toThrow("v-prefixed");
  });

  it("publishes the runtime package under both store and sideload names", () => {
    const { output } = prepare(makeRoot("4.0.0"), "v4.0.0");

    expect(fs.readdirSync(output).toSorted()).toEqual([
      "SHA256SUMS",
      "save-in-4.0.0-source.zip",
      "save-in-4.0.0.xpi",
      "save-in-4.0.0.zip",
    ]);
    // The .xpi is the .zip: Firefox needs the extension to offer an install,
    // and shipping a rebuild instead of a copy would be a second artifact to
    // trust. Identical bytes make that checkable from SHA256SUMS alone.
    expect(fs.readFileSync(path.join(output, "save-in-4.0.0.xpi"), "utf8")).toBe("runtime-bytes");
  });

  it("checksums every published artifact", () => {
    const { output } = prepare(makeRoot("4.0.0"), "v4.0.0");

    const sums = fs.readFileSync(path.join(output, "SHA256SUMS"), "utf8");
    const digest = (contents: string) => crypto.createHash("sha256").update(contents).digest("hex");

    expect(sums).toBe(
      [
        `${digest("runtime-bytes")}  save-in-4.0.0.zip`,
        `${digest("runtime-bytes")}  save-in-4.0.0.xpi`,
        `${digest("source-bytes")}  save-in-4.0.0-source.zip`,
        "",
      ].join("\n"),
    );
  });

  it("refuses to publish when a build artifact is missing", () => {
    const root = makeRoot("4.0.0");
    fs.rmSync(path.join(root, "web-ext-artifacts", "save-in-4.0.0.zip"));

    expect(() => prepare(root, "v4.0.0")).toThrow("Missing release artifact");
  });

  it("publishes and checksums the Chromium CRX once it has been packed", () => {
    const root = makeRoot("4.0.0");
    fs.writeFileSync(path.join(root, "web-ext-artifacts", "save-in-4.0.0-chromium.crx"), "crx");

    const { output } = prepare(root, "v4.0.0");

    expect(fs.existsSync(path.join(output, "save-in-4.0.0-chromium.crx"))).toBe(true);
    expect(fs.readFileSync(path.join(output, "SHA256SUMS"), "utf8")).toContain(
      "save-in-4.0.0-chromium.crx",
    );
  });

  it("publishes without the Chromium CRX when no signing key produced one", () => {
    // The CRX is the only optional artifact: it needs a key the build does not
    // have on its own, and a release is still complete without it.
    const { output } = prepare(makeRoot("4.0.0"), "v4.0.0");

    expect(fs.readdirSync(output)).not.toContain("save-in-4.0.0-chromium.crx");
    expect(fs.readFileSync(path.join(output, "SHA256SUMS"), "utf8")).not.toContain(".crx");
  });
});

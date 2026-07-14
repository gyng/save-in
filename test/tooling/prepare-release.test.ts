import { describe, expect, it } from "vitest";

const { releaseVersion } = require("../../scripts/prepare-release.js");

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
});

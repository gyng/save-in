import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  BACKGROUND_E2E_COMMAND_MARKER,
  assertBackgroundControlSurface,
} = require("../../scripts/lib/bundle-control-surface.js");
const { parseBuildMode } = require("../../scripts/lib/build-mode.js");

const writeBundles = (directory: string, source: string) => {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "background.js"), source);
  writeFileSync(join(directory, "background.sw.js"), source);
};

test("accepts production artifacts only when the e2e command is absent", () => {
  const directory = mkdtempSync(join(tmpdir(), "save-in-production-bundle-"));
  writeBundles(directory, "production background");

  expect(() => assertBackgroundControlSurface(directory, false)).not.toThrow();
  writeBundles(directory, `production background ${BACKGROUND_E2E_COMMAND_MARKER}`);
  expect(() => assertBackgroundControlSurface(directory, false)).toThrow(
    "Unexpected e2e control surface",
  );
});

test("accepts e2e artifacts only when the command is present", () => {
  const directory = mkdtempSync(join(tmpdir(), "save-in-e2e-bundle-"));
  writeBundles(directory, `browser test ${BACKGROUND_E2E_COMMAND_MARKER}`);

  expect(() => assertBackgroundControlSurface(directory, true)).not.toThrow();
  writeBundles(directory, "browser test without control command");
  expect(() => assertBackgroundControlSurface(directory, true)).toThrow(
    "Unexpected e2e control surface",
  );
});

test("selects build mode only from an explicit command argument", () => {
  expect(parseBuildMode([])).toBe("production");
  expect(parseBuildMode(["--mode=e2e"])).toBe("e2e");
  expect(() => parseBuildMode(["--mode=release"])).toThrow("Unsupported build mode");
  expect(() => parseBuildMode(["e2e"])).toThrow("Expected at most one");
});

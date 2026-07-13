import { availableParallelism } from "node:os";
import { describe, expect, test } from "vitest";

import config, { resolveMaxWorkers } from "../vitest.config.mjs";

describe("test runner resource limits", () => {
  test("leaves two logical CPUs available by default", () => {
    expect(config.test?.maxWorkers).toBe(Math.max(1, availableParallelism() - 2));
  });

  test("uses every available CPU in CI", () => {
    expect(resolveMaxWorkers({ ci: "true", cores: 8 })).toBe(8);
    expect(resolveMaxWorkers({ ci: "1", cores: 2 })).toBe(2);
  });

  test("an explicit worker limit overrides local and CI defaults", () => {
    expect(resolveMaxWorkers({ requested: "5", ci: "true", cores: 8 })).toBe(5);
    expect(resolveMaxWorkers({ requested: "0", cores: 8 })).toBe(1);
  });

  test("runs browser E2E headlessly unless headed mode is requested", async () => {
    const manifest = (await import("../package.json", { with: { type: "json" } })).default;

    expect(manifest.scripts.e2e).toBe("node scripts/e2e-parallel.js");
    expect(manifest.scripts["e2e:headed"]).toContain("HEADED=1");
    expect(manifest.scripts["e2e:chrome"]).toContain("HEADLESS=1");
    expect(manifest.scripts["e2e:firefox"]).toContain("HEADLESS=1");
  });
});

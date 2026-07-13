import { availableParallelism } from "node:os";
import { describe, expect, test } from "vitest";

import config from "../vitest.config.mjs";

describe("test runner resource limits", () => {
  test("leaves two logical CPUs available by default", () => {
    expect(config.test?.maxWorkers).toBe(Math.max(1, availableParallelism() - 2));
  });

  test("runs browser E2E headlessly unless headed mode is requested", async () => {
    const manifest = (await import("../package.json", { with: { type: "json" } })).default;

    expect(manifest.scripts.e2e).toBe("node scripts/e2e-parallel.js");
    expect(manifest.scripts["e2e:headed"]).toContain("HEADED=1");
    expect(manifest.scripts["e2e:chrome"]).toContain("HEADLESS=1");
    expect(manifest.scripts["e2e:firefox"]).toContain("HEADLESS=1");
  });
});

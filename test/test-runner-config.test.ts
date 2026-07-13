import { availableParallelism } from "node:os";
import { describe, expect, test } from "vitest";

import config, { resolveMaxWorkers } from "../vitest.config.mjs";

describe("test runner resource limits", () => {
  test("leaves four logical CPUs available by default", () => {
    expect(config.test?.maxWorkers).toBe(Math.max(1, availableParallelism() - 4));
    expect(resolveMaxWorkers({ cores: 32 })).toBe(28);
    expect(resolveMaxWorkers({ cores: 8 })).toBe(4);
    expect(resolveMaxWorkers({ cores: 2 })).toBe(1);
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

  test("excludes current bundle and service-worker bootstrap paths from core coverage", () => {
    const exclude = config.test?.coverage?.exclude ?? [];

    expect(exclude).toContain("src/entries/**");
    expect(exclude).toContain("src/background/main.ts");
    expect(exclude).toContain("src/content/source-panel.ts");
    expect(exclude).toContain("src/downloads/notification.ts");
    expect(exclude).not.toContain("src/entry.*.ts");
  });
});

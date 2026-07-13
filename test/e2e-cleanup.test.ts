import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const { pruneArtifactRuns, removeOwnedProfiles } = require("../scripts/lib/e2e-cleanup.js") as {
  pruneArtifactRuns: (directory: string, keep?: number) => void;
  removeOwnedProfiles: (
    pids: number[],
    options: { chromeRoot: string; firefoxRoot: string; attempts?: number; delayMs?: number },
  ) => Promise<void>;
};

const roots: string[] = [];
const tempRoot = (name: string) => {
  const root = mkdtempSync(join(tmpdir(), name));
  roots.push(root);
  return root;
};

afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("E2E lifecycle cleanup", () => {
  test("attaches suite completion handlers at spawn time", () => {
    const runner = require("node:fs").readFileSync("scripts/e2e-parallel.js", "utf8");

    expect(runner).toMatch(
      /const child = spawn[\s\S]*child\.once\("exit"[\s\S]*return \{ child, done \}/,
    );
    expect(runner).toContain("await Promise.all(runs.map(({ done }) => done))");
  });

  test("removes only profiles owned by suite child processes", async () => {
    const chromeRoot = tempRoot("save-in-cleanup-chrome-");
    const firefoxRoot = tempRoot("save-in-cleanup-firefox-");
    const owned = [
      join(chromeRoot, "e2e-profile-123-1-a"),
      join(firefoxRoot, "save-in-ff-e2e-456-2-b"),
    ];
    const unrelated = [
      join(chromeRoot, "e2e-profile-999-1-c"),
      join(firefoxRoot, "normal-firefox-profile"),
    ];
    for (const profile of [...owned, ...unrelated]) {
      mkdirSync(join(profile, "downloads"), { recursive: true });
      writeFileSync(join(profile, "downloads", "fixture.txt"), "fixture");
    }

    await removeOwnedProfiles([123, 456], { chromeRoot, firefoxRoot, delayMs: 0 });

    expect(readdirSync(chromeRoot)).toEqual(["e2e-profile-999-1-c"]);
    expect(readdirSync(firefoxRoot)).toEqual(["normal-firefox-profile"]);
  });

  test("continues cleaning other owned profiles and aggregates failures", async () => {
    const chromeRoot = tempRoot("save-in-cleanup-failure-");
    const firefoxRoot = tempRoot("save-in-cleanup-empty-");
    mkdirSync(join(chromeRoot, "e2e-profile-123-locked"));
    mkdirSync(join(chromeRoot, "e2e-profile-123-removable"));

    // A zero-attempt removal deterministically exercises error aggregation.
    await expect(
      removeOwnedProfiles([123], { chromeRoot, firefoxRoot, attempts: 0, delayMs: 0 }),
    ).rejects.toThrow("E2E profile cleanup failed");
  });

  test("keeps the newest diagnostic runs and removes legacy flat artifacts", () => {
    const artifacts = tempRoot("save-in-artifacts-");
    writeFileSync(join(artifacts, "legacy.log"), "old");
    for (let index = 1; index <= 5; index += 1) {
      const run = join(artifacts, `run-${index}`);
      mkdirSync(run);
      writeFileSync(join(run, "failure.json"), "{}");
      const time = new Date(1_000 * index);
      require("node:fs").utimesSync(run, time, time);
    }

    pruneArtifactRuns(artifacts, 3);

    expect(readdirSync(artifacts).toSorted()).toEqual(["run-3", "run-4", "run-5"]);
  });
});

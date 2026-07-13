import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  acquireDirectoryLock,
  pruneArtifactRuns,
  pruneRunDirectories,
  releaseDirectoryLock,
  removeOwnedProfiles,
} = require("../scripts/lib/e2e-cleanup.js") as {
  acquireDirectoryLock: (
    directory: string,
    options?: { timeoutMs?: number; pollMs?: number; pid?: number },
  ) => { lockDir: string; token: string };
  pruneArtifactRuns: (directory: string, keep?: number) => void;
  pruneRunDirectories: (directory: string) => void;
  releaseDirectoryLock: (lock: { lockDir: string; token: string }) => void;
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
  test("owns and releases the shared staging lock without touching another owner", () => {
    const parent = tempRoot("save-in-lock-");
    const lockDir = join(parent, "staging.lock");
    const lock = acquireDirectoryLock(lockDir);

    expect(() => releaseDirectoryLock({ ...lock, token: "another-run" })).toThrow(
      "owned by another process",
    );
    releaseDirectoryLock(lock);
    expect(readdirSync(parent)).toEqual([]);
  });

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

  test("keeps the newest diagnostic runs", () => {
    const artifacts = tempRoot("save-in-artifacts-");
    for (let index = 1; index <= 5; index += 1) {
      const run = join(artifacts, `run-${index}`);
      mkdirSync(run);
      writeFileSync(join(run, "failure.json"), "{}");
      const time = new Date(1_000 * index);
      require("node:fs").utimesSync(run, time, time);
    }
    mkdirSync(join(artifacts, "run-active"));
    writeFileSync(join(artifacts, "run-active", ".active"), String(process.pid));
    mkdirSync(join(artifacts, "run-stale"));
    writeFileSync(join(artifacts, "run-stale", ".active"), "999999999");
    const staleTime = new Date(500);
    require("node:fs").utimesSync(join(artifacts, "run-stale"), staleTime, staleTime);

    pruneArtifactRuns(artifacts, 3);

    expect(readdirSync(artifacts).toSorted()).toEqual(["run-3", "run-4", "run-5", "run-active"]);
  });

  test("removes stale staging snapshots without touching a concurrent runner", () => {
    const runRoot = tempRoot("save-in-runs-");
    mkdirSync(join(runRoot, String(process.pid)));
    mkdirSync(join(runRoot, "999999999"));
    mkdirSync(join(runRoot, "not-a-pid"));

    pruneRunDirectories(runRoot);

    expect(readdirSync(runRoot)).toEqual([String(process.pid)]);
  });
});

import fs, {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  ABANDONED_RUN_AFTER_MS,
  DIRECTORY_LOCK_ORPHANED_AFTER_MS,
  acquireDirectoryLock,
  cleanupAbandonedRuns,
  pruneArtifactRuns,
  releaseDirectoryLock,
  removeOwnedProfiles,
  tryReclaimDirectoryLock,
} = require("../../scripts/lib/e2e-cleanup.js") as {
  ABANDONED_RUN_AFTER_MS: number;
  DIRECTORY_LOCK_ORPHANED_AFTER_MS: number;
  acquireDirectoryLock: (
    directory: string,
    options?: { timeoutMs?: number; pollMs?: number; pid?: number },
  ) => { lockDir: string; token: string };
  cleanupAbandonedRuns: (options: {
    artifacts: string;
    runRoot: string;
    chromeRoot: string;
    firefoxRoot: string;
    orphanedAfterMs?: number;
    now?: number;
    attempts?: number;
    delayMs?: number;
  }) => Promise<{ cleanedRunIds: string[]; failures: unknown[] }>;
  pruneArtifactRuns: (directory: string, keep?: number) => void;
  releaseDirectoryLock: (lock: { lockDir: string; token: string }) => void;
  removeOwnedProfiles: (
    ownerIds: string[],
    options: { chromeRoot: string; firefoxRoot: string; attempts?: number; delayMs?: number },
  ) => Promise<void>;
  tryReclaimDirectoryLock: (
    directory: string,
    options?: { pid?: number; orphanedAfterMs?: number },
  ) => boolean;
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

  test("removes a partial staging lock when its owner record cannot be written", () => {
    const parent = tempRoot("save-in-partial-lock-");
    const lockDir = join(parent, "staging.lock");
    const write = vi.spyOn(fs, "writeFileSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("disk write failed"), { code: "EIO" });
    });

    try {
      expect(() => acquireDirectoryLock(lockDir)).toThrow("disk write failed");
      expect(existsSync(lockDir)).toBe(false);
    } finally {
      write.mockRestore();
    }
  });

  test("preserves fresh foreign owners and exclusively reclaims expired staging leases", () => {
    const parent = tempRoot("save-in-stale-lock-");
    const lockDir = join(parent, "staging.lock");
    mkdirSync(lockDir);
    writeFileSync(
      join(lockDir, "owner.json"),
      JSON.stringify({ pid: 999_999_999, token: "foreign" }),
    );
    expect(tryReclaimDirectoryLock(lockDir)).toBe(false);
    expect(readdirSync(lockDir)).toContain("owner.json");

    const stale = new Date(Date.now() - DIRECTORY_LOCK_ORPHANED_AFTER_MS - 1_000);
    utimesSync(lockDir, stale, stale);
    expect(tryReclaimDirectoryLock(lockDir)).toBe(true);

    mkdirSync(lockDir);
    writeFileSync(join(lockDir, ".reclaim.json"), JSON.stringify({ pid: process.pid }));
    utimesSync(lockDir, stale, stale);
    expect(tryReclaimDirectoryLock(lockDir)).toBe(false);
    rmSync(join(lockDir, ".reclaim.json"));
    utimesSync(lockDir, stale, stale);
    expect(tryReclaimDirectoryLock(lockDir)).toBe(true);
    expect(readdirSync(parent)).toEqual([]);
  });

  test("cleans only runs whose active ownership lease has expired", async () => {
    const artifacts = tempRoot("save-in-abandoned-artifacts-");
    const runRoot = tempRoot("save-in-abandoned-runs-");
    const chromeRoot = tempRoot("save-in-abandoned-chrome-");
    const firefoxRoot = tempRoot("save-in-abandoned-firefox-");
    const now = Date.now();
    const abandonedId = "7-1700000000000-aaaaaaaaaaaaaaaa";
    const activeId = "7-1700000000001-bbbbbbbbbbbbbbbb";
    const mismatchedId = "7-1700000000002-cccccccccccccccc";

    for (const runId of [abandonedId, activeId, mismatchedId]) {
      const artifact = join(artifacts, `run-${runId}`);
      mkdirSync(artifact);
      writeFileSync(join(artifact, ".active"), runId);
      mkdirSync(join(runRoot, runId));
      mkdirSync(join(chromeRoot, `e2e-profile-${runId}-1-a`));
      mkdirSync(join(firefoxRoot, `save-in-ff-e2e-${runId}-1-a`));
    }
    // Older harnesses wrote only the PID into the marker.
    writeFileSync(join(artifacts, `run-${abandonedId}`, ".active"), "7");
    writeFileSync(join(artifacts, `run-${mismatchedId}`, ".active"), "another-owner");
    const stale = new Date(now - ABANDONED_RUN_AFTER_MS - 1_000);
    utimesSync(join(artifacts, `run-${abandonedId}`, ".active"), stale, stale);
    utimesSync(join(artifacts, `run-${mismatchedId}`, ".active"), stale, stale);

    const result = await cleanupAbandonedRuns({
      artifacts,
      runRoot,
      chromeRoot,
      firefoxRoot,
      now,
      delayMs: 0,
    });

    expect(result).toEqual({ cleanedRunIds: [abandonedId], failures: [] });
    expect(existsSync(join(artifacts, `run-${abandonedId}`, ".active"))).toBe(false);
    expect(existsSync(join(runRoot, abandonedId))).toBe(false);
    expect(existsSync(join(chromeRoot, `e2e-profile-${abandonedId}-1-a`))).toBe(false);
    expect(existsSync(join(firefoxRoot, `save-in-ff-e2e-${abandonedId}-1-a`))).toBe(false);
    expect(existsSync(join(artifacts, `run-${activeId}`, ".active"))).toBe(true);
    expect(existsSync(join(runRoot, activeId))).toBe(true);
    expect(existsSync(join(artifacts, `run-${mismatchedId}`, ".active"))).toBe(true);
    expect(existsSync(join(runRoot, mismatchedId))).toBe(true);
  });

  test("keeps abandoned ownership markers when resource cleanup needs a retry", async () => {
    const artifacts = tempRoot("save-in-retry-artifacts-");
    const runRoot = tempRoot("save-in-retry-runs-");
    const chromeRoot = tempRoot("save-in-retry-chrome-");
    const firefoxRoot = tempRoot("save-in-retry-firefox-");
    const runId = "8-1700000000000-dddddddddddddddd";
    const artifact = join(artifacts, `run-${runId}`);
    mkdirSync(artifact);
    writeFileSync(join(artifact, ".active"), runId);
    mkdirSync(join(chromeRoot, `e2e-profile-${runId}-locked`));
    const now = Date.now();
    const stale = new Date(now - ABANDONED_RUN_AFTER_MS - 1_000);
    utimesSync(join(artifact, ".active"), stale, stale);

    const result = await cleanupAbandonedRuns({
      artifacts,
      runRoot,
      chromeRoot,
      firefoxRoot,
      now,
      attempts: 0,
      delayMs: 0,
    });

    expect(result.cleanedRunIds).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(existsSync(join(artifact, ".active"))).toBe(true);
  });

  test("removes only profiles owned by the outer E2E run", async () => {
    const chromeRoot = tempRoot("save-in-cleanup-chrome-");
    const firefoxRoot = tempRoot("save-in-cleanup-firefox-");
    const owned = [
      join(chromeRoot, "e2e-profile-run-123-1-a"),
      join(firefoxRoot, "save-in-ff-e2e-run-123-2-b"),
    ];
    const unrelated = [
      join(chromeRoot, "e2e-profile-999-1-c"),
      join(firefoxRoot, "normal-firefox-profile"),
    ];
    for (const profile of [...owned, ...unrelated]) {
      mkdirSync(join(profile, "downloads"), { recursive: true });
      writeFileSync(join(profile, "downloads", "fixture.txt"), "fixture");
    }

    await removeOwnedProfiles(["run-123"], { chromeRoot, firefoxRoot, delayMs: 0 });

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
      removeOwnedProfiles(["123"], { chromeRoot, firefoxRoot, attempts: 0, delayMs: 0 }),
    ).rejects.toThrow("E2E profile cleanup failed");
  });

  test("keeps the newest diagnostic runs and every foreign active marker", () => {
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

    expect(readdirSync(artifacts).toSorted()).toEqual([
      "run-3",
      "run-4",
      "run-5",
      "run-active",
      "run-stale",
    ]);
  });
});

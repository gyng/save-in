// @ts-check

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawn } = require("child_process");
const {
  acquireDirectoryLock,
  pruneArtifactRuns,
  pruneRunDirectories,
  releaseDirectoryLock,
  removeOwnedProfiles,
} = require("./lib/e2e-cleanup");

const root = path.join(__dirname, "..");
const vitest = path.join(root, "node_modules", "vitest", "vitest.mjs");
const config = "config/vitest/e2e.mjs";
const artifacts = path.join(root, "dist", "e2e-artifacts");
const runRoot = path.join(root, "dist", "e2e-runs");
const runDir = path.join(runRoot, String(process.pid));
const stagedRun = path.join(runDir, "bundled-pkg");
const stagingLockDir = path.join(root, "dist", "e2e-staging.lock");
const runId = `${process.pid}-${Date.now()}`;
const runArtifacts = path.join(artifacts, `run-${runId}`);
const serial = process.argv.slice(2).includes("--serial");
/** @type {NodeJS.ProcessEnv} */
const e2eEnv = {
  ...process.env,
  E2E_ARTIFACT_DIR: path.relative(root, runArtifacts),
  E2E_RUN_ID: runId,
};
if (process.env.HEADED === "1" || process.env.HEADLESS === "0") {
  delete e2eEnv.HEADLESS;
} else {
  e2eEnv.HEADLESS = process.env.HEADLESS || "1";
}

// Keep diagnostics bounded without deleting a concurrently running suite's
// files. CI uploads this directory from its disposable workspace on failure.
fs.mkdirSync(runArtifacts, { recursive: true });
fs.writeFileSync(path.join(runArtifacts, ".active"), String(process.pid));
pruneArtifactRuns(artifacts);
pruneRunDirectories(runRoot);

const stagingLock = acquireDirectoryLock(stagingLockDir);
try {
  execFileSync(process.execPath, [path.join(__dirname, "build-bundled.js"), "--mode=e2e"], {
    cwd: root,
    env: e2eEnv,
    stdio: "inherit",
  });

  // Browsers load this immutable per-run copy; the lock serializes concurrent
  // E2E builds and snapshots while store/dev builds use separate directories.
  fs.mkdirSync(runDir, { recursive: true });
  fs.cpSync(path.join(root, "dist", "bundled-pkg-e2e"), stagedRun, { recursive: true });
} finally {
  releaseDirectoryLock(stagingLock);
}

const suites = ["test/e2e/chrome.e2e.mjs", "test/e2e/firefox.e2e.mjs"];
/** @type {import("node:child_process").ChildProcess[]} */
const children = [];
/** @param {string} suite */
const startSuite = (suite) => {
  const child = spawn(process.execPath, [vitest, "run", "--config", config, suite], {
    cwd: root,
    env: { ...e2eEnv, EXT_DIR: path.relative(root, stagedRun) },
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  // Attach completion handlers immediately. A fast startup failure can exit
  // before all suites have spawned; registering later would miss the event and
  // let Node exit with cleanup still pending.
  const done = new Promise((resolve) => {
    child.once("error", () => resolve(1));
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  return { child, done };
};

/** @type {NodeJS.Signals | undefined} */
let interruptedSignal;
/** @param {import("node:child_process").ChildProcess} child */
const terminate = (child) => {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(-child.pid, "SIGTERM");
    }
  } catch (error) {
    // The suite may have completed while interruption was being handled.
  }
};
/** @param {NodeJS.Signals} signal */
const stop = (signal) => {
  interruptedSignal ||= signal;
  children.forEach(terminate);
};
process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

const main = async () => {
  /** @type {number[]} */
  const codes = [];
  if (serial) {
    for (const suite of suites) {
      const run = startSuite(suite);
      children.push(run.child);
      const code = await run.done;
      codes.push(code);
      if (code !== 0) break;
    }
  } else {
    const runs = suites.map(startSuite);
    children.push(...runs.map(({ child }) => child));
    codes.push(...(await Promise.all(runs.map(({ done }) => done))));
  }
  children.forEach(terminate);
  /** @type {unknown[]} */
  const cleanupErrors = [];
  try {
    await removeOwnedProfiles([runId], {
      chromeRoot: path.join(root, "dist"),
      firefoxRoot: os.tmpdir(),
    });
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    fs.rmSync(runDir, { recursive: true, force: true });
  } catch (error) {
    cleanupErrors.push(error);
  }
  fs.rmSync(path.join(runArtifacts, ".active"), { force: true });
  if (fs.existsSync(runArtifacts) && fs.readdirSync(runArtifacts).length === 0) {
    fs.rmSync(runArtifacts, { recursive: true, force: true });
  }
  for (const error of cleanupErrors) console.error(error);
  process.exitCode = Boolean(interruptedSignal) || codes.some((code) => code !== 0) ? 1 : 0;
  if (cleanupErrors.length) process.exitCode = 1;
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

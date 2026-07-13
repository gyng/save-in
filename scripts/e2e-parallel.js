const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawn } = require("child_process");
const { pruneArtifactRuns, removeOwnedProfiles } = require("./lib/e2e-cleanup");

const root = path.join(__dirname, "..");
const vitest = path.join(root, "node_modules", "vitest", "vitest.mjs");
const config = "vitest.e2e.config.mjs";
const artifacts = path.join(root, "dist", "e2e-artifacts");
const runDir = path.join(root, "dist", "e2e-runs", String(process.pid));
const stagedRun = path.join(runDir, "bundled-pkg");
const runArtifacts = path.join(artifacts, `run-${Date.now()}-${process.pid}`);
const e2eEnv = {
  ...process.env,
  SAVE_IN_E2E: "1",
  E2E_ARTIFACT_DIR: path.relative(root, runArtifacts),
};

// Keep diagnostics bounded without deleting a concurrently running suite's
// files. CI uploads this directory from its disposable workspace on failure.
fs.mkdirSync(runArtifacts, { recursive: true });
pruneArtifactRuns(artifacts);

execFileSync(process.execPath, [path.join(__dirname, "build-bundled.js")], {
  cwd: root,
  env: e2eEnv,
  stdio: "inherit",
});

// A dev watcher or another build can rewrite dist/bundled-pkg. Browsers load
// this immutable per-run copy so the E2E-only bridge cannot disappear midway.
fs.mkdirSync(runDir, { recursive: true });
fs.cpSync(path.join(root, "dist", "bundled-pkg"), stagedRun, { recursive: true });

const suites = ["e2e/chrome.e2e.mjs", "e2e/firefox.e2e.mjs"];
const children = suites.map((suite) =>
  spawn(process.execPath, [vitest, "run", "--config", config, suite], {
    cwd: root,
    env: { ...e2eEnv, EXT_DIR: path.relative(root, stagedRun) },
    stdio: "inherit",
    detached: process.platform !== "win32",
  }),
);

let interruptedSignal;
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
const stop = (signal) => {
  interruptedSignal ||= signal;
  children.forEach(terminate);
};
process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

Promise.all(
  children.map(
    (child) =>
      new Promise((resolve) => {
        child.once("error", () => resolve(1));
        child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
      }),
  ),
).then(async (codes) => {
  const childPids = children.map((child) => child.pid).filter(Boolean);
  children.forEach(terminate);
  const cleanupErrors = [];
  try {
    await removeOwnedProfiles(childPids, {
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
  if (fs.existsSync(runArtifacts) && fs.readdirSync(runArtifacts).length === 0) {
    fs.rmSync(runArtifacts, { recursive: true, force: true });
  }
  for (const error of cleanupErrors) console.error(error);
  process.exitCode = Boolean(interruptedSignal) || codes.some((code) => code !== 0) ? 1 : 0;
  if (cleanupErrors.length) process.exitCode = 1;
});

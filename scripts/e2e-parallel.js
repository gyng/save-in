// @ts-check

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync, spawn } = require("node:child_process");
const {
  acquireDirectoryLock,
  cleanupAbandonedRuns,
  pruneArtifactRuns,
  releaseDirectoryLock,
  removeOwnedProfiles,
} = require("./lib/e2e-cleanup");
const { createE2ERunId } = require("./lib/e2e-run-id");
const { terminateProcessTree } = require("./lib/process-tree");

const root = path.join(__dirname, "..");
const vitest = path.join(root, "node_modules", "vitest", "vitest.mjs");
const config = "config/vitest/e2e.mjs";
const artifacts = path.join(root, "dist", "e2e-artifacts");
const runRoot = path.join(root, "dist", "e2e-runs");
const stagingLockDir = path.join(root, "dist", "e2e-staging.lock");

// PIDs and clocks can overlap across sandbox namespaces, so the nonce is part
// of every filesystem and browser-resource ownership boundary.
const runId = createE2ERunId();
const runDir = path.join(runRoot, runId);
const stagedRun = path.join(runDir, "bundled-pkg");
const runArtifacts = path.join(artifacts, `run-${runId}`);
const suiteByBrowser = {
  chrome: "test/e2e/chrome.e2e.mjs",
  firefox: "test/e2e/firefox.e2e.mjs",
};

/** @param {unknown} error */
const errorText = (error) =>
  error instanceof Error ? error.stack || error.message : String(error);

/**
 * @param {Record<string, unknown>} metadata
 * @param {{codes: number[], cleanupErrors: unknown[], interruptedSignal?: NodeJS.Signals, runError?: unknown, finishedAt?: Date}} outcome
 */
const finalizeRunMetadata = (
  metadata,
  { codes, cleanupErrors, interruptedSignal, runError, finishedAt = new Date() },
) => {
  const startedAtMs = Date.parse(String(metadata.startedAt));
  const failed =
    runError !== undefined || cleanupErrors.length > 0 || codes.some((code) => code !== 0);
  return {
    ...metadata,
    finishedAt: finishedAt.toISOString(),
    durationMs: Number.isFinite(startedAtMs) ? Math.max(0, finishedAt.getTime() - startedAtMs) : 0,
    status: interruptedSignal ? "interrupted" : failed ? "failed" : "passed",
    exitCodes: [...codes],
    ...(interruptedSignal ? { interruptedSignal } : {}),
    ...(runError !== undefined ? { failure: errorText(runError) } : {}),
    ...(cleanupErrors.length ? { cleanupErrors: cleanupErrors.map(errorText) } : {}),
  };
};

/** @param {string} directory */
const hashDirectory = (directory) => {
  const hash = crypto.createHash("sha256");
  /** @param {string} current */
  const visit = (current) => {
    for (const entry of fs
      .readdirSync(current, { withFileTypes: true })
      .toSorted((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(directory, absolute).replaceAll(path.sep, "/");
      hash.update(relative);
      hash.update("\0");
      if (entry.isDirectory()) visit(absolute);
      else hash.update(fs.readFileSync(absolute));
      hash.update("\0");
    }
  };
  visit(directory);
  return hash.digest("hex");
};

/** @param {string[]} argv */
const parseArguments = (argv) => {
  /** @type {"all" | "chrome" | "firefox"} */
  let browser = "all";
  let serial = false;
  let headed = false;
  /** @type {string[]} */
  const vitestArgs = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--serial") serial = true;
    else if (argument === "--headed") headed = true;
    else if (argument === "--browser") {
      const value = argv[++index];
      if (value !== "chrome" && value !== "firefox" && value !== "all") {
        throw new Error(`Unsupported E2E browser: ${value ?? "missing"}`);
      }
      browser = value;
    } else if (argument?.startsWith("--browser=")) {
      const value = argument.slice("--browser=".length);
      if (value !== "chrome" && value !== "firefox" && value !== "all") {
        throw new Error(`Unsupported E2E browser: ${value}`);
      }
      browser = value;
    } else if (argument === "--test-name") {
      const value = argv[++index];
      if (!value) throw new Error("--test-name requires a pattern");
      vitestArgs.push("-t", value);
    } else if (argument === "--") {
      vitestArgs.push(...argv.slice(index + 1));
      break;
    } else if (argument) vitestArgs.push(argument);
  }
  return { browser, serial, headed, vitestArgs };
};

/** @type {import("node:child_process").ChildProcess[]} */
const children = [];
/** @type {NodeJS.Signals | undefined} */
let interruptedSignal;

const terminateChildren = async () => {
  const results = await Promise.allSettled(
    children.map((child) =>
      terminateProcessTree(child, { detached: process.platform !== "win32" }),
    ),
  );
  const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (errors.length) throw new AggregateError(errors, "Unable to terminate E2E suite processes");
};

/** @param {NodeJS.Signals} signal */
const stop = (signal) => {
  interruptedSignal ||= signal;
  void terminateChildren().catch((error) => console.error(error));
};
process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

/**
 * @param {string} suite
 * @param {NodeJS.ProcessEnv} env
 * @param {string[]} vitestArgs
 */
const startSuite = (suite, env, vitestArgs) => {
  const child = spawn(process.execPath, [vitest, "run", "--config", config, suite, ...vitestArgs], {
    cwd: root,
    env,
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  children.push(child);
  const done = new Promise((resolve) => {
    child.once("error", () => resolve(1));
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  return { child, done };
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  const suites =
    options.browser === "all" ? Object.values(suiteByBrowser) : [suiteByBrowser[options.browser]];
  /** @type {NodeJS.ProcessEnv} */
  const e2eEnv = {
    ...process.env,
    E2E_ARTIFACT_DIR: path.relative(root, runArtifacts),
    E2E_RUN_ID: runId,
  };
  if (options.headed || process.env.HEADED === "1" || process.env.HEADLESS === "0") {
    delete e2eEnv.HEADLESS;
  } else {
    e2eEnv.HEADLESS = process.env.HEADLESS || "1";
  }

  /** @type {unknown[]} */
  const cleanupErrors = [];
  /** @type {number[]} */
  const codes = [];
  /** @type {unknown} */
  let runError;
  fs.mkdirSync(runArtifacts, { recursive: true });
  fs.writeFileSync(path.join(runArtifacts, ".active"), runId);
  /** @type {Record<string, unknown>} */
  let runMetadata = {
    runId,
    startedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    browsers: options.browser,
    headed: !e2eEnv.HEADLESS,
    suites,
    vitestArgs: options.vitestArgs,
    extensionSha256: "pending",
  };
  const writeRunMetadata = () =>
    fs.writeFileSync(path.join(runArtifacts, "run.json"), JSON.stringify(runMetadata, null, 2));
  writeRunMetadata();

  try {
    const abandonedCleanup = await cleanupAbandonedRuns({
      artifacts,
      runRoot,
      chromeRoot: path.join(root, "dist"),
      firefoxRoot: os.tmpdir(),
    });
    if (abandonedCleanup.cleanedRunIds.length) {
      runMetadata.recoveredRunIds = abandonedCleanup.cleanedRunIds;
    }
    if (abandonedCleanup.failures.length) {
      runMetadata.recoveryWarnings = abandonedCleanup.failures.map(errorText);
      for (const error of abandonedCleanup.failures) console.error(error);
    }
    writeRunMetadata();
    pruneArtifactRuns(artifacts);
    const stagingLock = acquireDirectoryLock(stagingLockDir);
    try {
      execFileSync(process.execPath, [path.join(__dirname, "build-bundled.js"), "--mode=e2e"], {
        cwd: root,
        env: e2eEnv,
        stdio: "inherit",
      });
      fs.mkdirSync(runDir, { recursive: true });
      fs.cpSync(path.join(root, "dist", "bundled-pkg-e2e"), stagedRun, { recursive: true });
      runMetadata.extensionSha256 = hashDirectory(stagedRun);
      writeRunMetadata();
    } finally {
      releaseDirectoryLock(stagingLock);
    }

    const childEnv = { ...e2eEnv, EXT_DIR: path.relative(root, stagedRun) };
    // A whole suite can fail before any test on a slow shared runner — a
    // Firefox event page that does not come up inside the launch budget throws
    // in beforeAll, which vitest's test-level retry cannot re-run. Retry the
    // suite process itself, which relaunches the browser from scratch. Default
    // 0 so local runs surface a flake immediately; CI opts in with E2E_RETRY.
    const suiteRetries = Math.max(0, Number.parseInt(process.env.E2E_RETRY || "0", 10) || 0);
    // A retry that quietly turns a run green hides the flake it should expose, so
    // record every one: a GitHub warning annotation surfaces it in the run
    // summary, and run.json (uploaded with the timings on every run) keeps a
    // durable record to trend and hunt down after release. A suite that flaked
    // even once is listed whether or not the retry recovered it.
    /** @type {{suite: string, attempts: number, recovered: boolean, firstExitCode: number}[]} */
    const retriedSuites = [];
    runMetadata.retriedSuites = retriedSuites;
    /** @param {string} suite */
    const runSuiteWithRetry = async (suite) => {
      const label = path.basename(suite);
      let code = Number(await startSuite(suite, childEnv, options.vitestArgs).done);
      const firstExitCode = code;
      let attempts = 0;
      for (let attempt = 1; code !== 0 && attempt <= suiteRetries; attempt += 1) {
        attempts = attempt;
        const detail = `E2E suite ${label} exited ${code}; retrying (${attempt}/${suiteRetries}) with a fresh launch`;
        console.error(detail);
        // GitHub renders ::warning:: in the job summary and annotations list.
        console.log(`::warning title=E2E flake retry (${label})::${detail}`);
        code = Number(await startSuite(suite, childEnv, options.vitestArgs).done);
      }
      if (attempts > 0) {
        retriedSuites.push({ suite: label, attempts, recovered: code === 0, firstExitCode });
        writeRunMetadata();
      }
      return code;
    };
    if (options.serial) {
      for (const suite of suites) {
        const code = await runSuiteWithRetry(suite);
        codes.push(code);
        if (code !== 0) break;
      }
    } else {
      codes.push(...(await Promise.all(suites.map((suite) => runSuiteWithRetry(suite)))));
    }
    // Signal a flake to the workflow so it preserves the failure diagnostics even
    // when the retry recovered — otherwise a green run drops the captures that
    // show what flaked, which is exactly what a post-release flake hunt needs.
    if (retriedSuites.length && process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, "flaked=true\n");
    }
  } catch (error) {
    runError = error;
  } finally {
    try {
      await terminateChildren();
    } catch (error) {
      cleanupErrors.push(error);
    }
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
    try {
      fs.rmSync(path.join(runArtifacts, ".active"), { force: true });
    } catch (error) {
      cleanupErrors.push(error);
    }
    runMetadata = finalizeRunMetadata(runMetadata, {
      codes,
      cleanupErrors,
      ...(interruptedSignal ? { interruptedSignal } : {}),
      ...(runError !== undefined ? { runError } : {}),
    });
    try {
      writeRunMetadata();
    } catch (error) {
      cleanupErrors.push(error);
    }
    // Successful runs retain compact metadata, environment facts, and timing
    // reports. The next run prunes older directories, while CI uploads the
    // reports for advisory trend comparison.
  }

  for (const error of cleanupErrors) console.error(error);
  if (runError !== undefined) throw runError;
  if (interruptedSignal || codes.some((code) => code !== 0) || cleanupErrors.length) {
    process.exitCode = 1;
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { finalizeRunMetadata, parseArguments };

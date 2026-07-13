// Launches an isolated Chrome instance with CDP enabled and the staged MV3
// build loaded. Branded Chrome >= 137 ignores --load-extension, so the
// extension is loaded via the CDP Extensions.loadUnpacked command instead
// (requires --enable-unsafe-extension-debugging).

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execFileSync } = require("child_process");

const cdp = require("./cdp");

const ROOT = path.join(__dirname, "..", "..");
const ARTIFACTS = process.env.E2E_ARTIFACT_DIR
  ? path.resolve(ROOT, process.env.E2E_ARTIFACT_DIR)
  : path.join(ROOT, "dist", "e2e-artifacts");
// EXT_DIR (repo-relative) overrides the bundled package used by the browser.
const DIST = process.env.EXT_DIR
  ? path.join(ROOT, process.env.EXT_DIR)
  : path.join(ROOT, "dist", "bundled-pkg");

/** @param {"production" | "e2e"} [mode] */
const buildOutputForMode = (mode = "production") =>
  path.join(ROOT, "dist", mode === "e2e" ? "bundled-pkg-e2e" : "bundled-pkg");

const findChrome = () => {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(os.homedir(), "AppData", "Local", "Google", "Chrome", "Application", "chrome.exe"),
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter((candidate) => typeof candidate === "string");

  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error("Chrome not found: set CHROME_PATH to your chrome executable");
  }
  return found;
};

/** @param {"production" | "e2e"} [mode] */
const stageBuild = (mode = "production") => {
  execFileSync(
    process.execPath,
    [path.join(ROOT, "scripts", "build-bundled.js"), `--mode=${mode}`],
    {
      stdio: "inherit",
    },
  );
  return buildOutputForMode(mode);
};

/** @param {import("node:child_process").ChildProcess | null | undefined} proc */
const killTree = (proc) => {
  if (!proc || !proc.pid) return Promise.resolve();
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
    } catch (e) {
      // Nested automation sandboxes can deny taskkill even for our child.
    }
    if (proc.exitCode === null) {
      try {
        proc.kill();
      } catch (e) {
        // already gone
      }
    }
    if (proc.exitCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      proc.once("exit", resolve);
      setTimeout(resolve, 3000).unref();
    });
  }
  return new Promise((resolve) => {
    proc.once("exit", resolve);
    try {
      proc.kill();
    } catch (e) {
      resolve(undefined);
    }
    setTimeout(resolve, 3000).unref();
  });
};

/** @param {string | undefined} profileDir */
const removeProfile = async (profileDir) => {
  if (!profileDir) return;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
      if (!fs.existsSync(profileDir)) return;
    } catch (error) {
      // Chrome children can briefly retain cache files after taskkill returns.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Unable to remove disposable Chrome profile: ${profileDir}`);
};

/** @param {string} baseProfileDir @param {string | undefined} downloadDir @param {boolean} [unique] */
const makeProfile = (baseProfileDir, downloadDir, unique = false) => {
  let profileDir = unique
    ? `${baseProfileDir}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
    : baseProfileDir;
  try {
    // force:true only suppresses ENOENT, not EPERM/EBUSY from a Chrome that
    // hasn't fully exited: fall back to a fresh dir rather than crash
    fs.rmSync(profileDir, { recursive: true, force: true });
  } catch (e) {
    profileDir = `${baseProfileDir}-${Date.now()}`;
  }
  const downloads = downloadDir || path.join(profileDir, "downloads");
  fs.mkdirSync(path.join(profileDir, "Default"), { recursive: true });
  fs.mkdirSync(downloads, { recursive: true });
  fs.writeFileSync(
    path.join(profileDir, "Default", "Preferences"),
    JSON.stringify({
      download: {
        default_directory: downloads,
        prompt_for_download: false,
      },
    }),
  );
  return { profileDir, downloadDir: downloads };
};

/** @param {string} profileDir @param {number} port @param {boolean} [headless] @param {boolean} [noSandbox] */
const chromeArgs = (profileDir, port, headless = false, noSandbox = false) => {
  const args = [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${port}`,
    "--enable-unsafe-extension-debugging",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    // Disposable E2E profiles do not need GPU acceleration. Avoid persistent
    // GPU cache locks crashing a subsequent isolated Chrome before CDP opens.
    "--disable-gpu",
  ];
  // An outer automation sandbox can deny Chrome's own Windows sandbox token,
  // crashing the GPU helper with 0xC0000022. Keep normal local/CI runs
  // sandboxed; CODEX_SHELL or the explicit override opts into nesting support.
  if (noSandbox) args.push("--no-sandbox");
  if (headless) args.push("--headless=new");
  args.push("about:blank");
  return args;
};

/** @param {string} logPath @param {number} [maxBytes] */
const logTail = (logPath, maxBytes = 12000) => {
  try {
    const size = fs.statSync(logPath).size;
    const fd = fs.openSync(logPath, "r");
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    fs.closeSync(fd);
    return buffer.toString("utf8").trim();
  } catch (error) {
    return `Unable to read Chrome log: ${error instanceof Error ? error.message : String(error)}`;
  }
};

/** @param {unknown} error @param {import("node:child_process").ChildProcess} proc @param {string} logPath */
const startupError = (error, proc, logPath) => {
  const cause = error instanceof Error ? error : new Error(String(error));
  const exit = proc.exitCode === null ? "still running" : `exit code ${proc.exitCode}`;
  const tail = logTail(logPath);
  return new Error(
    `${cause.message}\nChrome process: ${exit}\nChrome log: ${logPath}${tail ? `\n--- log tail ---\n${tail}` : ""}`,
    { cause },
  );
};

/** @param {{port?: number, profileDir: string, downloadDir?: string, extensionDir?: string, fresh?: boolean}} settings */
const launch = async ({
  port: requestedPort = undefined,
  profileDir,
  downloadDir = undefined,
  extensionDir = DIST,
  fresh = true,
}) => {
  let resolvedProfile = profileDir;
  let resolvedDownloads = downloadDir;
  if (fresh || !fs.existsSync(profileDir)) {
    ({ profileDir: resolvedProfile, downloadDir: resolvedDownloads } = makeProfile(
      profileDir,
      downloadDir,
      fresh,
    ));
  }

  // Random port so a stale instance from an aborted run can't be mistaken
  // for the one we just launched
  const port = requestedPort || 9400 + Math.floor(Math.random() * 400);

  const chromePath = findChrome();
  const args = chromeArgs(
    resolvedProfile,
    port,
    Boolean(process.env.HEADLESS),
    Boolean(process.env.CODEX_SHELL || process.env.CHROME_E2E_NO_SANDBOX),
  );
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const logPath = path.join(ARTIFACTS, `chrome-${port}.log`);
  const log = fs.openSync(logPath, "w");
  const proc = spawn(chromePath, args, { stdio: ["ignore", log, log], detached: false });
  fs.closeSync(log);
  try {
    await cdp.waitForCdp(port);
    const extensionId = await cdp.loadUnpacked(port, extensionDir);
    // Loading an invalid package can make Chrome terminate just after the CDP
    // command succeeds. Verify the endpoint remains usable before handing the
    // process to a suite, so startup errors include the browser log.
    await cdp.listTargets(port);
    return {
      proc,
      extensionId,
      port,
      profileDir: resolvedProfile,
      downloadDir: resolvedDownloads,
      logPath,
    };
  } catch (error) {
    // beforeAll cannot clean up a session that launch() never returned.
    // Make startup failure atomic so retries don't accumulate browser trees
    // and eventually fail for unrelated resource/port reasons.
    await killTree(proc);
    const failure = startupError(error, proc, logPath);
    try {
      await removeProfile(resolvedProfile);
    } catch (cleanupError) {
      // eslint-disable-next-line preserve-caught-error -- AggregateError includes both failures and explicitly preserves the launch cause.
      throw new AggregateError([failure, cleanupError], "Chrome launch and cleanup failed", {
        cause: error,
      });
    }
    throw failure;
  }
};

module.exports = {
  ROOT,
  DIST,
  buildOutputForMode,
  findChrome,
  stageBuild,
  chromeArgs,
  launch,
  killTree,
  removeProfile,
  logTail,
};

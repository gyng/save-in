// @ts-check

// Launches an isolated Chrome instance with CDP enabled and the staged MV3
// build loaded. Branded Chrome >= 137 ignores --load-extension, so the
// extension is loaded via the CDP Extensions.loadUnpacked command instead
// (requires --enable-unsafe-extension-debugging).

const fs = require("fs");
const path = require("path");
const os = require("os");
const { once } = require("events");
const { spawn, execFileSync } = require("child_process");

const cdp = require("./cdp");
const { CHROME_E2E_PORT_COUNT, CHROME_E2E_PORT_START, findAvailablePort } = require("./debug-port");
const { currentE2ERunId } = require("./e2e-run-id");

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
  const pathChrome = findChromeOnPath();
  const candidates = [
    process.env.CHROME_PATH,
    pathChrome,
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

/** @param {string | undefined} [pathValue] @param {NodeJS.Platform} [platform] */
function findChromeOnPath(pathValue = process.env.PATH, platform = process.platform) {
  if (!pathValue) return undefined;
  const names =
    platform === "win32"
      ? ["google-chrome.exe", "chrome.exe", "chromium.exe"]
      : ["google-chrome", "chromium", "chromium-browser"];
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue;
    for (const name of names) {
      const candidate = path.join(directory, name);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        continue;
      }
    }
  }
  return undefined;
}

/** @param {string} version */
const parseChromeMajorVersion = (version) => {
  const match = version.match(/(?:Chrome|Chromium)(?: for Testing)?\s+(\d+)\./i);
  if (!match?.[1]) throw new Error(`Unable to determine Chrome version from: ${version.trim()}`);
  return Number(match[1]);
};

/** @param {string} chromePath */
const getChromeMajorVersion = (chromePath) =>
  parseChromeMajorVersion(execFileSync(chromePath, ["--version"], { encoding: "utf8" }));

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
const killTree = async (proc) => {
  if (!proc?.pid || proc.exitCode !== null || proc.signalCode !== null) return;
  const exited = once(proc, "exit", { signal: AbortSignal.timeout(10000) });
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
  } else {
    try {
      proc.kill();
    } catch (e) {
      // already gone; the child still emits exit when its status is collected
    }
  }
  await exited;
};

/** @param {string | undefined} profileDir */
const removeProfile = async (profileDir) => {
  if (!profileDir) return;
  const deadline = Date.now() + 10000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
    if (!fs.existsSync(profileDir)) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`Unable to remove disposable Chrome profile: ${profileDir}`, {
    cause: lastError,
  });
};

/** @param {string} baseProfileDir @param {string | undefined} downloadDir @param {boolean} [unique] */
const makeProfile = (baseProfileDir, downloadDir, unique = false) => {
  const owner = currentE2ERunId();
  let profileDir = unique
    ? `${baseProfileDir}-${owner}-${Date.now()}-${Math.random().toString(16).slice(2)}`
    : baseProfileDir;
  try {
    // force:true only suppresses ENOENT, not EPERM/EBUSY from a Chrome that
    // hasn't fully exited: fall back to a fresh dir rather than crash
    fs.rmSync(profileDir, { recursive: true, force: true });
  } catch (e) {
    profileDir = `${baseProfileDir}-${owner}-${Date.now()}`;
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

/** @param {string} profileDir @param {number} port @param {boolean} [headless] @param {boolean} [noSandbox] @param {string} [legacyExtensionDir] */
const chromeArgs = (
  profileDir,
  port,
  headless = false,
  noSandbox = false,
  legacyExtensionDir = undefined,
) => {
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
  if (legacyExtensionDir) args.push(`--load-extension=${legacyExtensionDir}`);
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

  const port =
    requestedPort ?? (await findAvailablePort(CHROME_E2E_PORT_START, CHROME_E2E_PORT_COUNT));

  const chromePath = findChrome();
  const chromeMajorVersion = getChromeMajorVersion(chromePath);
  const legacyExtensionDir = chromeMajorVersion < 137 ? extensionDir : undefined;
  const args = chromeArgs(
    resolvedProfile,
    port,
    Boolean(process.env.HEADLESS),
    Boolean(process.env.CODEX_SHELL || process.env.CHROME_E2E_NO_SANDBOX),
    legacyExtensionDir,
  );
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const logPath = path.join(ARTIFACTS, `chrome-${port}.log`);
  const log = fs.openSync(logPath, "w");
  const proc = spawn(chromePath, args, { stdio: ["ignore", log, log], detached: false });
  fs.closeSync(log);
  try {
    await cdp.waitForCdp(port);
    const extensionId =
      chromeMajorVersion < 137
        ? await cdp.waitForExtensionId(port)
        : await cdp.loadUnpacked(port, extensionDir);
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
  findChromeOnPath,
  getChromeMajorVersion,
  parseChromeMajorVersion,
  stageBuild,
  chromeArgs,
  launch,
  killTree,
  removeProfile,
  logTail,
};

// @ts-check

// Launches an isolated Firefox with a throwaway profile, installs the
// extension temporarily over RDP (the about:debugging mechanism), and hands
// back an evaluate() bound to the extension's background console.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { once } = require("events");
const { spawn, execFileSync } = require("child_process");

const { FirefoxRdp } = require("./firefox-rdp");
const {
  FIREFOX_E2E_PORT_COUNT,
  FIREFOX_E2E_PORT_START,
  findAvailablePort,
} = require("./debug-port");
const { currentE2ERunId } = require("./e2e-run-id");

// EXT_DIR (repo-relative) overrides the loaded package, e.g. to run the e2e
// against the bundled build (dist/bundled-pkg) instead of the repo root.
const REPO = path.join(__dirname, "..", "..");
const ARTIFACTS = process.env.E2E_ARTIFACT_DIR
  ? path.resolve(REPO, process.env.E2E_ARTIFACT_DIR)
  : path.join(REPO, "dist", "e2e-artifacts");
const ROOT = process.env.EXT_DIR ? path.join(REPO, process.env.EXT_DIR) : REPO;
const ADDON_ID = "{72d92df5-2aa0-4b06-b807-aa21767545cd}"; // manifest.json gecko id

/**
 * @template T
 * @param {() => Promise<T>} operation
 * @param {number} timeoutMs
 * @param {string} message
 * @returns {Promise<T>}
 */
const retryUntil = async (operation, timeoutMs, message) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await operation();
    } catch (error) {
      if (Date.now() >= deadline) throw new Error(message, { cause: error });
      // Failed socket/protocol operations already yield to the event loop. An
      // immediate turn lets Firefox publish the observable state we retry.
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
};

/** @param {string | undefined} [pathValue] @param {NodeJS.Platform} [platform] */
const findFirefoxOnPath = (pathValue = process.env.PATH, platform = process.platform) => {
  if (!pathValue) return undefined;
  const names = platform === "win32" ? ["firefox.exe", "firefox"] : ["firefox"];
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
};

const findFirefox = () => {
  const candidates = [
    process.env.FIREFOX_PATH,
    findFirefoxOnPath(),
    "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
    "C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe",
    "/usr/bin/firefox",
    "/Applications/Firefox.app/Contents/MacOS/firefox",
  ].filter((candidate) => typeof candidate === "string");
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error("Firefox not found: set FIREFOX_PATH to your firefox executable");
  }
  return found;
};

/** @param {number | undefined} pid */
const killTree = (pid) => {
  if (pid === undefined) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    } catch (e) {
      // already gone
    }
  } else {
    try {
      process.kill(pid);
    } catch (e) {
      // already gone
    }
  }
};

/** @param {string} profileDir */
const killProfileProcesses = (profileDir) => {
  if (process.platform !== "win32") return;
  const escaped = profileDir.replace(/'/g, "''");
  const script = `$profile = '${escaped}'; Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'firefox.exe' -and $_.CommandLine -like ('*' + $profile + '*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  try {
    execFileSync(
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { stdio: "ignore" },
    );
  } catch (error) {
    // The browser may already have exited between discovery and termination.
  }
};

/**
 * @param {import("node:child_process").ChildProcess} proc
 * @param {string} profileDir
 */
const stopFirefox = async (proc, profileDir) => {
  const running = proc.exitCode === null && proc.signalCode === null;
  const exited = running
    ? once(proc, "exit", { signal: AbortSignal.timeout(10000) })
    : Promise.resolve();
  killTree(proc.pid);
  killProfileProcesses(profileDir);
  await exited;
};

/** @param {string} baseProfileDir */
const makeProfile = (baseProfileDir) => {
  const owner = currentE2ERunId();
  let profileDir = `${baseProfileDir}-${owner}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
  try {
    fs.rmSync(profileDir, { recursive: true, force: true });
  } catch (e) {
    // A previous run's Firefox still holds the directory: use a fresh one
    profileDir = `${baseProfileDir}-${owner}-${Date.now()}`;
  }
  const downloadDir = path.join(profileDir, "downloads");
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(downloadDir, { recursive: true });

  const prefs = {
    "devtools.debugger.remote-enabled": true,
    "devtools.debugger.prompt-connection": false,
    "devtools.chrome.enabled": true,
    "browser.shell.checkDefaultBrowser": false,
    "browser.aboutwelcome.enabled": false,
    "browser.startup.homepage_override.mstone": "ignore",
    "datareporting.policy.dataSubmissionEnabled": false,
    "toolkit.telemetry.reportingpolicy.firstRun": false,
    "browser.download.folderList": 2,
    "browser.download.dir": downloadDir,
    "browser.download.useDownloadDir": true,
    "extensions.experiments.enabled": true,
  };

  const userJs = Object.entries(prefs)
    .map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
    .join("\n");
  fs.writeFileSync(path.join(profileDir, "user.js"), userJs);

  return { profileDir, downloadDir };
};

/** @param {string} profileDir */
const removeProfile = async (profileDir) => {
  fs.rmSync(profileDir, { recursive: true, force: true });
  if (fs.existsSync(profileDir)) {
    throw new Error(`Unable to remove disposable Firefox profile: ${profileDir}`);
  }
};

/** @param {number} port */
const connectWithRetry = (port) =>
  retryUntil(() => FirefoxRdp.connect(port), 30000, `Firefox did not open RDP port ${port}`);

/** @param {{extensionDir?: string}} [settings] */
const launch = async ({ extensionDir = ROOT } = {}) => {
  const { profileDir, downloadDir } = makeProfile(path.join(os.tmpdir(), "save-in-ff-e2e"));

  const port = await findAvailablePort(FIREFOX_E2E_PORT_START, FIREFOX_E2E_PORT_COUNT);

  const args = ["-profile", profileDir, "-no-remote", "-start-debugger-server", String(port)];
  if (process.env.HEADLESS) {
    args.push("-headless");
  }
  args.push("about:blank");

  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const logPath = path.join(ARTIFACTS, `firefox-${port}.log`);
  const log = fs.openSync(logPath, "w");
  const proc = spawn(findFirefox(), args, { stdio: ["ignore", log, log] });
  fs.closeSync(log);
  /** @type {InstanceType<typeof FirefoxRdp> | undefined} */
  let rdp;
  try {
    rdp = await connectWithRetry(port);
    let connectedRdp = rdp;
    const root = await connectedRdp.getRoot();
    await connectedRdp.installTemporaryAddon(root.addonsActor, extensionDir);
    const addonActor = await retryUntil(
      () => connectedRdp.findAddonActor(ADDON_ID),
      10000,
      "Firefox did not expose the temporary add-on",
    );
    let consoleActor = await connectedRdp.getConsoleActor(addonActor);

    const openOptionsAndWaitForReady = async () => {
      await connectedRdp.evaluate(
        consoleActor,
        `(async () => {
          const url = browser.runtime.getURL("src/options/options.html");
          const existing = (await browser.tabs.query({})).find((tab) => tab.url === url);
          if (existing?.id) await browser.tabs.reload(existing.id);
          else await browser.tabs.create({ url });
          return true;
        })()`,
      );

      // Send the readiness probe from an extension page. A background context's
      // runtime.sendMessage does not loop back to its own onMessage listener.
      let lastProbe = "options target was not attachable";
      await retryUntil(
        async () => {
          const tabConsole = await connectedRdp.getTabConsoleActor("src/options/options.html");
          lastProbe = await connectedRdp.evaluate(
            tabConsole,
            `browser.runtime.sendMessage({ type: "WAKE_WARM" })
              .then((response) => JSON.stringify({ response }))
              .catch((error) => JSON.stringify({ error: String(error) }))`,
          );
          const probe = JSON.parse(lastProbe);
          if (probe?.response?.type === "OK") return;
          throw new Error(`background readiness probe returned ${lastProbe}`);
        },
        10000,
        "background page never became ready",
      );
    };

    await openOptionsAndWaitForReady();

    /** @param {string} text @param {number} [timeoutMs] */
    const evaluate = (text, timeoutMs) => connectedRdp.evaluate(consoleActor, text, timeoutMs);

    // Evaluates in the content window of an open tab matching urlSubstr. The
    // tab must already be open (e.g. via browser.tabs.create from evaluate()).
    /** @param {string} urlSubstr @param {string} text @param {number} [timeoutMs] */
    const evaluateInTab = async (urlSubstr, text, timeoutMs) => {
      const tabConsole = await connectedRdp.getTabConsoleActor(urlSubstr);
      try {
        return await connectedRdp.evaluate(tabConsole, text, timeoutMs);
      } catch (error) {
        // Firefox replaces a tab's console actor when location.reload() swaps
        // documents while retaining the same tab actor. Reconnect so a fresh
        // watcher reports the replacement target instead of its stale cache.
        if (!String(error).includes("noSuchActor")) throw error;
        connectedRdp.close();
        connectedRdp = await connectWithRetry(port);
        const refreshedAddon = await connectedRdp.findAddonActor(ADDON_ID);
        consoleActor = await connectedRdp.getConsoleActor(refreshedAddon);
        const refreshedConsole = await connectedRdp.getTabConsoleActor(urlSubstr);
        return connectedRdp.evaluate(refreshedConsole, text, timeoutMs);
      }
    };

    const reloadAddon = async () => {
      await connectedRdp.reloadAddon(ADDON_ID);
      connectedRdp.close();
      connectedRdp = await connectWithRetry(port);
      await retryUntil(
        async () => {
          const candidateAddonActor = await connectedRdp.findAddonActor(ADDON_ID);
          const candidateConsoleActor = await connectedRdp.getConsoleActor(candidateAddonActor);
          consoleActor = candidateConsoleActor;
          await openOptionsAndWaitForReady();
        },
        10000,
        "Firefox add-on reload did not expose a fresh background page",
      );
    };

    const cleanup = async () => {
      connectedRdp.close();
      await stopFirefox(proc, profileDir);
      await removeProfile(profileDir);
    };

    return {
      proc,
      get rdp() {
        return connectedRdp;
      },
      evaluate,
      evaluateInTab,
      reloadAddon,
      profileDir,
      downloadDir,
      logPath,
      cleanup,
    };
  } catch (error) {
    rdp?.close();
    let cleanupError;
    try {
      await stopFirefox(proc, profileDir);
      await removeProfile(profileDir);
    } catch (failure) {
      cleanupError = failure;
    }
    let tail = "";
    try {
      tail = fs.readFileSync(logPath, "utf8").slice(-12000).trim();
    } catch (readError) {
      tail = `Unable to read Firefox log: ${readError instanceof Error ? readError.message : String(readError)}`;
    }
    const cause = error instanceof Error ? error : new Error(String(error));
    const launchError = new Error(
      `${cause.message}\nFirefox process: ${proc.exitCode === null ? "still running" : `exit code ${proc.exitCode}`}\nFirefox log: ${logPath}${tail ? `\n--- log tail ---\n${tail}` : ""}`,
      { cause },
    );
    if (cleanupError) {
      // eslint-disable-next-line preserve-caught-error -- AggregateError includes both failures and explicitly preserves the launch cause.
      throw new AggregateError([launchError, cleanupError], "Firefox launch and cleanup failed", {
        cause,
      });
    }
    throw launchError;
  }
};

module.exports = { ROOT, findFirefox, findFirefoxOnPath, launch, makeProfile, removeProfile };

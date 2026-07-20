// @ts-check

// Launches an isolated Firefox with a throwaway profile, installs the
// extension temporarily over RDP (the about:debugging mechanism), and hands
// back an evaluate() bound to the extension's background console.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execFileSync } = require("child_process");

const { FirefoxRdp } = require("./firefox-rdp");
const { FirefoxBidi } = require("./firefox-bidi");
const {
  FIREFOX_BIDI_PORT_COUNT,
  FIREFOX_BIDI_PORT_START,
  FIREFOX_E2E_PORT_COUNT,
  FIREFOX_E2E_PORT_START,
  reserveAvailablePort,
} = require("./debug-port");
const { currentE2ERunId } = require("./e2e-run-id");
const { terminateProcessTree } = require("./process-tree");

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
      await new Promise((resolve) => setTimeout(resolve, 25));
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

/** @param {string} firefoxPath */
const getFirefoxVersion = (firefoxPath) =>
  execFileSync(firefoxPath, ["--version"], { encoding: "utf8" }).trim();

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
  await terminateProcessTree(proc, { detached: process.platform !== "win32" });
  killProfileProcesses(profileDir);
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
  // Temporary add-ons otherwise depend on a developer profile's hidden
  // private-browsing grant. Seed Firefox's legacy import boundary before the
  // permission store starts so the disposable profile can exercise PB paths.
  fs.writeFileSync(
    path.join(profileDir, "extension-preferences.json"),
    JSON.stringify({
      [ADDON_ID]: {
        permissions: ["internal:privateBrowsingAllowed"],
        origins: [],
        data_collection: [],
      },
    }),
  );

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
  const firefoxPath = findFirefox();
  const firefoxVersion = getFirefoxVersion(firefoxPath);

  const portLease = await reserveAvailablePort(FIREFOX_E2E_PORT_START, FIREFOX_E2E_PORT_COUNT);
  let bidiLease;
  try {
    bidiLease = await reserveAvailablePort(FIREFOX_BIDI_PORT_START, FIREFOX_BIDI_PORT_COUNT);
  } catch (error) {
    portLease.release();
    throw error;
  }
  const port = portLease.port;
  const bidiPort = bidiLease.port;

  const args = [
    "-profile",
    profileDir,
    "-no-remote",
    "-start-debugger-server",
    String(port),
    "--remote-debugging-port",
    String(bidiPort),
  ];
  if (process.env.HEADLESS) {
    args.push("-headless");
  }
  args.push("about:blank");

  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const logPath = path.join(ARTIFACTS, `firefox-${port}.log`);
  const log = fs.openSync(logPath, "w");
  const proc = spawn(firefoxPath, args, {
    stdio: ["ignore", log, log],
    detached: process.platform !== "win32",
  });
  fs.closeSync(log);
  /** @type {InstanceType<typeof FirefoxRdp> | undefined} */
  let rdp;
  /** @type {InstanceType<typeof FirefoxBidi> | undefined} */
  let bidi;
  /** @type {{callFunction: (functionDeclaration: string, args?: unknown[], timeoutMs?: number) => Promise<unknown>} | undefined} */
  let backgroundControlRealm;
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

    // Evaluates in the content window of an open tab matching urlSubstr. The
    // tab must already be open (e.g. via browser.tabs.create from evaluate()).
    /** @param {string} urlSubstr @param {string} text @param {number} [timeoutMs] */
    const evaluateInTab = async (urlSubstr, text, timeoutMs) => {
      const tabConsole = await connectedRdp.getTabConsoleActor(urlSubstr);
      try {
        return await connectedRdp.evaluate(tabConsole, text, timeoutMs);
      } catch (error) {
        // A reload keeps the same tab actor but gives it a new console actor, so
        // getTabConsoleActor can hand back a cached one that is stale. Firefox
        // sometimes reports that as noSuchActor, but on a slow runner the stale
        // actor instead accepts the request and never answers, surfacing as an
        // RDP timeout. Treat both as "refresh the actor and retry".
        if (!/noSuchActor|RDP (?:event )?timeout|Evaluation cancelled/.test(String(error))) {
          throw error;
        }
        let switchedConsole;
        try {
          switchedConsole = await connectedRdp.refreshTabConsoleActor(urlSubstr, tabConsole);
        } catch {
          // Firefox 121-128 does not expose target-switch watcher events.
          // Retain the full reconnect as the compatibility fallback.
        }
        if (switchedConsole) {
          return connectedRdp.evaluate(switchedConsole, text, timeoutMs);
        }
        connectedRdp.close();
        connectedRdp = await connectWithRetry(port);
        const refreshedAddon = await connectedRdp.findAddonActor(ADDON_ID);
        consoleActor = await connectedRdp.getConsoleActor(refreshedAddon);
        const refreshedConsole = await connectedRdp.getTabConsoleActor(urlSubstr);
        return connectedRdp.evaluate(refreshedConsole, text, timeoutMs);
      }
    };

    /** @param {string} resource @param {string | null} [previousInstance] */
    const waitForBackgroundReady = async (resource, previousInstance) => {
      // Send the readiness probe from an extension page. A background context's
      // runtime.sendMessage does not loop back to its own onMessage listener.
      let lastProbe = "options target was not attachable";
      // One probe is worth far less than the budget for all of them: an event
      // page that has not finished starting answers nothing, and waiting out a
      // full RDP timeout for that silence spends the whole budget on a single
      // question. evaluate's own default is longer than the budget below, which
      // made this a retry that could never reach its second attempt -- the first
      // one returned past the deadline and retryUntil, which only checks the
      // deadline after an attempt, gave up. That is why a slow runner failed
      // here at ~30s against a 10s budget.
      const PROBE_TIMEOUT_MS = 2000;
      /** @type {string | undefined} */
      let readyInstance;
      await retryUntil(
        async () => {
          const probe = `browser.runtime.sendMessage({ type: ${JSON.stringify(
            previousInstance === undefined ? "WAKE_WARM" : "SAVE_IN_E2E_INSPECT",
          )} })
              .then((response) => JSON.stringify({ response }))
              .catch((error) => JSON.stringify({ error: String(error) }))`;
          lastProbe = await evaluateInTab(resource, probe, PROBE_TIMEOUT_MS);
          const result = JSON.parse(lastProbe);
          if (previousInstance === undefined && result?.response?.type === "OK") return;
          const body = result?.response?.body;
          const state = body?.state;
          if (
            result?.response?.type === "SAVE_IN_E2E_INSPECT" &&
            body?.status === "OK" &&
            typeof state?.instanceId === "string" &&
            state.generation === state.readyGeneration &&
            (previousInstance === null || state.instanceId !== previousInstance)
          ) {
            readyInstance = state.instanceId;
            return;
          }
          throw new Error(`background readiness probe returned ${lastProbe}`);
        },
        30000,
        "background page never became ready",
      );
      return readyInstance;
    };

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
      await waitForBackgroundReady("src/options/options.html");
    };

    await openOptionsAndWaitForReady();
    bidi = await FirefoxBidi.connect(bidiPort);
    backgroundControlRealm = bidi.createPersistentRealm("test/e2e/control.html");
    portLease.release();
    bidiLease.release();
    process.stdout.write(
      `Firefox E2E: ${firefoxVersion} (${firefoxPath}), RDP ${port}, BiDi ${bidiPort}\n`,
    );
    fs.writeFileSync(
      path.join(ARTIFACTS, "firefox-environment.json"),
      JSON.stringify(
        {
          browser: "firefox",
          version: firefoxVersion,
          executable: firefoxPath,
          rdpPort: port,
          bidiPort,
        },
        null,
        2,
      ),
    );

    /** @param {string} text @param {number} [timeoutMs] */
    const evaluate = (text, timeoutMs) => connectedRdp.evaluate(consoleActor, text, timeoutMs);

    /** @param {string} resource @param {{active?: boolean, reload?: boolean}} [options] */
    const ensureExtensionPage = (resource, options = {}) =>
      connectedRdp.evaluate(
        consoleActor,
        `(async () => {
          const url = browser.runtime.getURL(${JSON.stringify(resource)});
          const existing = (await browser.tabs.query({})).find((tab) => tab.url === url);
          if (existing?.id && ${JSON.stringify(options.reload === true)}) {
            await browser.tabs.reload(existing.id);
          } else if (!existing) {
            await browser.tabs.create({
              url,
              active: ${JSON.stringify(options.active === true)},
            });
          }
          return true;
        })()`,
      );

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

    const reloadBackgroundPage = async () => {
      if (!backgroundControlRealm) throw new Error("Firefox control realm was not initialized");
      const previousInstance = await waitForBackgroundReady("test/e2e/control.html", null);
      if (!previousInstance) throw new Error("Firefox background instance is unavailable");
      await backgroundControlRealm.callFunction(
        `async function () {
          const background = await browser.runtime.getBackgroundPage();
          if (!background) throw new Error("Firefox background page is unavailable");
          background.location.reload();
          return "reload requested";
        }`,
      );
      await waitForBackgroundReady("test/e2e/control.html", previousInstance);
      await reloadExtensionPage("src/options/options.html");
    };

    /** @param {string} resource */
    const reloadExtensionPage = async (resource) => {
      if (!backgroundControlRealm) throw new Error("Firefox control realm was not initialized");
      const staleConsole = await connectedRdp.getTabConsoleActor(resource).catch(() => undefined);
      await backgroundControlRealm.callFunction(
        `async function (serializedResource) {
          const resource = JSON.parse(serializedResource);
          const url = browser.runtime.getURL(resource);
          const existing = (await browser.tabs.query({})).find((tab) => tab.url === url);
          if (existing?.id) await browser.tabs.reload(existing.id);
          else await browser.tabs.create({ url });
          return "extension page refreshed";
        }`,
        [resource],
      );
      if (staleConsole) {
        try {
          await connectedRdp.refreshTabConsoleActor(resource, staleConsole);
        } catch {
          connectedRdp.close();
          connectedRdp = await connectWithRetry(port);
          const refreshedAddon = await connectedRdp.findAddonActor(ADDON_ID);
          consoleActor = await connectedRdp.getConsoleActor(refreshedAddon);
          await connectedRdp.getTabConsoleActor(resource);
        }
      }
      await waitForBackgroundReady(resource);
    };

    const cleanup = async () => {
      bidi?.close();
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
      reloadExtensionPage,
      ensureExtensionPage,
      reloadAddon,
      reloadBackgroundPage,
      bidi,
      bidiPort,
      profileDir,
      downloadDir,
      logPath,
      browserPath: firefoxPath,
      browserVersion: firefoxVersion,
      cleanup,
    };
  } catch (error) {
    portLease.release();
    bidiLease.release();
    bidi?.close();
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

module.exports = {
  ROOT,
  findFirefox,
  findFirefoxOnPath,
  getFirefoxVersion,
  launch,
  makeProfile,
  removeProfile,
};

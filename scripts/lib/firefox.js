// Launches an isolated Firefox with a throwaway profile, installs the
// extension temporarily over RDP (the about:debugging mechanism), and hands
// back an evaluate() bound to the extension's background console.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execFileSync } = require("child_process");

const { FirefoxRdp } = require("./firefox-rdp");

// EXT_DIR (repo-relative) overrides the loaded package, e.g. to run the e2e
// against the bundled build (dist/bundled-pkg) instead of the repo root.
const REPO = path.join(__dirname, "..", "..");
const ARTIFACTS = process.env.E2E_ARTIFACT_DIR
  ? path.resolve(REPO, process.env.E2E_ARTIFACT_DIR)
  : path.join(REPO, "dist", "e2e-artifacts");
const ROOT = process.env.EXT_DIR ? path.join(REPO, process.env.EXT_DIR) : REPO;
const ADDON_ID = "{72d92df5-2aa0-4b06-b807-aa21767545cd}"; // manifest.json gecko id

const sleep = (ms) =>
  new Promise((res) => {
    setTimeout(res, ms);
  });

const findFirefox = () => {
  const candidates = [
    process.env.FIREFOX_PATH,
    "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
    "C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe",
    "/usr/bin/firefox",
    "/Applications/Firefox.app/Contents/MacOS/firefox",
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error("Firefox not found: set FIREFOX_PATH to your firefox executable");
  }
  return found;
};

const killTree = (pid) => {
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

const makeProfile = (baseProfileDir) => {
  let profileDir = `${baseProfileDir}-${process.pid}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
  try {
    fs.rmSync(profileDir, { recursive: true, force: true });
  } catch (e) {
    // A previous run's Firefox still holds the directory: use a fresh one
    profileDir = `${baseProfileDir}-${Date.now()}`;
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

const removeProfile = async (profileDir) => {
  for (let i = 0; i < 5; i += 1) {
    // taskkill can return while a child is completing its final profile write;
    // removing immediately may succeed only for Firefox to recreate the tree.
    // eslint-disable-next-line no-await-in-loop
    await sleep(1500);
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
      // eslint-disable-next-line no-await-in-loop
      await sleep(100);
      if (!fs.existsSync(profileDir)) return;
    } catch (e) {
      // Firefox may still be releasing files after its process tree exits.
    }
  }
  throw new Error(`Unable to remove disposable Firefox profile: ${profileDir}`);
};

const connectWithRetry = async (port, attempts = 30) => {
  for (let i = 0; i < attempts; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await FirefoxRdp.connect(port);
    } catch (e) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(1000);
    }
  }
  throw new Error(`Firefox did not open RDP port ${port}`);
};

const launch = async () => {
  const { profileDir, downloadDir } = makeProfile(path.join(os.tmpdir(), "save-in-ff-e2e"));

  // Random port so a stale instance from an aborted run can't be mistaken
  // for the one we just launched
  const port = 9380 + Math.floor(Math.random() * 200);

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
  let rdp;
  try {
    rdp = await connectWithRetry(port);
    const root = await rdp.getRoot();
    await rdp.installTemporaryAddon(root.addonsActor, ROOT);
    await sleep(2000);

    const addonActor = await rdp.findAddonActor(ADDON_ID);
    const consoleActor = await rdp.getConsoleActor(addonActor);

    // Background scripts may still be loading right after install
    for (let i = 0; i < 20; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const readyType = await rdp.evaluate(
        consoleActor,
        "typeof globalThis.__SAVE_IN_E2E__?.ready",
      );
      if (readyType === "function") break;
      // eslint-disable-next-line no-await-in-loop
      await sleep(500);
      if (i === 19) throw new Error("background page never became ready");
    }

    const evaluate = (text, timeoutMs) => rdp.evaluate(consoleActor, text, timeoutMs);

    // Evaluates in the content window of an open tab matching urlSubstr. The
    // tab must already be open (e.g. via browser.tabs.create from evaluate()).
    const evaluateInTab = async (urlSubstr, text, timeoutMs) => {
      const tabConsole = await rdp.getTabConsoleActor(urlSubstr);
      return rdp.evaluate(tabConsole, text, timeoutMs);
    };

    const cleanup = async () => {
      rdp.close();
      killTree(proc.pid);
      killProfileProcesses(profileDir);
      await removeProfile(profileDir);
    };

    return { proc, rdp, evaluate, evaluateInTab, profileDir, downloadDir, logPath, cleanup };
  } catch (error) {
    rdp?.close();
    killTree(proc.pid);
    killProfileProcesses(profileDir);
    let cleanupError;
    try {
      await removeProfile(profileDir);
    } catch (failure) {
      cleanupError = failure;
    }
    let tail = "";
    try {
      tail = fs.readFileSync(logPath, "utf8").slice(-12000).trim();
    } catch (readError) {
      tail = `Unable to read Firefox log: ${readError.message}`;
    }
    const launchError = new Error(
      `${error.message}\nFirefox process: ${proc.exitCode === null ? "still running" : `exit code ${proc.exitCode}`}\nFirefox log: ${logPath}${tail ? `\n--- log tail ---\n${tail}` : ""}`,
      { cause: error },
    );
    if (cleanupError) {
      // eslint-disable-next-line preserve-caught-error -- AggregateError includes both failures and explicitly preserves the launch cause.
      throw new AggregateError([launchError, cleanupError], "Firefox launch and cleanup failed", {
        cause: error,
      });
    }
    throw launchError;
  }
};

module.exports = { ROOT, launch, makeProfile, removeProfile };

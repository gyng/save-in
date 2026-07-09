// Launches an isolated Firefox with a throwaway profile, installs the
// extension temporarily over RDP (the about:debugging mechanism), and hands
// back an evaluate() bound to the extension's background console.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execFileSync } = require("child_process");

const { FirefoxRdp } = require("./firefox-rdp");

const ROOT = path.join(__dirname, "..", "..");
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

const makeProfile = (baseProfileDir) => {
  let profileDir = baseProfileDir;
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

  const proc = spawn(findFirefox(), args, { stdio: "ignore" });

  const rdp = await connectWithRetry(port);
  const root = await rdp.getRoot();
  await rdp.installTemporaryAddon(root.addonsActor, ROOT);
  await sleep(2000);

  const addonActor = await rdp.findAddonActor(ADDON_ID);
  const consoleActor = await rdp.getConsoleActor(addonActor);

  // Background scripts may still be loading right after install
  for (let i = 0; i < 20; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const readyType = await rdp.evaluate(consoleActor, "typeof window.ready");
    if (readyType === "object") break;
    // eslint-disable-next-line no-await-in-loop
    await sleep(500);
    if (i === 19) throw new Error("background page never became ready");
  }

  const evaluate = (text, timeoutMs) => rdp.evaluate(consoleActor, text, timeoutMs);

  const cleanup = async () => {
    rdp.close();
    killTree(proc.pid);
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(1500);
      try {
        fs.rmSync(profileDir, { recursive: true, force: true });
        return;
      } catch (e) {
        // Firefox is still shutting down; the next run copes regardless
      }
    }
  };

  return { proc, rdp, evaluate, profileDir, downloadDir, cleanup };
};

module.exports = { ROOT, launch };

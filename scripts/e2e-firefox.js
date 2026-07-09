// Automated Firefox smoke test on an isolated profile: launches Firefox
// with a throwaway profile and the remote debugging server, installs the
// extension temporarily (same mechanism as web-ext/about:debugging), and
// exercises the real download pipeline. Run with `yarn e2e:firefox`.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execFileSync } = require("child_process");

const killTree = (pid) => {
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
      });
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

const { FirefoxRdp } = require("./lib/firefox-rdp");

const ROOT = path.join(__dirname, "..");
// Random port so a stale instance from an aborted run can't be mistaken
// for the one we just launched
const RDP_PORT = 9380 + Math.floor(Math.random() * 200);
const ADDON_ID = "{72d92df5-2aa0-4b06-b807-aa21767545cd}"; // manifest.json gecko id

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

const sleep = (ms) =>
  new Promise((res) => {
    setTimeout(res, ms);
  });

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

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const main = async () => {
  const { profileDir, downloadDir } = makeProfile(path.join(os.tmpdir(), "save-in-ff-e2e"));

  console.log("Launching Firefox (isolated profile)...");
  const ffArgs = ["-profile", profileDir, "-no-remote", "-start-debugger-server", String(RDP_PORT)];
  if (process.env.HEADLESS) {
    ffArgs.push("-headless");
  }
  ffArgs.push("about:blank");

  const proc = spawn(findFirefox(), ffArgs, { stdio: "ignore" });

  let rdp;
  try {
    rdp = await connectWithRetry(RDP_PORT);
    const root = await rdp.getRoot();

    console.log("Installing extension temporarily...");
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

    console.log("Running checks...");

    const state = await rdp.evaluate(
      consoleActor,
      `window.ready.then(() => JSON.stringify({
        browser: CURRENT_BROWSER,
        pathErrors: window.optionErrors.paths.length,
        menuCount: Object.keys(Menus.pathMappings).length,
        hasObjectUrl: typeof URL.createObjectURL === "function",
        hasBlockingWebRequest: !!(browser.webRequest && browser.webRequest.onBeforeSendHeaders),
      }))`,
    );
    const s = JSON.parse(state);
    check("background init (browser detected)", s.browser === "FIREFOX", s.browser);
    check("no option errors", s.pathErrors === 0);
    check("path menus built", s.menuCount > 0, `${s.menuCount} items`);
    check("object URLs available (event page)", s.hasObjectUrl === true);
    check("blocking webRequest available (FF MV3 keeps it)", s.hasBlockingWebRequest === true);

    const dl = await rdp.evaluate(
      consoleActor,
      `window.ready.then(() => {
        requestedDownloadFlag = true;
        return Download.renameAndDownload({
          path: new Path.Path("e2e"),
          scratch: {},
          info: {
            url: Download.makeObjectUrl("firefox e2e content"),
            suggestedFilename: "ff-smoke.txt",
            pageUrl: "https://example.com/",
            modifiers: [],
          },
        });
      })
      .then(() => new Promise(r => setTimeout(r, 3000)))
      .then(() => browser.downloads.search({}))
      .then((d) => JSON.stringify(
        d.filter((x) => x.filename.includes("ff-smoke"))
          .map((x) => ({ state: x.state, filename: x.filename }))
      ))`,
      45000,
    );
    const downloads = JSON.parse(dl);
    check(
      "download completes through real pipeline",
      downloads.length === 1 && downloads[0].state === "complete",
      dl,
    );

    const reportedFile = downloads.length === 1 ? downloads[0].filename : null;
    const file = reportedFile || path.join(downloadDir, "e2e", "ff-smoke.txt");
    const content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    check("file on disk with correct content", content === "firefox e2e content", file);

    const reset = await rdp.evaluate(
      consoleActor,
      `Promise.resolve(window.reset()).then(() => "reset-ok")`,
    );
    check("options reset re-initialises", reset === "reset-ok");

    const referer = await rdp.evaluate(
      consoleActor,
      `(() => {
        options.setRefererHeader = true;
        options.setRefererHeaderFilter = "*://i.pximg.net/*";
        Headers.addRequestListener();
        return JSON.stringify({
          registered: browser.webRequest.onBeforeSendHeaders.hasListener(Headers.refererListener),
        });
      })()`,
    );
    check(
      "blocking webRequest referer listener registers",
      JSON.parse(referer).registered === true,
    );
  } finally {
    if (rdp) rdp.close();
    killTree(proc.pid);
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(1500);
      try {
        fs.rmSync(profileDir, { recursive: true, force: true });
        break;
      } catch (e) {
        if (i === 4) console.log(`(profile cleanup skipped: ${e.code})`);
      }
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
};

main().catch((err) => {
  console.error(`\nFirefox E2E failed: ${err.message}`);
  process.exitCode = 1;
});

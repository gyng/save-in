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
const DIST = path.join(ROOT, "dist", "unpacked");

const findChrome = () => {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(os.homedir(), "AppData", "Local", "Google", "Chrome", "Application", "chrome.exe"),
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);

  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error("Chrome not found: set CHROME_PATH to your chrome executable");
  }
  return found;
};

const stageBuild = () => {
  execFileSync(process.execPath, [path.join(ROOT, "scripts", "stage.js")], {
    stdio: "inherit",
  });
};

const makeProfile = (profileDir, downloadDir) => {
  fs.rmSync(profileDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(profileDir, "Default"), { recursive: true });
  fs.mkdirSync(downloadDir, { recursive: true });
  fs.writeFileSync(
    path.join(profileDir, "Default", "Preferences"),
    JSON.stringify({
      download: {
        default_directory: downloadDir,
        prompt_for_download: false,
      },
    }),
  );
};

const launch = async ({ port, profileDir, downloadDir, fresh = true }) => {
  if (fresh || !fs.existsSync(profileDir)) {
    makeProfile(profileDir, downloadDir);
  }

  const chromePath = findChrome();
  const args = [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${port}`,
    "--enable-unsafe-extension-debugging",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
  ];
  if (process.env.HEADLESS) {
    args.push("--headless=new");
  }
  args.push("about:blank");

  const proc = spawn(chromePath, args, { stdio: "ignore", detached: false });

  await cdp.waitForCdp(port);
  const extensionId = await cdp.loadUnpacked(port, DIST);
  return { proc, extensionId };
};

module.exports = { ROOT, DIST, findChrome, stageBuild, launch };

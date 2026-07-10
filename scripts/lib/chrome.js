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

const killTree = (proc) => {
  if (!proc || !proc.pid) return Promise.resolve();
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
    } catch (e) {
      // already gone
    }
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    proc.once("exit", resolve);
    try {
      proc.kill();
    } catch (e) {
      resolve();
    }
    setTimeout(resolve, 3000).unref();
  });
};

const makeProfile = (baseProfileDir, downloadDir) => {
  let profileDir = baseProfileDir;
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

const launch = async ({ port: requestedPort, profileDir, downloadDir, fresh = true }) => {
  let resolvedProfile = profileDir;
  let resolvedDownloads = downloadDir;
  if (fresh || !fs.existsSync(profileDir)) {
    ({ profileDir: resolvedProfile, downloadDir: resolvedDownloads } = makeProfile(
      profileDir,
      downloadDir,
    ));
  }

  // Random port so a stale instance from an aborted run can't be mistaken
  // for the one we just launched
  const port = requestedPort || 9400 + Math.floor(Math.random() * 400);

  const chromePath = findChrome();
  const args = [
    `--user-data-dir=${resolvedProfile}`,
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
  return { proc, extensionId, port, profileDir: resolvedProfile, downloadDir: resolvedDownloads };
};

module.exports = { ROOT, DIST, findChrome, stageBuild, launch, killTree };

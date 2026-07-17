// @ts-check

// Platform contract probe: does the browser's downloads API save into a
// SYMLINKED subdirectory of the default download directory? The store listings
// tell users symlinks are a Firefox-only workaround, so this guards that claim
// across the OS x browser matrix in CI.
//
//   node scripts/platform-symlink-probe.js --browser=chrome
//   node scripts/platform-symlink-probe.js --browser=firefox
//
// It loads a minimal downloads-only extension (test/e2e/fixtures/
// downloads-probe-ext) that registers no onDeterminingFilename listener, so the
// exact filename is honoured, and drives downloads.download into a real
// subdirectory (control) and a symlinked subdirectory (subject).
//
// Contract asserted:
//   chrome  -> the symlinked download is REJECTED (interrupted).
//   firefox -> the symlinked download COMPLETES and writes through the link.
// A broken contract exits 1 (update the docs). A control failure exits 2. A
// runner that cannot create a directory symlink at all exits 0 with a loud
// SKIP, so the matrix cell is not permanently red on a privilege-less host.
//
// Only hard links to files exist; a directory cannot be hard-linked, so the
// destination-folder workaround is inherently a soft link and there is no
// hard-link case to probe.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const cdp = require("./lib/cdp");
const chrome = require("./lib/chrome");
const firefox = require("./lib/firefox");

const PROBE_EXT = path.join(chrome.ROOT, "test", "e2e", "fixtures", "downloads-probe-ext");

const wait = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** @returns {"chrome" | "firefox"} */
const parseBrowser = () => {
  const arg = process.argv.find((a) => a.startsWith("--browser="));
  const value = arg?.slice("--browser=".length);
  if (value !== "chrome" && value !== "firefox") {
    throw new Error("Usage: platform-symlink-probe.js --browser=chrome|firefox");
  }
  return value;
};

// Runs in a page (Chrome) or the event-page background (Firefox). Handles both
// the callback (chrome.*) and promise (browser.*) API styles so one expression
// serves both. Downloads a blob (data: URLs are refused by Firefox).
const DOWNLOAD_EXPR = `(async () => {
  const api = (typeof browser !== "undefined" && browser.downloads) ? browser : chrome;
  const call = (fn, arg) => new Promise((resolve, reject) => {
    try {
      const maybe = fn(arg, (result) => {
        const err = (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.lastError) || null;
        if (err) reject(new Error(err.message)); else resolve(result);
      });
      if (maybe && typeof maybe.then === "function") maybe.then(resolve, reject);
    } catch (e) { reject(e); }
  });
  const dl = async (filename) => {
    try {
      const url = URL.createObjectURL(new Blob(["symlink-probe-" + Date.now()], { type: "text/plain" }));
      const id = await call(api.downloads.download.bind(api.downloads), { url, filename, conflictAction: "overwrite" });
      const started = Date.now();
      for (;;) {
        const items = await call(api.downloads.search.bind(api.downloads), { id });
        const it = items && items[0];
        if (it && (it.state === "complete" || it.state === "interrupted")) {
          return { filename, state: it.state, error: it.error || null, final: it.filename || "" };
        }
        if (Date.now() - started > 8000) return { filename, state: (it && it.state) || "unknown", error: "poll-timeout", final: "" };
        await new Promise((r) => setTimeout(r, 150));
      }
    } catch (e) { return { filename, startError: String(e) }; }
  };
  const rootControl = await dl("probe-root.txt");
  const realSub = await dl("realsub/probe-real.txt");
  const symlinked = await dl("linked/probe-symlink.txt");
  return JSON.stringify({ rootControl, realSub, symlinked });
})()`;

/** Create the real + symlinked subdirectories inside the download directory.
 * @param {string} downloadDir
 * @returns {{ externalTarget: string, linkKind: "symlink" | "junction" } | null} */
const setUpLinks = (downloadDir) => {
  const externalTarget = path.join(path.dirname(downloadDir), `symlink-external-${Date.now()}`);
  fs.mkdirSync(externalTarget, { recursive: true });
  fs.mkdirSync(path.join(downloadDir, "realsub"), { recursive: true });
  const linkPath = path.join(downloadDir, "linked");
  try {
    fs.symlinkSync(externalTarget, linkPath, "dir");
    return { externalTarget, linkKind: "symlink" };
  } catch (error) {
    // Windows may deny directory symlinks without the create-symlink privilege.
    if (process.platform === "win32") {
      try {
        fs.symlinkSync(externalTarget, linkPath, "junction");
        return { externalTarget, linkKind: "junction" };
      } catch {
        return null;
      }
    }
    throw error;
  }
};

/** Did any file reach the link target directory? @param {string} externalTarget */
const wroteThrough = (externalTarget) =>
  fs.existsSync(externalTarget) && fs.readdirSync(externalTarget).length > 0;

/** @typedef {{ filename: string, state?: string, error?: string | null, final?: string, startError?: string }} DlResult */
/** @typedef {{ rootControl: DlResult, realSub: DlResult, symlinked: DlResult }} ProbeResult */

/** @returns {Promise<{ result: ProbeResult, linkKind: string, version: string, wroteThroughLink: boolean } | null>} */
const runChrome = async () => {
  const profileDir = path.join(os.tmpdir(), `symlink-probe-chrome-${Date.now()}`);
  const session = await chrome.launch({ extensionDir: PROBE_EXT, profileDir, fresh: true });
  try {
    if (!session.downloadDir) throw new Error("Chrome session has no download directory");
    const links = setUpLinks(session.downloadDir);
    if (!links) return null;
    const pageUrl = `chrome-extension://${session.extensionId}/src/options/options.html`;
    await cdp.openTab(session.port, pageUrl);
    // readyState "complete" can precede the extension download API being live,
    // so wait for the API itself rather than the document.
    for (let i = 0; i < 100; i += 1) {
      const ready = await cdp
        .evalInTarget(
          session.port,
          pageUrl,
          `document.readyState === "complete" && !!((typeof chrome !== "undefined" && chrome.downloads) || (typeof browser !== "undefined" && browser.downloads))`,
        )
        .catch(() => false);
      if (ready) break;
      await wait(100);
    }
    const raw = await cdp.evalInTarget(session.port, pageUrl, DOWNLOAD_EXPR);
    const result = typeof raw === "string" ? JSON.parse(raw) : raw;
    await wait(400);
    // Capture whether the file reached the link target BEFORE the profile
    // (which contains the target) is removed.
    return {
      result,
      linkKind: links.linkKind,
      version: session.browserVersion,
      wroteThroughLink: wroteThrough(links.externalTarget),
    };
  } finally {
    await chrome.killTree(session.proc);
    await chrome.removeProfile(session.profileDir);
  }
};

/** @returns {Promise<{ result: ProbeResult, linkKind: string, version: string, wroteThroughLink: boolean } | null>} */
const runFirefox = async () => {
  const version = firefox.getFirefoxVersion(firefox.findFirefox());
  const session = await firefox.launch({ extensionDir: PROBE_EXT });
  try {
    const links = setUpLinks(session.downloadDir);
    if (!links) return null;
    const raw = await session.evaluate(DOWNLOAD_EXPR, 30000);
    const result = typeof raw === "string" ? JSON.parse(raw) : raw;
    await wait(500);
    return {
      result,
      linkKind: links.linkKind,
      version,
      wroteThroughLink: wroteThrough(links.externalTarget),
    };
  } finally {
    await session.cleanup();
  }
};

const main = async () => {
  const browser = parseBrowser();
  const outcome = browser === "chrome" ? await runChrome() : await runFirefox();

  if (!outcome) {
    process.stdout.write(
      `SKIP: could not create a directory symlink on ${process.platform}; ` +
        `the runner lacks the create-symlink privilege. Probe not run.\n`,
    );
    return;
  }

  const { result, linkKind, version, wroteThroughLink } = outcome;

  process.stdout.write(
    `\nplatform: ${process.platform}  browser: ${browser} ${version}  link: ${linkKind}\n`,
  );
  process.stdout.write(`  root control:     ${JSON.stringify(result.rootControl)}\n`);
  process.stdout.write(`  real subdir:      ${JSON.stringify(result.realSub)}\n`);
  process.stdout.write(`  symlinked subdir: ${JSON.stringify(result.symlinked)}\n`);
  process.stdout.write(`  wrote through link: ${wroteThroughLink}\n`);

  const controlOk =
    result.rootControl.state === "complete" &&
    result.realSub.state === "complete" &&
    (result.realSub.final || "").includes("realsub");
  if (!controlOk) {
    process.stderr.write(
      `\nINCONCLUSIVE: control downloads did not behave as expected on ${browser}; ` +
        `the probe could not be exercised (not a symlink verdict).\n`,
    );
    process.exitCode = 2;
    return;
  }

  const symlinkRejected = result.symlinked.state === "interrupted";
  const symlinkFollowed = result.symlinked.state === "complete" && wroteThroughLink;

  if (browser === "chrome") {
    if (symlinkRejected && !wroteThroughLink) {
      process.stdout.write(
        `\nPASS: Chrome rejects the symlinked destination (${result.symlinked.error}).\n`,
      );
    } else {
      process.stderr.write(
        `\nFAIL: Chrome accepted a symlinked download destination — the store copy says it does not. Update the docs.\n`,
      );
      process.exitCode = 1;
    }
  } else {
    if (symlinkFollowed) {
      process.stdout.write(`\nPASS: Firefox follows the symlinked destination.\n`);
    } else {
      process.stderr.write(
        `\nFAIL: Firefox did not follow the symlinked destination (state ${result.symlinked.state}); the workaround may be broken.\n`,
      );
      process.exitCode = 1;
    }
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

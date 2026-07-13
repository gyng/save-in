// Development loop for the Chrome MV3 build: stages the bundled package, launches an
// isolated Chrome with the extension loaded, and (with --watch) re-stages and
// reloads the extension whenever src/ or manifest.json changes.
// Run with `npm run d:chrome`.

const fs = require("fs");
const path = require("path");

const cdp = require("./lib/cdp");
const chrome = require("./lib/chrome");
const { CHROME_DEV_PORT } = require("./lib/chrome-ports");
const { startDemoServer } = require("./review-demo");

const PORT = CHROME_DEV_PORT;
const PROFILE = path.join(chrome.ROOT, "dist", "dev-profile");
const DOWNLOADS = path.join(PROFILE, "downloads");
const WATCH = process.argv.includes("--watch");

/** @param {string} extensionId */
const reloadExtension = async (extensionId) => {
  const extensionUrl = `chrome-extension://${extensionId}/`;
  const targets = await cdp.listTargets(PORT);
  const extensionPages = targets.filter(
    (/** @type {{type: string, url: string}} */ target) =>
      target.type === "page" && target.url.startsWith(extensionUrl),
  );

  // Extensions loaded through the CDP Extensions domain are not reliably
  // re-registered by chrome.runtime.reload(). Loading the staged directory
  // again is reliable and leaves ordinary web tabs untouched.
  await cdp.loadUnpacked(PORT, chrome.DIST);

  // loadUnpacked closes extension-owned tabs. Restore them only after Chrome
  // has registered the fresh context so they cannot become blocked pages.
  await cdp.sleep(250);
  for (const page of extensionPages) {
    await cdp.openTab(PORT, page.url);
  }
};

const main = async () => {
  chrome.stageBuild();
  const demoPort = await startDemoServer();

  console.log("Launching Chrome (dev profile persists across runs)...");
  const { proc, extensionId } = await chrome.launch({
    port: PORT,
    profileDir: PROFILE,
    downloadDir: DOWNLOADS,
    fresh: !fs.existsSync(PROFILE),
  });

  await cdp.openTab(PORT, `chrome-extension://${extensionId}/src/options/options.html`);
  await cdp.openTab(PORT, `http://127.0.0.1:${demoPort}/`);

  console.log(`Extension loaded: ${extensionId}`);
  console.log(`CDP port: ${PORT} | Profile: ${PROFILE}`);

  if (WATCH) {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    let reloading = false;
    let pending = false;

    const runReload = async () => {
      if (reloading) {
        pending = true;
        return;
      }

      reloading = true;
      do {
        pending = false;
        try {
          chrome.stageBuild();
          await reloadExtension(extensionId);
          console.log(`[${new Date().toLocaleTimeString()}] reloaded`);
        } catch (e) {
          console.log(
            `[${new Date().toLocaleTimeString()}] restaged; auto-reload failed (${
              e instanceof Error ? e.message : String(e)
            }) — reload manually via chrome://extensions`,
          );
        }
      } while (pending);
      reloading = false;
    };

    const reload = () => {
      clearTimeout(timer);
      timer = setTimeout(runReload, 300);
    };

    for (const dir of ["src", "icons", "_locales"]) {
      fs.watch(path.join(chrome.ROOT, dir), { recursive: true }, reload);
    }
    for (const file of ["manifest.json", "rolldown.config.mjs"]) {
      fs.watch(path.join(chrome.ROOT, file), reload);
    }
    console.log("Watching source, icons, locales, manifest, and bundle config...");
  }

  proc.on("exit", () => {
    console.log("Chrome closed");
    process.exit(0);
  });
};

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

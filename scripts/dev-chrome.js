// Development loop for the Chrome MV3 build: stages the bundled package, launches an
// isolated Chrome with the extension loaded, and (with --watch) re-stages and
// reloads the extension whenever src/ or manifest.json changes.
// Run with `npm run d:chrome`.

const fs = require("fs");
const path = require("path");

const cdp = require("./lib/cdp");
const chrome = require("./lib/chrome");

const PORT = 9378;
const PROFILE = path.join(chrome.ROOT, "dist", "dev-profile");
const DOWNLOADS = path.join(PROFILE, "downloads");
const WATCH = process.argv.includes("--watch");

const main = async () => {
  chrome.stageBuild();

  console.log("Launching Chrome (dev profile persists across runs)...");
  const { proc, extensionId } = await chrome.launch({
    port: PORT,
    profileDir: PROFILE,
    downloadDir: DOWNLOADS,
    fresh: !fs.existsSync(PROFILE),
  });

  await cdp.openTab(PORT, `chrome-extension://${extensionId}/src/options/options.html`);

  console.log(`Extension loaded: ${extensionId}`);
  console.log(`CDP port: ${PORT} | Profile: ${PROFILE}`);

  if (WATCH) {
    let timer = null;
    const reload = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          chrome.stageBuild();
          await cdp.loadUnpacked(PORT, chrome.DIST);
          console.log(`[${new Date().toLocaleTimeString()}] reloaded`);
        } catch (e) {
          console.log(
            `[${new Date().toLocaleTimeString()}] restaged; auto-reload failed (${
              e.message
            }) — reload manually via chrome://extensions`,
          );
        }
      }, 300);
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

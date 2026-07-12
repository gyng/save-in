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

const reloadExtension = async (extensionId) => {
  const extensionUrl = `chrome-extension://${extensionId}/`;
  const targets = await cdp.listTargets(PORT);
  const extensionPages = targets.filter(
    (target) => target.type === "page" && target.url.startsWith(extensionUrl),
  );
  const runtimeTarget =
    targets.find(
      (target) => target.type === "service_worker" && target.url.startsWith(extensionUrl),
    ) || extensionPages[0];

  if (!runtimeTarget) {
    // A fully idle extension has no CDP target to evaluate in. Loading it is
    // the only available fallback, but ordinary page tabs remain untouched.
    await cdp.loadUnpacked(PORT, chrome.DIST);
    return;
  }

  const client = await cdp.Cdp.connect(runtimeTarget.webSocketDebuggerUrl);
  try {
    await client.send("Runtime.evaluate", { expression: "chrome.runtime.reload()" });
  } finally {
    client.close();
  }

  // Extension pages keep their tab when possible, but need a navigation to
  // acquire the new extension context. Recreate only a page Chrome discarded.
  await cdp.sleep(150);
  const liveUrls = new Set(
    (await cdp.listTargets(PORT))
      .filter((target) => target.type === "page")
      .map((target) => target.url),
  );
  for (const page of extensionPages) {
    if (liveUrls.has(page.url)) {
      // eslint-disable-next-line no-await-in-loop
      await cdp.reloadTargets(PORT, page.url);
    } else {
      // eslint-disable-next-line no-await-in-loop
      await cdp.openTab(PORT, page.url);
    }
  }
};

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
              e.message
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

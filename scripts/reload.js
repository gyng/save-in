// Restages the build and hot-reloads it into any running review/dev Chrome:
// loads the fresh unpacked extension and reloads every open options tab in
// place (so locale/HTML/CSS/JS changes show without opening a new tab).
// Discovers Chrome's CDP port by scanning the range chrome.js launches on.

const cdp = require("./lib/cdp");
const chrome = require("./lib/chrome");

// chrome.js picks 9400..9799 (random) unless a fixed port is passed; 9222
// is the conventional default for a manually-launched Chrome
const CANDIDATE_PORTS = [9222, ...Array.from({ length: 400 }, (_, i) => 9400 + i)];

const isChromeCdp = async (port) => {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(300),
    });
    const version = await res.json();
    return Boolean(
      version && typeof version.Browser === "string" && version.Browser.includes("Chrome"),
    );
  } catch (e) {
    return false;
  }
};

const main = async () => {
  chrome.stageBuild();

  let reloaded = 0;
  for (const port of CANDIDATE_PORTS) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await isChromeCdp(port))) {
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const id = await cdp.loadUnpacked(port, chrome.DIST);
      // eslint-disable-next-line no-await-in-loop
      let count = await cdp.reloadTargets(port, "options.html");
      if (count === 0) {
        // No options tab open: open one on the reloaded build
        // eslint-disable-next-line no-await-in-loop
        await cdp.openTab(port, `chrome-extension://${id}/src/options/options.html`);
        count = 1;
      }
      console.log(`port ${port}: reloaded ${id} (${count} options tab${count === 1 ? "" : "s"})`);
      reloaded += 1;
    } catch (e) {
      console.log(`port ${port}: ${e.message}`);
    }
  }

  if (reloaded === 0) {
    console.log("No running review/dev Chrome found. Start one with: npm run review");
  }
  process.exit(0);
};

main();

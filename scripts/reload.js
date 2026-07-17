// @ts-check

// Restages the build and hot-reloads it into any running review/dev Chrome:
// loads the fresh unpacked extension and reloads every open options tab in
// place (so locale/HTML/CSS/JS changes show without opening a new tab).
// Discovers Chrome's CDP port by scanning the range chrome.js launches on.

const cdp = require("./lib/cdp");
const chrome = require("./lib/chrome");
const { CHROME_DISCOVERY_PORTS } = require("./lib/chrome-ports");

// Includes the fixed development port, Chrome's conventional debugging port,
// and the random range used by isolated review sessions.
const CANDIDATE_PORTS = CHROME_DISCOVERY_PORTS;

/** @param {number} port */
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
    if (!(await isChromeCdp(port))) {
      continue;
    }
    try {
      const id = await cdp.loadUnpacked(port, chrome.DIST);
      let count = await cdp.reloadTargets(port, "options.html");
      if (count === 0) {
        // No options tab open: open one on the reloaded build
        await cdp.openTab(port, `chrome-extension://${id}/src/options/options.html`);
        count = 1;
      }
      console.log(`port ${port}: reloaded ${id} (${count} options tab${count === 1 ? "" : "s"})`);
      reloaded += 1;
    } catch (e) {
      console.log(`port ${port}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (reloaded === 0) {
    console.log("No running review/dev Chrome found. Start one with: npm run review");
  }
  process.exit(0);
};

main();

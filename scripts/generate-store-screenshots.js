// @ts-check

// Generates reproducible Chrome Web Store screenshots from the real staged
// extension. Output is 1280x800 PNG: the preferred store-listing size.

process.env.HEADLESS = "1";
process.env.E2E_ARTIFACT_DIR ||= "dist/store-screenshot-artifacts";

const fs = require("fs");
const path = require("path");

const cdp = require("./lib/cdp");
const chrome = require("./lib/chrome");
const { createDemoServer, SHOWCASE_PATHS, SHOWCASE_RULES } = require("./review-demo");
const {
  SCREENSHOT_HEIGHT,
  SCREENSHOT_WIDTH,
  SCREENSHOTS,
  assertPngDimensions,
  optimizePngLosslessly,
} = require("./lib/store-screenshots");

const PROFILE = path.join(chrome.ROOT, "dist", "store-screenshot-profile");
const DEFAULT_OUTPUT = path.join(chrome.ROOT, "docs", "store-screenshots");
/** @typedef {{filename: string, description: string}} Screenshot */

const outputArgument = () => {
  const index = process.argv.indexOf("--output-dir");
  if (index < 0) return process.env.STORE_SCREENSHOT_DIR || DEFAULT_OUTPUT;
  if (!process.argv[index + 1]) throw new Error("--output-dir requires a path");
  return process.argv[index + 1];
};

/** @param {() => unknown | Promise<unknown>} callback @param {string} description @param {number} [timeoutMs] */
const waitFor = async (callback, description, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await callback()) return;
    } catch (error) {
      lastError = error;
    }
    await cdp.sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}`, { cause: lastError });
};

/** @param {import("node:http").Server} server @returns {Promise<number>} */
const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Screenshot server did not bind to a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });

/** @param {number} port @param {string} target @param {string} outputDir @param {Screenshot} screenshot */
const capture = async (port, target, outputDir, screenshot) => {
  const captured = Buffer.from(
    await cdp.captureScreenshot(port, target, {
      width: SCREENSHOT_WIDTH,
      height: SCREENSHOT_HEIGHT,
    }),
    "base64",
  );
  assertPngDimensions(captured, screenshot.filename);
  const { png, savedBytes } = optimizePngLosslessly(captured);
  assertPngDimensions(png, screenshot.filename);
  const output = path.join(outputDir, screenshot.filename);
  fs.writeFileSync(output, png);
  process.stdout.write(
    `Created ${path.relative(chrome.ROOT, output)} (lossless optimization saved ${savedBytes} bytes)\n`,
  );
};

/** @param {number} port @param {string} optionsTarget @param {string} section @param {string | undefined} [focusSelector] */
const activateOptionsTab = async (port, optionsTarget, section, focusSelector) => {
  const tabSelector = `#tab-${section}`;
  await cdp.evalInTarget(
    port,
    optionsTarget,
    `document.querySelector(${JSON.stringify(tabSelector)})?.click()`,
  );
  await waitFor(
    () =>
      cdp.evalInTarget(
        port,
        optionsTarget,
        `document.querySelector(${JSON.stringify(tabSelector)})?.getAttribute("aria-selected") === "true"`,
      ),
    `${section} options tab`,
  );
  await cdp.evalInTarget(
    port,
    optionsTarget,
    `(() => {
      const focus = ${focusSelector ? `document.querySelector(${JSON.stringify(focusSelector)})` : "null"};
      if (focus) {
        focus.scrollIntoView({ block: "center" });
        scrollBy(0, -72);
      } else {
        scrollTo(0, 0);
      }
      document.activeElement?.blur();
      return "ready";
    })()`,
  );
};

/** @param {number} port @param {string} optionsTarget */
const seedShowcase = (port, optionsTarget) =>
  cdp.evalInTarget(
    port,
    optionsTarget,
    `chrome.storage.local.set({
      paths: ${JSON.stringify(SHOWCASE_PATHS)},
      filenamePatterns: ${JSON.stringify(SHOWCASE_RULES)},
      links: true,
      selection: true,
      page: true,
      enableLastLocation: true,
      contentClickToSave: true,
      sourcePanelEnabled: true,
      sourcePanelBackgrounds: true,
      sourcePanelLive: true,
      sourcePanelPreviews: true,
      sourcePanelResourceHints: true,
      sourcePanelLinks: true,
      "save-in-history": [
        {
          id: "showcase-1",
          initiatedAt: "2026-07-13T09:24:00.000Z",
          status: "complete",
          finalFullPath: "images/cats/sunlit-tabby.jpg",
          routed: true,
          mechanism: "downloads-api",
          fileSize: 2481032,
          info: { context: "media", sourceUrl: "https://images.example/sunlit-tabby.jpg" },
          menu: { title: "Cat pictures", path: "images/cats" },
          variables: { sourcedomain: "images.example", fileext: "jpg" }
        },
        {
          id: "showcase-2",
          initiatedAt: "2026-07-13T08:51:00.000Z",
          status: "complete",
          finalFullPath: "docs/2026/July/project-notes.pdf",
          routed: true,
          mechanism: "downloads-api",
          fileSize: 781204,
          info: { context: "link", sourceUrl: "https://docs.example/project-notes.pdf" },
          menu: { title: "Documents", path: "docs/2026/July" },
          variables: { year: "2026", monthname: "July" }
        },
        {
          id: "showcase-3",
          initiatedAt: "2026-07-12T17:40:00.000Z",
          status: "complete",
          finalFullPath: "clips/design-review.webm",
          routed: false,
          mechanism: "fetch-downloads-api",
          fileSize: 18422291,
          info: { context: "media", sourceUrl: "https://media.example/design-review.webm" },
          menu: { title: "Clips", path: "clips" },
          variables: { pagetitleslug: "design-review" }
        }
      ]
    }).then(() => chrome.runtime.sendMessage({ type: "OPTIONS_LOADED" })).then(() => "seeded")`,
  );

const main = async () => {
  if (process.argv.includes("--help")) {
    process.stdout.write(
      "Usage: npm run screenshots:store -- [--output-dir PATH]\n" +
        `Default output: ${path.relative(chrome.ROOT, DEFAULT_OUTPUT)}\n`,
    );
    return;
  }

  const outputDir = path.resolve(chrome.ROOT, outputArgument());
  fs.mkdirSync(outputDir, { recursive: true });

  const extensionDir = chrome.stageBuild("e2e");
  const server = createDemoServer();
  const demoPort = await listen(server);
  const demoTarget = `127.0.0.1:${demoPort}`;
  let session;

  try {
    session = await chrome.launch({ extensionDir, profileDir: PROFILE, fresh: true });
    const { extensionId, port } = session;
    const optionsTarget = `${extensionId}/src/options/options.html`;

    await cdp.openTab(port, `chrome-extension://${optionsTarget}`);
    await waitFor(
      () => cdp.evalInTarget(port, optionsTarget, "document.readyState === 'complete'"),
      "options page",
    );
    await waitFor(
      () =>
        cdp.evalInTarget(
          port,
          optionsTarget,
          `chrome.runtime.sendMessage({ type: "WAKE_WARM" }).then(() => true, () => false)`,
        ),
      "background message listener",
    );
    await seedShowcase(port, optionsTarget);
    await cdp.evalInTarget(port, optionsTarget, "location.reload()");
    await waitFor(
      () =>
        cdp.evalInTarget(
          port,
          optionsTarget,
          `document.readyState === "complete" &&
            document.querySelector("#paths")?.value.includes("images") &&
            document.querySelectorAll("#menu-preview-tree .menu-preview-row").length >= 4`,
        ),
      "configured options preview",
    );
    await cdp.evalInTarget(
      port,
      optionsTarget,
      `document.documentElement.style.scrollBehavior = "auto";
       document.querySelector("#paths-mode-text")?.click();
       scrollTo(0, 0);
       document.activeElement?.blur();`,
    );
    await capture(port, optionsTarget, outputDir, SCREENSHOTS[0]);

    await activateOptionsTab(port, optionsTarget, "section-dynamic-downloads");
    await capture(port, optionsTarget, outputDir, SCREENSHOTS[1]);

    await cdp.evalInTarget(
      port,
      optionsTarget,
      `(() => {
        document.querySelector("#route-debugger-filename").value = "report.pdf";
        document.querySelector("#route-debugger-source-url").value = "https://docs.example/report.pdf";
        document.querySelector("#route-debugger-page-url").value = "https://example.com/reports";
        document.querySelector("#route-debugger-mime").value = "application/pdf";
        document.querySelector("#route-debugger-context").value = "link";
        document.querySelector("#route-debugger-run").click();
        return "running";
      })()`,
    );
    await waitFor(
      () =>
        cdp.evalInTarget(
          port,
          optionsTarget,
          `document.querySelector("#route-debugger-result")?.dataset.state === "matched"`,
        ),
      "route debugger result",
    );
    await cdp.evalInTarget(
      port,
      optionsTarget,
      `document.querySelector(".route-debugger")?.scrollIntoView({ block: "start" });
       scrollBy(0, -112);
       document.activeElement?.blur();`,
    );
    await capture(port, optionsTarget, outputDir, SCREENSHOTS[4]);

    await cdp.openTab(port, `http://${demoTarget}/store-demo`);
    await waitFor(
      () => cdp.evalInTarget(port, demoTarget, "document.readyState === 'complete'"),
      "showcase page",
    );
    await cdp.evalInServiceWorker(
      port,
      extensionId,
      `chrome.tabs.query({}).then(async (tabs) => {
        const tab = tabs.find((candidate) => candidate.url?.includes(${JSON.stringify(demoTarget)}));
        if (!tab?.id) throw new Error("Showcase tab missing");
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.storage.session.set({ sourcePanelOpen: true });
        await chrome.tabs.sendMessage(tab.id, { type: "SET_SOURCE_PANEL", body: { open: true } });
        return "opened";
      })`,
    );
    await waitFor(
      () =>
        cdp.evalInTarget(
          port,
          demoTarget,
          `!!document.querySelector("#save-in-source-panel")?.shadowRoot?.querySelector(".panel")`,
        ),
      "Page Sources panel",
    );
    await cdp.sleep(1500);
    await cdp.evalInTarget(port, demoTarget, "scrollTo(0, 0); document.activeElement?.blur()");
    await capture(port, demoTarget, outputDir, SCREENSHOTS[2]);

    await activateOptionsTab(port, optionsTarget, "section-history");
    await capture(port, optionsTarget, outputDir, SCREENSHOTS[3]);

    process.stdout.write(
      `\nChrome Web Store screenshots are ready in ${path.relative(chrome.ROOT, outputDir)}\n`,
    );
  } finally {
    server.close();
    if (session) {
      await chrome.killTree(session.proc);
      await chrome.removeProfile(session.profileDir);
    }
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { main, waitFor };

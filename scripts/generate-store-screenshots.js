// @ts-check

// Generates reproducible Chrome Web Store screenshots from the real staged
// extension. Output is 1280x800 PNG: the preferred store-listing size.

process.env.HEADLESS = "1";
process.env.E2E_ARTIFACT_DIR ||= "dist/store-screenshot-artifacts";

const fs = require("fs");
const path = require("path");

const cdp = require("./lib/cdp");
const chrome = require("./lib/chrome");
const { menuOverlayDoc, OVERLAY_WIDTH, OVERLAY_HEIGHT } = require("./lib/context-menu-art");
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
  const output = process.argv[index + 1];
  if (!output) throw new Error("--output-dir requires a path");
  return output;
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
    await new Promise((resolve) => setImmediate(resolve));
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
      trackBrowserDownloads: true,
      routeBrowserDownloads: true,
      browserDownloadFiltersEnabled: true,
      browserDownloadFilter: "https://downloads.example.com/*",
      sourcePanelEnabled: true,
      sourcePanelBackgrounds: true,
      sourcePanelLive: true,
      sourcePanelPreviews: true,
      sourcePanelResourceHints: true,
      sourcePanelLinks: true,
      sourcePanelLayout: {
        placement: "right",
        sideWidth: 460,
        dockHeight: 420,
        floatingLeft: 80,
        floatingTop: 80,
        floatingWidth: 520,
        floatingHeight: 620,
      },
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

/** @param {number} port @param {string} demoTarget */
const polishPageSourcesForListing = (port, demoTarget) =>
  cdp.evalInTarget(
    port,
    demoTarget,
    `(() => {
      const root = document.querySelector("#save-in-source-panel")?.shadowRoot;
      if (!root) throw new Error("Page Sources panel missing");
      const featured = new Map([
        ["/demo-photo.avif", {
          name: "miso-in-the-garden.avif",
          url: "https://media.field-notes.example/miso-in-the-garden.avif"
        }],
        ["/demo.mp4", {
          name: "garden-moments.mp4",
          url: "https://media.field-notes.example/garden-moments.mp4",
          size: "18.4 MB"
        }]
      ]);
      let updated = 0;
      root.querySelectorAll(".source-link").forEach((link) => {
        const pathname = new URL(link.href).pathname;
        const replacement = featured.get(pathname) || {
          name: link.querySelector(".name")?.textContent,
          url: "https://field-notes.example" + pathname
        };
        const name = link.querySelector(".name");
        const url = link.querySelector(".url");
        const size = link.querySelector(".source-size");
        if (name && replacement.name) name.textContent = replacement.name;
        if (url) {
          url.textContent = replacement.url;
          url.title = replacement.url;
        }
        if (size && replacement.size) size.textContent = replacement.size;
        else if (size && size.textContent?.toLowerCase().includes("unknown")) {
          size.textContent = 24 + updated * 3 + " KB";
        }
        updated += 1;
      });
      return updated;
    })()`,
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
    session = await chrome.launch({
      extensionDir,
      profileDir: PROFILE,
      fresh: true,
      extraArgs: ["--hide-scrollbars"],
    });
    const { extensionId, port } = session;
    const optionsTarget = `${extensionId}/src/options/options.html`;

    await waitFor(
      () => cdp.evalInTarget(port, optionsTarget, "document.readyState === 'complete'"),
      "first-install options page",
    );
    // The dialog renders after the page reads its pending-welcome flag, so a
    // ready document does not mean the button exists yet. Clicking once at
    // readyState hit the optional chain instead: the click no-opped, the dialog
    // arrived afterwards, and the wait for its absence could never come true.
    // Wait for the button, then re-assert the click until the dialog is gone.
    await waitFor(
      () =>
        cdp.evalInTarget(port, optionsTarget, 'Boolean(document.querySelector(".welcome-accept"))'),
      "first-install welcome dialog",
    );
    await waitFor(
      () =>
        cdp.evalInTarget(
          port,
          optionsTarget,
          `document.querySelector(".welcome-accept")?.click(); !document.querySelector("#welcome-dialog")`,
        ),
      "welcome dialog dismissal",
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
    await capture(port, optionsTarget, outputDir, SCREENSHOTS[2]);

    await activateOptionsTab(port, optionsTarget, "section-dynamic-downloads");
    await capture(port, optionsTarget, outputDir, SCREENSHOTS[3]);

    // Browser downloads: the seeded options enable tracking, Chrome's routing,
    // and the match-pattern filter so the panel shows its active state with the
    // dependent filter field revealed.
    await activateOptionsTab(port, optionsTarget, "section-browser-downloads");
    await waitFor(
      () =>
        cdp.evalInTarget(
          port,
          optionsTarget,
          `document.querySelector("#trackBrowserDownloads")?.checked === true &&
            document.querySelector("#browserDownloadFilter")?.value.includes("example.com")`,
        ),
      "browser-download options seeded",
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
    await waitFor(
      () =>
        cdp.evalInTarget(
          port,
          demoTarget,
          `[...document.querySelector("#save-in-source-panel").shadowRoot
            .querySelectorAll(".source-link .name")]
            .some((node) => node.textContent?.includes("demo-photo.avif"))`,
        ),
      "showcase Page Sources discovery",
    );
    await polishPageSourcesForListing(port, demoTarget);
    await cdp.evalInTarget(port, demoTarget, "scrollTo(0, 0); document.activeElement?.blur()");
    await capture(port, demoTarget, outputDir, SCREENSHOTS[1]);

    // Right-click save: close the Page Sources panel and float the Save In
    // context menu over Miso's photo to show the core gesture on a real page.
    await cdp.evalInServiceWorker(
      port,
      extensionId,
      `chrome.tabs.query({}).then(async (tabs) => {
        const tab = tabs.find((candidate) => candidate.url?.includes(${JSON.stringify(demoTarget)}));
        if (!tab?.id) throw new Error("Showcase tab missing");
        await chrome.storage.session.set({ sourcePanelOpen: false });
        await chrome.tabs.sendMessage(tab.id, { type: "SET_SOURCE_PANEL", body: { open: false } });
        return "closed";
      })`,
    );
    await waitFor(
      () =>
        cdp.evalInTarget(
          port,
          demoTarget,
          `!document.querySelector("#save-in-source-panel")?.shadowRoot?.querySelector(".panel")`,
        ),
      "Page Sources panel closed",
    );
    await cdp.evalInTarget(
      port,
      demoTarget,
      `(() => {
        document.getElementById("save-in-menu-overlay")?.remove();
        const img = document.querySelector(".hero")
          || document.querySelector("article img")
          || document.querySelector("img");
        const rect = img
          ? img.getBoundingClientRect()
          : { left: 120, top: 200, width: 700, height: 400 };
        const W = ${OVERLAY_WIDTH}, H = ${OVERLAY_HEIGHT};
        // Anchor the menu a little inside the image, then clamp so the whole
        // menu stays inside the viewport.
        let left = rect.left + Math.min(64, rect.width * 0.12) - 18;
        let top = rect.top + Math.min(60, rect.height * 0.14) - 18;
        left = Math.max(8, Math.min(left, innerWidth - W - 8));
        top = Math.max(8, Math.min(top, innerHeight - H - 8));
        const frame = document.createElement("iframe");
        frame.id = "save-in-menu-overlay";
        frame.style.cssText =
          "position:fixed;border:0;background:transparent;pointer-events:none;z-index:2147483000;left:"
          + left + "px;top:" + top + "px;width:" + W + "px;height:" + H + "px";
        frame.srcdoc = ${JSON.stringify(menuOverlayDoc())};
        document.body.appendChild(frame);
        return "added";
      })()`,
    );
    await waitFor(
      () =>
        cdp.evalInTarget(
          port,
          demoTarget,
          `!!document.getElementById("save-in-menu-overlay")?.contentDocument?.querySelector(".menu")`,
        ),
      "context-menu overlay",
    );
    await capture(port, demoTarget, outputDir, SCREENSHOTS[0]);

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

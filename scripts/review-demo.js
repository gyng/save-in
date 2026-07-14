// @ts-check

// Review harness: launches an isolated Chrome with the extension loaded,
// seeds a showcase configuration (nested menus, aliases, separators, the
// new :variables:, a routing rule), and opens the options page plus a
// local demo page with media/links/text to right-click. Run with
// `npm run review`. The profile is throwaway (dist/review-profile).

const http = require("http");
const fs = require("fs");
const path = require("path");

const cdp = require("./lib/cdp");
const chrome = require("./lib/chrome");
const firefox = require("./lib/firefox");

const PROFILE = path.join(chrome.ROOT, "dist", "review-profile");
const DEMO_PHOTO = fs.readFileSync(
  path.join(chrome.ROOT, "docs", "store-assets", "demo-photo.avif"),
);

const REVIEW_TITLE = "Save In review";
/** @param {boolean} working */
const setReviewTerminalTitle = (working) => {
  const title = `${working ? "😓" : "✅"} ${REVIEW_TITLE}`;
  process.title = title;
  if (process.stdout.isTTY) process.stdout.write(`\u001B]0;${title}\u0007`);
};

const reviewTimestamp = () => `[${new Date().toLocaleTimeString()}]`;
/** @param {typeof console.log} output @param {unknown[]} values */
const writeReviewMessage = (output, values) => {
  let prefix = reviewTimestamp();
  const first = values[0];
  if (typeof first === "string") {
    const leadingLineBreaks = first.match(/^\n+/)?.[0] ?? "";
    if (leadingLineBreaks) {
      prefix = `${leadingLineBreaks}${prefix}`;
      values = [first.slice(leadingLineBreaks.length), ...values.slice(1)];
    }
  }
  output(prefix, ...values);
};
/** @param {...unknown} values */
const reviewLog = (...values) => writeReviewMessage(console.log, values);
/** @param {...unknown} values */
const reviewError = (...values) => writeReviewMessage(console.error, values);

const SHOWCASE_PATHS = [
  ".",
  "images // (alias: Images)",
  ">corgi",
  ">shiba",
  "---",
  "docs/:year:/:monthname:",
  "clips/:pagetitleslug:",
  ":sourcedomain:/week-:isoweek:",
].join("\n");

// Routes any PDF link into pdfs/<weekday>-<name>; shows up in the options
// page routing section and fires on the demo page's PDF link
const SHOWCASE_RULES = ["fileext: pdf", "into: pdfs/:weekday:-:naivefilename:"].join("\n");

const SHOWCASE_CONFIG = {
  paths: SHOWCASE_PATHS,
  filenamePatterns: SHOWCASE_RULES,
  links: true,
  selection: true,
  page: true,
  enableLastLocation: true,
  contentClickToSave: true,
  notifyOnSuccess: true,
  notifyOnRuleMatch: true,
  sourcePanelEnabled: true,
  sourcePanelBackgrounds: true,
  sourcePanelLive: true,
  sourcePanelPreviews: true,
  sourcePanelResourceHints: true,
  sourcePanelLinks: true,
};

/** @param {string} label @param {string} color */
const svg = (label, color) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200">` +
      `<rect width="320" height="200" fill="${color}"/>` +
      `<text x="160" y="105" font-family="sans-serif" font-size="24" fill="white" text-anchor="middle">${label}</text>` +
      `</svg>`,
  )}`;

// A valid 1x1 WebP keeps the dynamically discovered source preview honest:
// returning the catch-all HTML here makes the Page Sources image look broken.
const LATE_IMAGE = Buffer.from(
  "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA",
  "base64",
);

const DEMO_PAGE = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>save-in review demo page</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; line-height: 1.5; }
      img { margin-right: 1rem; }
      .demo-photo { width: 500px; height: 280px; object-fit: cover; border-radius: 8px; }
      code { background: #eee; padding: 1px 4px; border-radius: 3px; }
      li { margin-bottom: 0.5rem; }
      .background-demo { width: 180px; height: 80px; background: ${svg("CSS background", "#5b6ee1")} center/cover; }
    </style>
  </head>
  <body>
    <h1>save-in review demo</h1>
    <ol>
      <li>Right-click an image &rarr; <b>Save In&hellip;</b> &rarr; note the nested tree, the
        <b>Images</b> alias, the separator, and the :variable: entries.</li>
      <li>Save into <code>:sourcedomain:/week-:isoweek:</code> and check the downloads folder
        for <code>127.0.0.1/week-NN</code>.</li>
      <li>Right-click the PDF link &rarr; save anywhere &rarr; the routing rule sends it to
        <code>pdfs/&lt;weekday&gt;-demo.pdf</code> instead.</li>
      <li>Alt+click an image to exercise content-script click-to-save.</li>
      <li>Select this text, right-click &rarr; save selection; right-click the page background
        &rarr; save page. Check "Last used" appears in the menu afterwards.</li>
      <li>Open Page Sources from the toolbar, the bottom of the Save In context menu, or
        <code>Ctrl+Shift+G</code>.</li>
      <li>Filter, facet, sort, and resize the drawer. Alt+click a result to save immediately;
        right-click its title to use the normal Save In menu. Use <b>Copy URLs</b> after
        filtering and cycle the dock through right, bottom, left, and top.</li>
      <li>Find the streaming-video playlist and use <b>Copy yt-dlp command</b>. This demo only
        checks playlist discovery; it does not contain a playable video.</li>
    </ol>
    <p>
      <img class="demo-photo" src="/demo-photo.avif" alt="Store demo photograph" />
      <img src="${svg("shiba.svg", "#cc8b2c")}" srcset="${svg("shiba-2x.svg", "#e0a14a")} 2x" alt="shiba" />
    </p>
    <div class="background-demo" aria-label="CSS background image example"></div>
    <video controls width="240" src="/demo.mp4"></video>
    <audio controls src="/demo.ogg"></audio>
    <p>
      Links: <a href="/demo.pdf">a PDF (routes to pdfs/)</a> &middot;
      <a href="/archive.zip">a zip</a> &middot;
      <a href="/page2.html">another page</a>
    </p>
    <script>fetch('/master.m3u8').catch(() => {});</script>
    <script>
      window.addEventListener('load', () => requestAnimationFrame(() => {
        const link = document.createElement('a');
        link.href = '/late-image.webp';
        link.textContent = 'dynamically detected image';
        document.body.append(' · ', link);
      }), { once: true });
    </script>
  </body>
</html>`;

const STORE_DEMO_PAGE = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>A quiet afternoon with Miso — Field Notes</title>
    <style>
      :root { color-scheme: light; font-family: Georgia, "Times New Roman", serif; color: #24211d; background: #f6f2ea; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #f6f2ea; }
      header { display: flex; align-items: center; justify-content: space-between; padding: 18px 40px; border-bottom: 1px solid #d8d0c2; background: #fffdf8; }
      .brand { font: 700 22px/1 system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; }
      nav { display: flex; gap: 26px; font: 14px/1 system-ui, sans-serif; }
      nav a, .story-link { color: #315b50; text-decoration: none; }
      main { width: min(1080px, calc(100% - 48px)); margin: 34px auto 72px; display: grid; grid-template-columns: minmax(0, 760px) 240px; gap: 38px; }
      .kicker { margin: 0 0 10px; color: #a14f36; font: 700 12px/1 system-ui, sans-serif; letter-spacing: .12em; text-transform: uppercase; }
      h1 { max-width: 700px; margin: 0 0 12px; font-size: 48px; line-height: 1.02; letter-spacing: -.025em; }
      .dek { max-width: 670px; margin: 0 0 18px; color: #625b52; font-size: 19px; line-height: 1.45; }
      .byline { margin-bottom: 24px; color: #736b61; font: 13px/1.4 system-ui, sans-serif; }
      .hero { display: block; width: 100%; height: 390px; object-fit: cover; border-radius: 4px; }
      figcaption { margin-top: 8px; color: #736b61; font: 12px/1.4 system-ui, sans-serif; }
      article p { font-size: 18px; line-height: 1.7; }
      aside { margin-top: 104px; padding-top: 18px; border-top: 3px solid #315b50; }
      aside h2 { margin: 0 0 16px; font: 700 15px/1 system-ui, sans-serif; text-transform: uppercase; letter-spacing: .08em; }
      .related { display: grid; gap: 18px; }
      .related a { display: block; color: inherit; text-decoration: none; font-size: 17px; line-height: 1.25; }
      .related small { display: block; margin-top: 5px; color: #80776c; font: 12px/1.3 system-ui, sans-serif; }
      .ambient { width: 1px; height: 1px; overflow: hidden; position: absolute; left: -9999px; }
    </style>
  </head>
  <body>
    <header>
      <div class="brand">Field Notes</div>
      <nav aria-label="Sections">
        <a href="/stories">Stories</a><a href="/photography">Photography</a><a href="/places">Places</a><a href="/about">About</a>
      </nav>
    </header>
    <main>
      <article>
        <p class="kicker">Life at home</p>
        <h1>A quiet afternoon with Miso</h1>
        <p class="dek">In the garden's last patch of sun, one curious cat finds enough wonder for the whole day.</p>
        <div class="byline">Words and photographs by G.N.G. &nbsp;·&nbsp; July 13, 2026 &nbsp;·&nbsp; 4 min read</div>
        <figure>
          <img class="hero" src="/demo-photo.avif" alt="Miso the cat watching the garden" />
          <figcaption>Miso pauses beneath the trees as the afternoon light moves across the garden.</figcaption>
        </figure>
        <p>The house had gone still after lunch. Outside, leaves shifted in the warm air and Miso followed every sound with patient attention.</p>
      </article>
      <aside>
        <h2>More field notes</h2>
        <div class="related">
          <a href="/stories/window-light">Finding the best window light<small>Photography · 6 min</small></a>
          <a href="/stories/garden-visitors">Small visitors in the garden<small>Nature · 5 min</small></a>
          <a href="/stories/evening-walk">An evening walk after rain<small>Places · 8 min</small></a>
        </div>
      </aside>
    </main>
    <div class="ambient" aria-hidden="true">
      <video poster="/demo-photo.avif?poster" src="/demo.mp4"></video>
      <a href="/demo.pdf">Photo notes PDF</a>
    </div>
  </body>
</html>`;

// Ephemeral port so multiple review sessions can coexist
const createDemoServer = () =>
  http.createServer((req, res) => {
    if (req.url === "/store-demo") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(STORE_DEMO_PAGE);
    } else if (req.url === "/demo.pdf") {
      res.writeHead(200, { "Content-Type": "application/pdf" });
      res.end("%PDF-1.4\n% save-in review demo pdf\n%%EOF\n");
    } else if (req.url === "/archive.zip") {
      res.writeHead(200, { "Content-Type": "application/zip" });
      res.end(Buffer.from("PK\x05\x06" + "\x00".repeat(18), "binary"));
    } else if (req.url === "/page2.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<title>page two</title><p>Right-click here and save the page.</p>");
    } else if (req.url === "/late-image.webp") {
      res.writeHead(200, { "Content-Type": "image/webp" });
      res.end(LATE_IMAGE);
    } else if (req.url?.startsWith("/demo-photo.avif")) {
      res.writeHead(200, { "Content-Type": "image/avif", "Content-Length": DEMO_PHOTO.length });
      res.end(DEMO_PHOTO);
    } else if (req.url === "/master.m3u8") {
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      res.end("#EXTM3U\n#EXT-X-ENDLIST\n");
    } else if (req.url === "/demo.mp4" || req.url === "/demo.ogg") {
      res.writeHead(200, {
        "Content-Type": req.url.endsWith("mp4") ? "video/mp4" : "audio/ogg",
      });
      res.end(Buffer.alloc(32));
    } else {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(DEMO_PAGE);
    }
  });

/** @returns {Promise<{port: number, server: import("node:http").Server}>} */
const startDemoServerSession = () =>
  new Promise((resolve, reject) => {
    const server = createDemoServer();
    /** @param {unknown} error */
    const fail = (error) => reject(error);
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", fail);
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Demo server did not bind to a TCP port"));
        return;
      }
      resolve({ port: address.port, server });
    });
  });

/** @returns {Promise<number>} */
const startDemoServer = async () => (await startDemoServerSession()).port;

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

/** @param {import("node:http").Server} server */
const closeDemoServer = (server) =>
  new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve(undefined);
      return;
    }
    server.close((error) => (error ? reject(error) : resolve(undefined)));
  });

/**
 * @param {{browser: {proc: import("node:child_process").ChildProcess, profileDir: string} | undefined, server: import("node:http").Server}} session
 * @param {{killTree?: typeof chrome.killTree, removeProfile?: typeof chrome.removeProfile}} [cleanup]
 */
const cleanupReviewSession = async (
  { browser, server },
  { killTree = chrome.killTree, removeProfile = chrome.removeProfile } = {},
) => {
  /** @type {unknown[]} */
  const failures = [];
  if (browser) {
    try {
      await killTree(browser.proc);
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    await closeDemoServer(server);
  } catch (error) {
    failures.push(error);
  }
  if (browser) {
    try {
      await removeProfile(browser.profileDir);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, "Review session cleanup failed");
};

/**
 * @param {Set<{cleanup: () => Promise<void>}>} firefoxSessions
 * @param {() => Promise<void>} cleanupChromeSession
 */
const cleanupReviewBrowsers = async (firefoxSessions, cleanupChromeSession) => {
  /** @type {unknown[]} */
  const failures = [];
  for (const session of firefoxSessions) {
    try {
      await session.cleanup();
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    await cleanupChromeSession();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length) throw new AggregateError(failures, "Review session cleanup failed");
};

/**
 * @param {{enableHotReload: () => void, openFirefox: () => void, reload: () => void, stop: () => void}} actions
 * @returns {(input: string) => void}
 */
const createReviewKeyHandler =
  ({ enableHotReload, openFirefox, reload, stop }) =>
  (input) => {
    for (const key of input) {
      if (key === "\u0003") {
        stop();
        return;
      }
      if (key.toLowerCase() === "h") {
        enableHotReload();
      }
      if (key.toLowerCase() === "f") {
        openFirefox();
      }
      if (key.toLowerCase() === "r") {
        reload();
      }
    }
  };

/**
 * @param {{enableHotReload: () => void, openFirefox: () => void, reload: () => void, stop: () => void}} actions
 * @returns {(() => void) | undefined}
 */
const installReviewControls = (actions) => {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    return undefined;
  }

  const handleKey = createReviewKeyHandler(actions);
  /** @param {string | Buffer} data */
  const onData = (data) => handleKey(String(data));
  input.setEncoding("utf8");
  input.setRawMode(true);
  input.resume();
  input.on("data", onData);

  return () => {
    input.off("data", onData);
    if (input.isRaw) {
      input.setRawMode(false);
    }
    input.pause();
  };
};

/**
 * @param {() => void} reload
 * @returns {() => void}
 */
const installHotReload = (reload) => {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  /** @type {import("node:fs").FSWatcher[]} */
  const watchers = [];
  const queueReload = () => {
    clearTimeout(timer);
    timer = setTimeout(reload, 300);
  };

  for (const dir of ["src", "icons", "_locales"]) {
    watchers.push(fs.watch(path.join(chrome.ROOT, dir), { recursive: true }, queueReload));
  }
  for (const file of ["manifest.json", "rolldown.config.mjs"]) {
    watchers.push(fs.watch(path.join(chrome.ROOT, file), queueReload));
  }

  return () => {
    clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
  };
};

/** @param {number} port @param {number} demoPort */
const reloadReviewSession = async (port, demoPort) => {
  chrome.stageBuild();
  const extensionId = await cdp.loadUnpacked(port, chrome.DIST);

  // Chrome may close extension-owned tabs while re-registering an unpacked
  // extension. Reopen Options when necessary, and reload the demo page so its
  // content script belongs to the new extension context.
  let optionsTabs = await cdp.reloadTargets(port, "options.html");
  if (optionsTabs === 0) {
    await cdp.openTab(port, `chrome-extension://${extensionId}/src/options/options.html`);
    optionsTabs = 1;
  }
  const demoTabs = await cdp.reloadTargets(port, `127.0.0.1:${demoPort}`);
  return { extensionId, optionsTabs, demoTabs };
};

/** @param {number} demoPort */
const launchFirefoxReview = async (demoPort) => {
  chrome.stageBuild();
  const browser = await firefox.launch({ extensionDir: chrome.DIST });
  try {
    await browser.evaluateInTab(
      "src/options/options.html",
      `browser.storage.local.set(${JSON.stringify(SHOWCASE_CONFIG)})
        .then(() => browser.runtime.sendMessage({ type: "OPTIONS_LOADED" }))
        .then(() => "seeded")`,
    );
    await browser.evaluate(`(async () => {
      const optionsUrl = browser.runtime.getURL("src/options/options.html");
      const optionsTab = (await browser.tabs.query({})).find((tab) => tab.url === optionsUrl);
      if (optionsTab?.id) await browser.tabs.reload(optionsTab.id);
      await browser.tabs.create({ url: ${JSON.stringify(`http://127.0.0.1:${demoPort}/`)} });
      return true;
    })()`);
    return browser;
  } catch (error) {
    await browser.cleanup();
    throw error;
  }
};

const main = async () => {
  setReviewTerminalTitle(true);
  chrome.stageBuild();
  const { port: demoPort, server } = await startDemoServerSession();
  /** @type {Awaited<ReturnType<typeof chrome.launch>> | undefined} */
  let browser;
  let cleanupControls = () => {};
  let cleanupHotReload = () => {};
  let removeSignalHandlers = () => {};
  let hotReloadEnabled = false;
  let stopping = false;
  let exitCode = 0;
  let activeReviewWork = 0;
  /** @type {Awaited<ReturnType<typeof firefox.launch>> | undefined} */
  let activeFirefox;
  /** @type {Promise<void> | undefined} */
  let firefoxLaunch;
  /** @type {Set<Awaited<ReturnType<typeof firefox.launch>>>} */
  const firefoxSessions = new Set();

  const beginReviewWork = () => {
    activeReviewWork += 1;
    setReviewTerminalTitle(true);
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      activeReviewWork -= 1;
      if (activeReviewWork === 0) setReviewTerminalTitle(false);
    };
  };

  try {
    reviewLog("Launching Chrome (throwaway review profile)...");
    browser = await chrome.launch({
      profileDir: PROFILE,
      fresh: true,
    });
    const { proc, extensionId, port, downloadDir } = browser;
    const exited = new Promise((resolve) => proc.once("exit", resolve));

    // The options page must exist before evalInServiceWorker can wake the
    // worker, so: open it, seed the config, then reload it to pick the
    // seeded values up
    await cdp.openTab(port, `chrome-extension://${extensionId}/src/options/options.html`);
    const optionsTarget = `${extensionId}/src/options/options.html`;
    await waitFor(
      () =>
        cdp.evalInTarget(
          port,
          optionsTarget,
          `typeof chrome.storage?.local?.set === "function" &&
            typeof chrome.runtime?.sendMessage === "function"`,
        ),
      "options extension APIs",
    );
    await cdp.evalInTarget(
      port,
      optionsTarget,
      `chrome.storage.local.set(${JSON.stringify(SHOWCASE_CONFIG)})
        .then(() => chrome.runtime.sendMessage({ type: "OPTIONS_LOADED" }))
        .then(() => "seeded")`,
    );
    await cdp.evalInTarget(port, optionsTarget, "location.reload()");
    await cdp.openTab(port, `http://127.0.0.1:${demoPort}/`);

    let reloading = false;
    let pendingReload = false;
    const requestReload = () => {
      if (reloading) {
        pendingReload = true;
        return;
      }

      reloading = true;
      const finishReviewWork = beginReviewWork();
      void (async () => {
        try {
          do {
            pendingReload = false;
            reviewLog("\nRestaging and reloading the review extension...");
            try {
              const result = await reloadReviewSession(port, demoPort);
              reviewLog(
                `Reloaded ${result.extensionId} (${result.optionsTabs} options tab, ${result.demoTabs} demo tab).`,
              );
            } catch (error) {
              reviewError(
                `Reload failed: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          } while (pendingReload);
        } finally {
          reloading = false;
          finishReviewWork();
        }
      })();
    };

    const openFirefox = () => {
      if (firefoxLaunch) {
        reviewLog("Firefox is already starting.");
        return;
      }
      if (activeFirefox) {
        reviewLog("Firefox is already open.");
        return;
      }

      const finishReviewWork = beginReviewWork();
      firefoxLaunch = (async () => {
        try {
          reviewLog("\nLaunching Firefox (throwaway review profile)...");
          const session = await launchFirefoxReview(demoPort);
          firefoxSessions.add(session);
          activeFirefox = session;
          session.proc.once("exit", () => {
            if (activeFirefox === session) activeFirefox = undefined;
            reviewLog("Firefox closed");
          });
          reviewLog(`Firefox loaded. Downloads land in: ${session.downloadDir}`);
        } catch (error) {
          reviewError(
            `Firefox launch failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        } finally {
          firefoxLaunch = undefined;
          finishReviewWork();
        }
      })();
    };

    const stop = (requestedExitCode = 130) => {
      if (stopping) return;
      stopping = true;
      exitCode = requestedExitCode;
      cleanupControls();
      void chrome.killTree(proc);
    };
    const onSigint = () => stop(130);
    const onSigterm = () => stop(143);
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
    removeSignalHandlers = () => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    };
    const installedControls = installReviewControls({
      enableHotReload: () => {
        if (hotReloadEnabled) return;
        cleanupHotReload = installHotReload(requestReload);
        hotReloadEnabled = true;
        reviewLog(
          "\nHot reload enabled. Watching source, icons, locales, manifest, and bundle config.",
        );
      },
      openFirefox,
      reload: requestReload,
      stop: () => stop(130),
    });
    if (installedControls) {
      cleanupControls = installedControls;
    }

    reviewLog(`
Extension loaded: ${extensionId}
Downloads land in: ${downloadDir}

Two tabs are open:
  1. Options page — the Directories tab shows the seeded paths with the
     live menu preview beside the textarea. Edit the textarea to watch the
     preview update; break a line (e.g. "<bad>") to see inline errors.
  2. Demo page — follow the numbered checklist on the page (nested menus,
     aliases, :variables:, PDF routing rule, alt+click, selection/page save).

${installedControls ? "Press [f] to open Firefox, [h] to enable hot reload, [r] to reload Chrome, or Ctrl+C to exit." : "Close the Chrome window to exit."}`);

    setReviewTerminalTitle(false);
    await exited;
    cleanupControls();
    reviewLog("Chrome closed");
    return exitCode;
  } finally {
    cleanupHotReload();
    cleanupControls();
    removeSignalHandlers();
    if (firefoxLaunch) await firefoxLaunch;
    await cleanupReviewBrowsers(firefoxSessions, () => cleanupReviewSession({ browser, server }));
  }
};

if (require.main === module) {
  main().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error) => {
      reviewError(error);
      process.exitCode = 1;
    },
  );
}

module.exports = {
  SHOWCASE_PATHS,
  SHOWCASE_RULES,
  cleanupReviewSession,
  createReviewKeyHandler,
  createDemoServer,
  startDemoServer,
  startDemoServerSession,
};

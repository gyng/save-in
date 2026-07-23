// @ts-check

// Review harness: launches an isolated Chrome with the extension loaded,
// seeds the default configuration (the shipped default folder menu) so review
// starts from the real first-run experience, and opens the options page plus a
// local demo page with media/links/text to right-click. Press [s] to swap in
// the showcase configuration (nested menus, aliases, separators, :variables:,
// a routing rule) on demand. Run with `npm run review`. Chrome normally uses a
// throwaway profile; the terminal prompt-support toggle relaunches it with the
// provisioned Gemini Nano profile.

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const cdp = require("./lib/cdp");
const chrome = require("./lib/chrome");
const firefox = require("./lib/firefox");

const PROFILE = path.join(chrome.ROOT, "dist", "review-profile");
const PROMPT_PROFILE =
  process.env.SAVE_IN_PROMPT_PROFILE || path.join(os.homedir(), ".cache", "save-in-nano-profile");
const PROMPT_RUNTIME =
  process.env.SAVE_IN_PROMPT_RUNTIME || path.join(os.homedir(), ".cache", "save-in-nano-runtime");
const DEMO_PHOTO = fs.readFileSync(
  path.join(chrome.ROOT, "docs", "store", "assets", "demo-photo.avif"),
);

const REVIEW_TITLE = "Save In review";
let reviewTerminalWorking = true;
let reviewTerminalFocused = true;
const renderReviewTerminalTitle = () => {
  const marker = reviewTerminalWorking ? "😓" : reviewTerminalFocused ? "" : "🟢";
  const title = `${marker ? `${marker} ` : ""}${REVIEW_TITLE}`;
  process.title = title;
  if (process.stdout.isTTY) process.stdout.write(`\u001B]0;${title}\u0007`);
};
/** @param {boolean} working */
const setReviewTerminalTitle = (working) => {
  reviewTerminalWorking = working;
  renderReviewTerminalTitle();
};
/** @param {boolean} focused */
const setReviewTerminalFocused = (focused) => {
  reviewTerminalFocused = focused;
  renderReviewTerminalTitle();
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

/**
 * ChromeML owns a separate Dawn/Vulkan device from browser ANGLE. Ubuntu's WSL
 * packages do not currently ship Dozen, so Prompt review uses a pre-provisioned,
 * isolated runtime rather than changing the system Vulkan configuration.
 *
 * @param {string} runtimeRoot
 * @param {NodeJS.ProcessEnv} [baseEnvironment]
 * @param {(filename: string) => boolean} [fileExists]
 */
const promptRuntimeSettings = (
  runtimeRoot,
  baseEnvironment = process.env,
  fileExists = fs.existsSync,
) => {
  const libraryDir = path.join(runtimeRoot, "lib");
  const layerDir = path.join(runtimeRoot, "layer");
  const driver = path.join(runtimeRoot, "share", "vulkan", "icd.d", "dzn_icd.json");
  const required = [
    driver,
    path.join(libraryDir, "libvulkan_dzn.so"),
    path.join(libraryDir, "libvulkan-feature-shim.so"),
    path.join(layerDir, "VkLayer_LOCAL_compute_feature.json"),
  ];
  const missing = required.filter((filename) => !fileExists(filename));
  if (missing.length) {
    throw new Error(
      `Prompt review runtime is incomplete at ${runtimeRoot}: missing ${missing
        .map((filename) => path.relative(runtimeRoot, filename))
        .join(", ")}. Set SAVE_IN_PROMPT_RUNTIME to the provisioned runtime.`,
    );
  }
  const inheritedLibraries = baseEnvironment.LD_LIBRARY_PATH;
  return {
    // Under WSLg, GL is what reaches D3D12: ANGLE renders through Mesa's
    // Gallium d3d12 driver set below, and reports itself as "ANGLE (Microsoft
    // Corporation, D3D12 (<adapter>), OpenGL 4.6)". Asking ANGLE for the D3D12
    // it already uses does not work — d3d12 is not an ANGLE backend, and vulkan
    // reaches no device once Dozen is bound to ChromeML. Either one leaves the
    // browser with no GPU context at all.
    extraArgs: ["--use-angle=gl"],
    environment: {
      GALLIUM_DRIVER: "d3d12",
      MESA_D3D12_DEFAULT_ADAPTER_NAME:
        baseEnvironment.SAVE_IN_PROMPT_ADAPTER ||
        baseEnvironment.MESA_D3D12_DEFAULT_ADAPTER_NAME ||
        "NVIDIA",
      VK_DRIVER_FILES: driver,
      VK_INSTANCE_LAYERS: "VK_LAYER_LOCAL_compute_feature",
      VK_LAYER_PATH: layerDir,
      LD_LIBRARY_PATH: [libraryDir, "/usr/lib/wsl/lib", inheritedLibraries]
        .filter(Boolean)
        .join(":"),
    },
  };
};

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

// The default review config: the same feature toggles so the demo page stays
// fully exercisable, but the shipped default folder menu instead of the
// showcase's nested/aliased/:variable: paths. Press [s] in review to swap in
// SHOWCASE_CONFIG. Keep DEFAULT_PATHS in sync with OPTION_DEFAULTS.paths in
// src/config/option-defaults.ts.
const DEFAULT_PATHS = ". // (alias: Downloads)\nImages\nDocuments";
const DEFAULT_CONFIG = { ...SHOWCASE_CONFIG, paths: DEFAULT_PATHS };

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
 * @param {{proc: import("node:child_process").ChildProcess, profileDir: string, preserveProfile?: boolean}} browser
 * @param {{killTree?: typeof chrome.killTree, removeProfile?: typeof chrome.removeProfile}} [cleanup]
 */
const cleanupReviewBrowser = async (
  browser,
  { killTree = chrome.killTree, removeProfile = chrome.removeProfile } = {},
) => {
  /** @type {unknown[]} */
  const failures = [];
  try {
    await killTree(browser.proc);
  } catch (error) {
    failures.push(error);
  }
  if (!browser.preserveProfile) {
    try {
      await removeProfile(browser.profileDir);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, "Review browser cleanup failed");
};

/**
 * @param {{browser: {proc: import("node:child_process").ChildProcess, profileDir: string, preserveProfile?: boolean} | undefined, server: import("node:http").Server}} session
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
      await cleanupReviewBrowser(browser, { killTree, removeProfile });
    } catch (error) {
      if (error instanceof AggregateError) failures.push(...error.errors);
      else failures.push(error);
    }
  }
  try {
    await closeDemoServer(server);
  } catch (error) {
    failures.push(error);
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

const TERMINAL_FOCUS_IN = "\u001B[I";
const TERMINAL_FOCUS_OUT = "\u001B[O";

/**
 * @param {{enableHotReload: () => void, loadShowcase: () => void, openFirefox: () => void, reload: () => void, setTerminalFocused: (focused: boolean) => void, stop: () => void, togglePromptSupport: () => void}} actions
 * @returns {(input: string) => void}
 */
const createReviewKeyHandler =
  ({
    enableHotReload,
    loadShowcase,
    openFirefox,
    reload,
    setTerminalFocused,
    stop,
    togglePromptSupport,
  }) =>
  (input) => {
    let keys = input;
    if (keys.includes(TERMINAL_FOCUS_OUT)) {
      setTerminalFocused(false);
      keys = keys.replaceAll(TERMINAL_FOCUS_OUT, "");
    }
    if (keys.includes(TERMINAL_FOCUS_IN)) {
      setTerminalFocused(true);
      keys = keys.replaceAll(TERMINAL_FOCUS_IN, "");
    }
    if (keys) setTerminalFocused(true);

    for (const key of keys) {
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
      if (key.toLowerCase() === "p") {
        togglePromptSupport();
      }
      if (key.toLowerCase() === "s") {
        loadShowcase();
      }
    }
  };

/**
 * @param {{enableHotReload: () => void, loadShowcase: () => void, openFirefox: () => void, reload: () => void, setTerminalFocused: (focused: boolean) => void, stop: () => void, togglePromptSupport: () => void}} actions
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
  const focusReportingEnabled = Boolean(process.stdout.isTTY);
  if (focusReportingEnabled) process.stdout.write("\u001B[?1004h");

  return () => {
    if (focusReportingEnabled) process.stdout.write("\u001B[?1004l");
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
  for (const file of ["manifest.json", "config/rolldown.config.mjs"]) {
    watchers.push(fs.watch(path.join(chrome.ROOT, file), queueReload));
  }

  return () => {
    clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
  };
};

/** @param {number} port @param {string} extensionId @param {number} demoPort */
const waitForChromeReviewContent = (port, extensionId, demoPort) => {
  const optionsTarget = `${extensionId}/src/options/options.html`;
  const demoUrl = `http://127.0.0.1:${demoPort}/`;
  return waitFor(
    () =>
      cdp.evalInTarget(
        port,
        optionsTarget,
        `(async () => {
          const tab = (await chrome.tabs.query({})).find(({ url }) => url === ${JSON.stringify(demoUrl)});
          if (!tab?.id) return false;
          try {
            await chrome.tabs.sendMessage(tab.id, { type: "SET_SOURCE_PANEL", body: { open: false } });
            return true;
          } catch {
            return false;
          }
        })()`,
      ),
    "Page Sources content script",
  );
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
  if (demoTabs) await waitForChromeReviewContent(port, extensionId, demoPort);
  return { extensionId, optionsTabs, demoTabs };
};

/** @param {number} demoPort */
const launchFirefoxReview = async (demoPort) => {
  chrome.stageBuild();
  const browser = await firefox.launch({ extensionDir: chrome.DIST });
  try {
    await browser.evaluateInTab(
      "src/options/options.html",
      `browser.storage.local.set(${JSON.stringify(DEFAULT_CONFIG)})
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

/** @param {number} demoPort @param {boolean} promptSupport */
const launchChromeReview = async (demoPort, promptSupport) => {
  if (promptSupport && !fs.existsSync(PROMPT_PROFILE)) {
    throw new Error(
      `Prompt profile not found at ${PROMPT_PROFILE}. Provision it first or set SAVE_IN_PROMPT_PROFILE.`,
    );
  }
  const profileDir = promptSupport ? PROMPT_PROFILE : PROFILE;
  const downloadDir = promptSupport ? path.join(profileDir, "downloads") : undefined;
  const runtime = promptSupport
    ? promptRuntimeSettings(PROMPT_RUNTIME)
    : { extraArgs: [], environment: {} };
  if (downloadDir) fs.mkdirSync(downloadDir, { recursive: true });
  const launched = await chrome.launch({
    profileDir,
    ...(downloadDir ? { downloadDir } : {}),
    fresh: !promptSupport,
    preserveProfile: promptSupport,
    enableGpu: promptSupport,
    extraArgs: runtime.extraArgs,
    environment: runtime.environment,
  });
  const browser = Object.assign(launched, {
    preserveProfile: promptSupport,
    promptSupport,
    promptAvailability: /** @type {string | undefined} */ (undefined),
  });
  try {
    const { extensionId, port } = browser;
    const optionsTarget = `${extensionId}/src/options/options.html`;
    // Fresh installs open Options themselves. Reuse that first-run tab, with
    // an explicit fallback for hosts that do not dispatch the install event.
    await waitFor(
      async () => (await cdp.listTargets(port)).some(({ url }) => url.includes(optionsTarget)),
      "first-install options page",
      3000,
    ).catch(() => cdp.openTab(port, `chrome-extension://${extensionId}/src/options/options.html`));
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
      `chrome.storage.local.set(${JSON.stringify(DEFAULT_CONFIG)})
        .then(() => chrome.runtime.sendMessage({ type: "OPTIONS_LOADED" }))
        .then(() => "seeded")`,
    );
    await cdp.evalInTarget(port, optionsTarget, "location.reload()");
    await cdp.openTab(port, `http://127.0.0.1:${demoPort}/`);
    await waitForChromeReviewContent(port, extensionId, demoPort).catch(async () => {
      await cdp.reloadTargets(port, `127.0.0.1:${demoPort}`);
      await waitForChromeReviewContent(port, extensionId, demoPort);
    });
    if (promptSupport) {
      const readiness = /** @type {{availability: string, output: string}} */ (
        await cdp.callFunctionInTarget(
          port,
          optionsTarget,
          `async function () {
            if (typeof LanguageModel === "undefined") return "missing";
            let availability = await LanguageModel.availability();
            const deadline = Date.now() + 60_000;
            while (availability === "downloading" && Date.now() < deadline) {
              await new Promise((resolve) => setTimeout(resolve, 1_000));
              availability = await LanguageModel.availability();
            }
            if (availability !== "available") return {availability, output: ""};
            const session = await LanguageModel.create();
            try {
              const output = await session.prompt("Reply with exactly these three words: SAVE IN READY");
              return {availability, output};
            } finally {
              session.destroy();
            }
          }`,
          [],
          180_000,
        )
      );
      if (readiness.availability !== "available" || readiness.output.trim() !== "SAVE IN READY") {
        throw new Error(
          `Prompt API did not complete its review probe (${readiness.availability}: ${readiness.output.trim() || "no output"})`,
        );
      }
      browser.promptAvailability = readiness.availability;
      await cdp.reloadTargets(port, optionsTarget);
    }
    return browser;
  } catch (error) {
    await cleanupReviewBrowser(browser);
    throw error;
  }
};

const main = async () => {
  setReviewTerminalTitle(true);
  chrome.stageBuild();
  const { port: demoPort, server } = await startDemoServerSession();
  /** @type {Awaited<ReturnType<typeof launchChromeReview>> | undefined} */
  let browser;
  let cleanupControls = () => {};
  let cleanupHotReload = () => {};
  let removeSignalHandlers = () => {};
  let hotReloadEnabled = false;
  let stopping = false;
  let switchingChrome = false;
  let desiredPromptSupport = false;
  let chromeSwitch = Promise.resolve();
  let exitCode = 0;
  let activeReviewWork = 0;
  /** @type {Awaited<ReturnType<typeof firefox.launch>> | undefined} */
  let activeFirefox;
  /** @type {Promise<void> | undefined} */
  let firefoxLaunch;
  /** @type {Set<Awaited<ReturnType<typeof firefox.launch>>>} */
  const firefoxSessions = new Set();
  /** @type {() => void} */
  let resolveReviewExit = () => {};
  const reviewExit = new Promise((resolve) => {
    resolveReviewExit = () => resolve(undefined);
  });

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

  /** @param {Awaited<ReturnType<typeof launchChromeReview>>} session */
  const trackChromeExit = (session) => {
    session.proc.once("exit", () => {
      if (browser !== session) return;
      if (!switchingChrome || stopping) resolveReviewExit();
    });
  };

  try {
    reviewLog("Launching Chrome (throwaway review profile)...");
    browser = await launchChromeReview(demoPort, false);
    trackChromeExit(browser);

    let reloading = false;
    let pendingReload = false;
    const requestReload = () => {
      if (reloading || switchingChrome) {
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
              const session = browser;
              if (!session) throw new Error("Chrome is not running");
              const result = await reloadReviewSession(session.port, demoPort);
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
          if (pendingReload && !switchingChrome) requestReload();
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

    const loadShowcase = () => {
      const session = browser;
      if (!session) {
        reviewLog("Chrome is not running.");
        return;
      }
      const finishReviewWork = beginReviewWork();
      void (async () => {
        try {
          reviewLog(
            "\nLoading the showcase profile (nested menus, aliases, :variables:, PDF routing rule)...",
          );
          // Match by path substring, not the extension id, so it survives an
          // extension reload that mints a new id.
          const optionsTarget = "src/options/options.html";
          await cdp.evalInTarget(
            session.port,
            optionsTarget,
            `chrome.storage.local.set(${JSON.stringify(SHOWCASE_CONFIG)})
              .then(() => chrome.runtime.sendMessage({ type: "OPTIONS_LOADED" }))
              .then(() => "seeded")`,
          );
          await cdp.evalInTarget(session.port, optionsTarget, "location.reload()");
          await cdp.reloadTargets(session.port, `127.0.0.1:${demoPort}`);
          reviewLog("Showcase profile loaded. Press [r] to reload back to the default folders.");
        } catch (error) {
          reviewError(
            `Loading the showcase failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        } finally {
          finishReviewWork();
        }
      })();
    };

    const togglePromptSupport = () => {
      desiredPromptSupport = !desiredPromptSupport;
      if (switchingChrome) {
        reviewLog(
          `Prompt support ${desiredPromptSupport ? "enable" : "disable"} queued until Chrome finishes relaunching.`,
        );
        return;
      }

      switchingChrome = true;
      const finishReviewWork = beginReviewWork();
      chromeSwitch = (async () => {
        try {
          while (browser?.promptSupport !== desiredPromptSupport) {
            if (stopping) break;
            const targetPromptSupport = desiredPromptSupport;
            reviewLog(
              `\nRelaunching Chrome with Prompt support ${targetPromptSupport ? "on" : "off"}...`,
            );
            let replacement;
            try {
              replacement = await launchChromeReview(demoPort, targetPromptSupport);
            } catch (error) {
              desiredPromptSupport = browser?.promptSupport ?? false;
              reviewError(
                `Prompt-support relaunch failed; the current Chrome remains open: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
              return;
            }
            if (stopping) {
              await cleanupReviewBrowser(replacement);
              return;
            }
            const previous = browser;
            browser = replacement;
            trackChromeExit(replacement);
            if (previous) await cleanupReviewBrowser(previous);
            reviewLog(
              targetPromptSupport
                ? `Prompt support is on (${replacement.promptAvailability}; completion verified). Using preserved profile: ${replacement.profileDir}`
                : "Prompt support is off. Using a throwaway review profile.",
            );
            reviewLog(`Downloads land in: ${replacement.downloadDir}`);
          }
        } catch (error) {
          reviewError(
            `Chrome relaunch cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        } finally {
          switchingChrome = false;
          finishReviewWork();
          if (pendingReload) requestReload();
          if (browser?.proc.exitCode !== null) resolveReviewExit();
        }
      })();
      void chromeSwitch;
    };

    const stop = (requestedExitCode = 130) => {
      if (stopping) return;
      stopping = true;
      exitCode = requestedExitCode;
      cleanupControls();
      const session = browser;
      if (session) void chrome.killTree(session.proc);
      else resolveReviewExit();
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
      loadShowcase,
      openFirefox,
      reload: requestReload,
      setTerminalFocused: setReviewTerminalFocused,
      stop: () => stop(130),
      togglePromptSupport,
    });
    if (installedControls) {
      cleanupControls = installedControls;
    }

    reviewLog(`
Extension loaded: ${browser.extensionId}
Downloads land in: ${browser.downloadDir}

Two tabs are open:
  1. Options page — the Directories tab shows the seeded paths with the
     live menu preview beside the textarea. Edit the textarea to watch the
     preview update; break a line (e.g. "<bad>") to see inline errors.
  2. Demo page — follow the numbered checklist on the page (nested menus,
     aliases, :variables:, PDF routing rule, alt+click, selection/page save).

${installedControls ? "Press [s] to load the showcase profile (nested menus, aliases, :variables:, routing rule), [p] to toggle Prompt support, [f] to open Firefox, [h] to enable hot reload, [r] to reload Chrome, or Ctrl+C to exit." : "Close the Chrome window to exit."}`);

    setReviewTerminalTitle(false);
    await reviewExit;
    cleanupControls();
    reviewLog("Chrome closed");
    return exitCode;
  } finally {
    cleanupHotReload();
    cleanupControls();
    removeSignalHandlers();
    if (firefoxLaunch) await firefoxLaunch;
    await chromeSwitch;
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
  promptRuntimeSettings,
  startDemoServer,
  startDemoServerSession,
};

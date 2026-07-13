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

const PROFILE = path.join(chrome.ROOT, "dist", "review-profile");
const DEMO_PHOTO = fs.readFileSync(
  path.join(chrome.ROOT, "docs", "store-assets", "demo-photo.avif"),
);

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
      setTimeout(() => {
        const link = document.createElement('a');
        link.href = '/late-image.webp';
        link.textContent = 'dynamically detected image';
        document.body.append(' · ', link);
      }, 1500);
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

const startDemoServer = () =>
  new Promise((resolve, reject) => {
    const server = createDemoServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Demo server did not bind to a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });

const main = async () => {
  process.env.SAVE_IN_E2E = "1";
  chrome.stageBuild();
  const demoPort = await startDemoServer();

  console.log("Launching Chrome (throwaway review profile)...");
  const { proc, extensionId, port, downloadDir } = await chrome.launch({
    profileDir: PROFILE,
    fresh: true,
  });

  // The options page must exist before evalInServiceWorker can wake the
  // worker, so: open it, seed the config, then reload it to pick the
  // seeded values up
  await cdp.openTab(port, `chrome-extension://${extensionId}/src/options/options.html`);
  await cdp.evalInServiceWorker(
    port,
    extensionId,
    `browser.storage.local.set({
      paths: ${JSON.stringify(SHOWCASE_PATHS)},
      filenamePatterns: ${JSON.stringify(SHOWCASE_RULES)},
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
    }).then(() => globalThis.__SAVE_IN_E2E__.reset()).then(() => "seeded")`,
  );
  await cdp.evalInTarget(port, "options.html", "location.reload()");
  await cdp.openTab(port, `http://127.0.0.1:${demoPort}/`);

  console.log(`
Extension loaded: ${extensionId}
Downloads land in: ${downloadDir}

Two tabs are open:
  1. Options page — the Directories tab shows the seeded paths with the
     live menu preview beside the textarea. Edit the textarea to watch the
     preview update; break a line (e.g. "<bad>") to see inline errors.
  2. Demo page — follow the numbered checklist on the page (nested menus,
     aliases, :variables:, PDF routing rule, alt+click, selection/page save).

Close the Chrome window to exit.`);

  proc.on("exit", () => {
    console.log("Chrome closed");
    process.exit(0);
  });
};

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = {
  SHOWCASE_PATHS,
  SHOWCASE_RULES,
  createDemoServer,
  startDemoServer,
};

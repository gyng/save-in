// @ts-check

// Regenerates the store marketing assets that are drawn art rather than
// product UI — promo tiles, listing icons, and the "right-click" hero mock —
// into docs/store-assets/. These are rendered from self-contained HTML, so
// they need no build, profile, or loaded extension. The archive glyph is read
// from the shipped toolbar icon so the marketing art can never drift from it.
//
// The real product screenshots (routing rules, page sources, history, the
// route debugger) are the extension's own UI and belong to
// scripts/generate-store-screenshots.js — those 1280x800 PNGs under
// docs/store-screenshots/ are the screenshots for both stores. This script
// deliberately does not re-render them.
//
//   node scripts/generate-store-promo.js
//
// Requires a Chrome/Chromium locatable by scripts/lib/chrome.js (honours
// CHROME_PATH). On WSL a Windows chrome.exe is used with wslpath-translated
// arguments.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { findChrome } = require("./lib/chrome");

const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "docs", "store-assets");
const ICON_SVG = path.join(ROOT, "icons", "ic_archive_black_24px.svg");
const DEMO_PHOTO = path.join(OUT_DIR, "demo-photo.avif");

const ICON_BLACK = "#474747";
const ACCENT = "#0060df";
const PAGE_BG = "#e9edf3";

// Media-kind colours, mirrored from src/options/style.css (--color-kind-*).
const KIND = {
  image: "#8250df",
  video: "#0969da",
  audio: "#b45309",
  document: "#cf222e",
  other: "#6b7280",
  stream: "#087f5b",
};

/** The single archive path drawn by the shipped toolbar icon. */
const GLYPH = (() => {
  const svg = fs.readFileSync(ICON_SVG, "utf8");
  const match = svg.match(/<path[^>]*\bd="([^"]+)"/);
  if (!match || !match[1]) throw new Error(`No <path d="..."> found in ${ICON_SVG}`);
  return match[1];
})();

/** @param {string} fill @param {string} [cls] */
const glyph = (fill, cls = "") =>
  `<svg${cls ? ` class="${cls}"` : ""} viewBox="0 0 24 24"><path fill="${fill}" d="${GLYPH}"/></svg>`;

/** A folder tab in one of the media-kind colours. @param {string} fill */
const folder = (fill) =>
  `<svg class="fico" viewBox="0 0 36 30"><path fill="${fill}" d="M3 3h10l3 4h14a3 3 0 0 1 3 3v16a3 3 0 0 1-3 3H3a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z"/></svg>`;

/** @returns {string} base64 data URI for the bundled demo photo. */
const photoDataUri = () =>
  `data:image/avif;base64,${fs.readFileSync(DEMO_PHOTO).toString("base64")}`;

// The realistic right-click menu, shared by the marquee tile and the hero
// screenshot. `scale` maps the 1x pixel sizes up for the larger canvases.
/** @param {number} scale */
const contextMenuCss = (scale) => {
  const s = (/** @type {number} */ n) => `${n * scale}px`;
  return `
  .menu{position:absolute;background:#fff;border:1px solid rgba(0,0,0,0.14);border-radius:${s(8)};
    padding:${s(6)};box-shadow:0 ${s(20)} ${s(48)} rgba(15,25,50,0.26),0 ${s(3)} ${s(9)} rgba(15,25,50,0.14);
    font-size:${s(15)};color:#1c1e24}
  .mi{display:flex;align-items:center;gap:${s(11)};padding:${s(8)} ${s(12)};border-radius:${s(5)};
    white-space:nowrap;line-height:1}
  .mi .label{flex:1}.mi .arrow{color:#8a929e;font-size:${s(12)}}
  .mi.on{background:${ACCENT};color:#fff}.mi.on .arrow{color:#cfe0ff}.mi.on .path{color:#d8e6ff}
  .mi.dim{color:#b7bcc6}
  .sep{height:1px;background:#e7e9ee;margin:${s(5)} ${s(8)}}
  .ico{width:${s(16)};height:${s(16)};flex:none;fill:#6b7280}
  .fico{width:${s(17)};height:${s(14)};flex:none}
  .mi .path{margin-left:${s(8)};font-size:${s(12.5)};color:#99a0ad;font-weight:500}`;
};

const primaryMenu = `
  <div class="menu primary">
    <div class="mi"><svg class="ico" viewBox="0 0 24 24"><path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3zM5 5h6v2H5v12h12v-6h2v8H3V5h2z"/></svg><span class="label">Open image in new tab</span></div>
    <div class="mi"><svg class="ico" viewBox="0 0 24 24"><path d="M5 20h14v-2H5v2zM12 3l-5 5h3v6h4V8h3l-5-5z"/></svg><span class="label">Save image as&hellip;</span></div>
    <div class="mi"><svg class="ico" viewBox="0 0 24 24"><path d="M16 1H4a2 2 0 0 0-2 2v12h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z"/></svg><span class="label">Copy image</span></div>
    <div class="sep"></div>
    <div class="mi on">${glyph("#fff", "ico")}<span class="label">Save In</span><span class="arrow">&#9654;</span></div>
    <div class="sep"></div>
    <div class="mi dim"><svg class="ico" style="fill:#c2c6cf" viewBox="0 0 24 24"><path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0L19.2 12l-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></svg><span class="label">Inspect</span></div>
  </div>`;

const submenu = `
  <div class="menu submenu">
    <div class="mi on">${folder("#fff")}<span class="label">Images</span><span class="path">~/Downloads/Images</span></div>
    <div class="mi">${folder(KIND.video)}<span class="label">Video</span><span class="path">~/Downloads/Video</span></div>
    <div class="mi">${folder(KIND.audio)}<span class="label">Audio</span><span class="path">~/Downloads/Music</span></div>
    <div class="mi">${folder(KIND.document)}<span class="label">Documents</span><span class="path">~/Downloads/Docs</span></div>
    <div class="sep"></div>
    <div class="mi">${folder(KIND.other)}<span class="label">Choose folder&hellip;</span></div>
    <div class="mi">${folder(KIND.stream)}<span class="label">Add rule&hellip;</span><span class="path">sort &amp; rename</span></div>
  </div>`;

const cursor = (/** @type {string} */ cls) =>
  `<svg class="${cls}" viewBox="0 0 24 24"><path fill="#fff" stroke="#1c1e24" stroke-width="1.4" stroke-linejoin="round" d="M5 3l14 8-6 1.6 3.4 6.4-2.6 1.4-3.4-6.5L5 20V3z"/></svg>`;

/** @param {string} body @param {string} extraCss @param {number} w @param {number} h */
const doc = (body, extraCss, w, h) => `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${w}px;height:${h}px}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
    width:${w}px;height:${h}px;overflow:hidden;background:${PAGE_BG};color:#0f1626;position:relative}
  ${extraCss}
</style></head><body>${body}</body></html>`;

// ---------------------------------------------------------------------------
// Asset templates
// ---------------------------------------------------------------------------

const smallTile = () =>
  doc(
    `<div class="wrap">
      <div class="brand"><div class="gl">${glyph(ICON_BLACK)}</div><div class="name">Save In</div></div>
      <div class="tag">Right-click to save into the <b>right folder</b> &mdash; automatically.</div>
      <div class="chips">
        <div class="chip"><span class="dot" style="background:${KIND.image}"></span>Images</div>
        <div class="chip"><span class="dot" style="background:${KIND.video}"></span>Video</div>
        <div class="chip"><span class="dot" style="background:${KIND.audio}"></span>Audio</div>
        <div class="chip"><span class="dot" style="background:${KIND.stream}"></span>Pages</div>
      </div>
    </div>`,
    `.wrap{position:absolute;inset:0;padding:32px;display:flex;flex-direction:column}
    .brand{display:flex;align-items:center;gap:13px}
    .gl{width:44px;height:44px}.gl svg{width:44px;height:44px}
    .name{font-size:34px;font-weight:700;letter-spacing:-0.5px}
    .tag{margin-top:20px;font-size:21px;line-height:1.3;font-weight:600;color:#2a3450;max-width:350px;letter-spacing:-0.2px}
    .tag b{color:${ACCENT};font-weight:700}
    .chips{margin-top:auto;display:flex;gap:8px;flex-wrap:wrap}
    .chip{display:flex;align-items:center;gap:7px;background:#fff;border:1px solid #d3d9e3;border-radius:999px;
      padding:6px 13px 6px 10px;font-size:13.5px;font-weight:600;color:#34405a}
    .dot{width:9px;height:9px;border-radius:50%}`,
    440,
    280,
  );

const marqueeTile = () =>
  doc(
    `<div class="wrap">
      <div class="left">
        <div class="brand"><div class="gl">${glyph(ICON_BLACK)}</div><div class="name">Save In</div></div>
        <div class="tag">Save anything into the <b>right folder.</b></div>
        <div class="sub">Right-click images, video, audio, links and pages into organized folders &mdash; with rules that sort and rename them automatically.</div>
      </div>
      <div class="menuStage">${primaryMenu}${submenu}${cursor("cursor")}</div>
    </div>`,
    `.wrap{position:absolute;inset:0;padding:72px;display:flex;align-items:center;gap:40px}
    .left{width:600px;flex:none}
    .brand{display:flex;align-items:center;gap:18px}
    .gl{width:80px;height:80px}.gl svg{width:80px;height:80px}
    .name{font-size:62px;font-weight:700;letter-spacing:-1.2px}
    .tag{margin-top:32px;font-size:44px;line-height:1.14;font-weight:700;letter-spacing:-0.8px;color:#131c30;max-width:560px}
    .tag b{color:${ACCENT}}
    .sub{margin-top:22px;font-size:21px;line-height:1.5;font-weight:500;color:#47536b;max-width:540px}
    .menuStage{position:relative;flex:1;height:100%}
    .primary{top:96px;left:96px;width:260px;z-index:1}
    .submenu{top:176px;left:344px;width:268px;z-index:2}
    ${contextMenuCss(1)}
    .cursor{position:absolute;top:214px;left:470px;width:22px;height:22px;z-index:3;filter:drop-shadow(0 1px 1px rgba(0,0,0,0.35))}`,
    1400,
    560,
  );

/** @param {number} size */
const iconArt = (size) =>
  doc(
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24"><path fill="${ICON_BLACK}" d="${GLYPH}"/></svg>`,
    `body{background:transparent}svg{display:block}`,
    size,
    size,
  );

const heroScreenshot = () =>
  doc(
    `<div class="page">
      <div class="head"><div class="gl">${glyph(ICON_BLACK)}</div><div class="name">Save In</div></div>
      <div class="headline">Right-click anything &rarr; save into the <b>right folder.</b></div>
      <div class="sub">Images, video, audio, links and pages &mdash; sorted and renamed by your own rules.</div>
      <div class="win">
        <div class="bar">
          <div class="dots"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>
          <div class="addr"><svg class="lock" viewBox="0 0 24 24"><path d="M12 1a5 5 0 0 0-5 5v3H5v12h14V9h-2V6a5 5 0 0 0-5-5zm3 8H9V6a3 3 0 0 1 6 0v3z"/></svg>photos.example.com/backyard-tabby</div>
          <div class="tbtn">${glyph(ICON_BLACK)}</div>
        </div>
        <div class="content">
          <div class="article">
            <div class="kicker">Photography</div>
            <div class="title">Backyard tabby</div>
            <div class="byline">4200 &times; 2800 &middot; JPEG &middot; by A. Lindqvist</div>
            <img class="photo" src="${photoDataUri()}" alt="">
          </div>
          ${primaryMenu}${submenu}${cursor("cursor")}
        </div>
      </div>
    </div>`,
    `.page{position:absolute;inset:0;padding:96px 120px;display:flex;flex-direction:column}
    .head{display:flex;align-items:center;gap:26px;margin-bottom:14px}
    .gl{width:76px;height:76px}.gl svg{width:76px;height:76px}
    .name{font-size:52px;font-weight:700;letter-spacing:-1px}
    .headline{font-size:78px;font-weight:700;letter-spacing:-1.6px;line-height:1.08;margin-top:26px;color:#131c30}
    .headline b{color:${ACCENT}}
    .sub{font-size:30px;color:#47536b;font-weight:500;margin-top:20px}
    .win{margin-top:54px;flex:1;background:#fff;border-radius:20px;overflow:hidden;position:relative;
      box-shadow:0 40px 90px rgba(15,25,50,0.22),0 6px 18px rgba(15,25,50,0.12);border:1px solid rgba(0,0,0,0.08)}
    .bar{height:84px;background:#f2f3f6;border-bottom:1px solid #e3e6ec;display:flex;align-items:center;gap:22px;padding:0 30px}
    .dots{display:flex;gap:14px}.dots i{width:20px;height:20px;border-radius:50%;display:block}
    .addr{flex:1;height:48px;background:#fff;border:1px solid #dfe3ea;border-radius:24px;display:flex;align-items:center;
      gap:14px;padding:0 22px;font-size:24px;color:#5a6472;max-width:1100px}
    .addr .lock{width:20px;height:20px;fill:#8a929e}
    .tbtn{width:52px;height:52px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:#e8eaef}
    .tbtn svg{width:32px;height:32px}
    .content{position:absolute;top:84px;left:0;right:0;bottom:0;overflow:hidden;background:#fff}
    .article{padding:64px 120px}
    .kicker{font-size:24px;font-weight:600;color:${ACCENT};letter-spacing:.4px;text-transform:uppercase}
    .title{font-size:60px;font-weight:700;letter-spacing:-1px;margin-top:14px;color:#12151c}
    .byline{font-size:26px;color:#7b8494;margin-top:16px}
    .photo{margin-top:40px;width:100%;height:760px;border-radius:16px;object-fit:cover;display:block;box-shadow:0 10px 30px rgba(0,0,0,0.14)}
    .primary{top:560px;left:250px;width:430px;z-index:2}
    .submenu{top:690px;left:672px;width:452px;z-index:3}
    ${contextMenuCss(1.66)}
    .cursor{position:absolute;top:756px;left:930px;width:40px;height:40px;z-index:4;filter:drop-shadow(0 2px 2px rgba(0,0,0,0.35))}`,
    2400,
    1800,
  );

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const CHROME = findChrome();
const CHROME_IS_WINDOWS = /\.exe$/i.test(CHROME);

/** Translate a WSL path to a Windows path when driving a Windows chrome.exe.
 * @param {string} p */
const forChrome = (p) =>
  CHROME_IS_WINDOWS ? execFileSync("wslpath", ["-w", p]).toString().trim() : p;

/** @param {string} file @param {number} width @param {number} height */
const assertPng = (file, width, height) => {
  const buf = fs.readFileSync(file);
  if (buf.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
    throw new Error(`${file}: not a PNG`);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (w !== width || h !== height)
    throw new Error(`${file}: expected ${width}x${height}, got ${w}x${h}`);
};

/** @param {string} tmpDir @param {{name:string,width:number,height:number,transparent?:boolean,html:string}} spec */
const render = (tmpDir, spec) => {
  const htmlPath = path.join(tmpDir, `${spec.name}.html`);
  const outPath = path.join(OUT_DIR, `${spec.name}.png`);
  fs.writeFileSync(htmlPath, spec.html);
  const args = [
    "--headless",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    `--window-size=${spec.width},${spec.height}`,
  ];
  if (spec.transparent) args.push("--default-background-color=00000000");
  args.push(`--screenshot=${forChrome(outPath)}`, forChrome(htmlPath));
  execFileSync(CHROME, args, { stdio: "ignore" });
  assertPng(outPath, spec.width, spec.height);
  console.log(`  ${path.relative(ROOT, outPath)}  (${spec.width}x${spec.height})`);
};

const main = () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "save-in-promo-"));
  console.log(
    `Rendering store assets with ${path.basename(CHROME)} into ${path.relative(ROOT, OUT_DIR)}/`,
  );

  /** @type {{name:string,width:number,height:number,transparent?:boolean,html:string}[]} */
  const specs = [
    { name: "promo-tile-small-440x280", width: 440, height: 280, html: smallTile() },
    { name: "promo-tile-marquee-1400x560", width: 1400, height: 560, html: marqueeTile() },
    { name: "icon-32x32", width: 32, height: 32, transparent: true, html: iconArt(32) },
    { name: "icon-64x64", width: 64, height: 64, transparent: true, html: iconArt(64) },
    { name: "icon-128x128", width: 128, height: 128, transparent: true, html: iconArt(128) },
    { name: "screenshot-right-click-2400x1800", width: 2400, height: 1800, html: heroScreenshot() },
  ];

  for (const spec of specs) render(tmpDir, spec);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log(`Done: ${specs.length} assets.`);
};

main();

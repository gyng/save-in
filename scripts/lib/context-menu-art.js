// @ts-check

// The "right-click -> Save In" context-menu art, rendered as an HTML/SVG
// string. Shared so the drawn promo hero (generate-store-promo.js) and the
// overlay injected onto the real Page Sources screenshot
// (generate-store-screenshots.js) show the identical menu. The archive glyph
// is read from the shipped toolbar icon so the art cannot drift from it.

const fs = require("node:fs");
const path = require("node:path");

const ICON_SVG = path.join(__dirname, "..", "..", "icons", "ic_archive_black_24px.svg");

const ACCENT = "#0060df";

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

// `scale` maps the 1x pixel sizes up for the larger canvases.
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

/** @param {string} cls */
const cursor = (cls) =>
  `<svg class="${cls}" viewBox="0 0 24 24"><path fill="#fff" stroke="#1c1e24" stroke-width="1.4" stroke-linejoin="round" d="M5 3l14 8-6 1.6 3.4 6.4-2.6 1.4-3.4-6.5L5 20V3z"/></svg>`;

// A self-contained, transparent HTML document holding just the cascading menu,
// sized for OVERLAY_WIDTH x OVERLAY_HEIGHT. The screenshot generator loads it
// into a same-origin srcdoc iframe so the menu floats over the demo page
// without inheriting or leaking page styles.
const OVERLAY_WIDTH = 600;
const OVERLAY_HEIGHT = 410;

const menuOverlayDoc = () => `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${OVERLAY_WIDTH}px;height:${OVERLAY_HEIGHT}px;background:transparent}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;position:relative}
  ${contextMenuCss(1)}
  .primary{top:18px;left:18px;width:258px;z-index:1}
  .submenu{top:96px;left:268px;width:268px;z-index:2}
  .cursor{position:absolute;top:132px;left:396px;width:22px;height:22px;z-index:3;filter:drop-shadow(0 1px 1px rgba(0,0,0,0.35))}
</style></head><body>${primaryMenu}${submenu}${cursor("cursor")}</body></html>`;

module.exports = {
  ACCENT,
  KIND,
  GLYPH,
  glyph,
  folder,
  cursor,
  contextMenuCss,
  primaryMenu,
  submenu,
  OVERLAY_WIDTH,
  OVERLAY_HEIGHT,
  menuOverlayDoc,
};

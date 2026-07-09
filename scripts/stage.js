// Stages a loadable copy of the extension into dist/unpacked for dev/e2e.
// Chrome cannot load the repo root unpacked: node_modules contains
// _-prefixed filenames that Chrome rejects. Store zips come from
// `yarn build` (web-ext) instead — one artifact for both browsers.

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const out = path.join(root, "dist", "unpacked");

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

["src", "icons", "_locales"].forEach((dir) => {
  fs.cpSync(path.join(root, dir), path.join(out, dir), { recursive: true });
});

fs.copyFileSync(path.join(root, "manifest.json"), path.join(out, "manifest.json"));
fs.copyFileSync(path.join(root, "LICENSE"), path.join(out, "LICENSE"));

process.stdout.write(`Staged unpacked extension in ${out}\n`);

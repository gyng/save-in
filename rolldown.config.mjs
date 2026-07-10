import { defineConfig } from "rolldown";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Thin bundler for store submission: consolidates each target's many scripts
// into ONE readable, NON-minified file. The background/options/content scripts
// are classic scripts sharing one lexical scope (that's how the globals work);
// concatenating a target's files into a single virtual module and letting
// rolldown emit one IIFE preserves that scope exactly — no per-file module
// wrapping, no import/export migration, no minification/obfuscation (reviewers
// can read the source). The config is ES-module and rolldown-based so a future
// TypeScript migration can grow into real modules.

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const manifest = JSON.parse(read("manifest.json"));

// Strip the test-only `if (typeof module !== "undefined") { module.exports = … }`
// guard: it is dead in the browser and would make rolldown treat the virtual
// module as CommonJS. Some files pair it with an `else { …browser init… }`
// branch — keep that branch's body (it runs in the browser), drop the rest.
const stripModuleExports = (src) =>
  src
    .replace(
      /if \(typeof module !== "undefined"\) \{[\s\S]*?\n\} else \{\n([\s\S]*?)\n\}\n?/g,
      "$1\n",
    )
    .replace(/\n?if \(typeof module !== "undefined"\) \{[\s\S]*?\n\}\n?/g, "\n");

// Extract the ordered <script src> list from an HTML page (options/offscreen)
const scriptsFromHtml = (htmlPath) => {
  const dir = path.dirname(htmlPath);
  const html = read(htmlPath);
  return [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"[^>]*>/g)]
    .map((m) => m[1])
    .filter((src) => !/^https?:/.test(src))
    .map((src) => path.posix.normalize(path.posix.join(dir, src)));
};

// A plugin serving a virtual entry = in-order concatenation of `files`
const concat = (id, files, prefix = "") => ({
  name: `concat:${id}`,
  resolveId: (source) => (source === id ? id : null),
  load: (loaded) =>
    loaded === id
      ? prefix +
        files
          .map(
            (f) =>
              `// ==================== ${f} ====================\n${stripModuleExports(read(f))}`,
          )
          .join("\n")
      : null,
});

const bundle = (name, files, prefix = "") => ({
  input: `virtual:${name}`,
  plugins: [concat(`virtual:${name}`, files, prefix)],
  output: { file: `dist/bundled/${name}.js`, format: "esm", minify: false },
});

const backgroundScripts = manifest.background.scripts;
const optionsScripts = scriptsFromHtml("src/options/options.html");
const offscreenScripts = scriptsFromHtml("src/offscreen.html");

export default defineConfig([
  // Firefox event page loads background.scripts (has window)
  bundle("background", backgroundScripts),
  // Chrome service worker: same scripts, with the window shim from background.js
  bundle("background.sw", backgroundScripts, "self.window = self;\n"),
  bundle("options", optionsScripts),
  bundle("offscreen", offscreenScripts),
  bundle("content", ["src/content/content.js"]),
]);

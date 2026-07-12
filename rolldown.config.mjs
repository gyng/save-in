import { defineConfig } from "rolldown";

// Store-submission bundler for the TypeScript/ESM codebase (docs/TS-MIGRATION.md).
// Each target has one entry module (src/entry.*.ts) that side-effect-imports its
// files IN LOAD ORDER; rolldown strips the types (oxc), resolves the imports and
// scope-hoists every module into ONE readable, NON-minified file per target — so
// top-level side effects and synchronous MV3 listener registration are preserved,
// and the shared-object-mutation idiom (Menus.addDownloadListener = …) survives.
//
// Output format is per-target and load-bearing:
//   - background / background.sw / options / offscreen use `esm`: an entry with
//     NO exports emits bare top-level code (no `export` statements), valid as a
//     classic script in the SW / event page / page. The background entry then
//     assigns its objects onto globalThis so the e2e's evalSW can reach them by
//     bare name — an `iife` would hide them.
//   - content uses `iife`: it runs as a classic content script and is isolated
//     (nothing outside reads its bindings), so a function wrapper is fine; `esm`
//     would emit `export` statements (a syntax error when injected).
//
// The Chrome service worker has no `window`; background.sw.js is prefixed with
// `self.window = self;` (banner) so the legacy `window.foo` globals keep working
// before any module that touches `window` at load evaluates.

export default defineConfig([
  // Firefox event page (has a real window) — loaded via background.scripts
  {
    input: "src/entries/background.ts",
    output: {
      file: "dist/bundled/background.js",
      format: "esm",
      minify: false,
      sourcemap: true,
    },
  },
  // Chrome service worker: same modules, with the window shim up front
  {
    input: "src/entries/background.ts",
    output: {
      file: "dist/bundled/background.sw.js",
      format: "esm",
      minify: false,
      sourcemap: true,
      banner: "self.window = self;\n",
    },
  },
  {
    input: "src/entries/options.ts",
    output: {
      file: "dist/bundled/options.js",
      format: "esm",
      minify: false,
      sourcemap: true,
    },
  },
  {
    input: "src/entries/offscreen.ts",
    output: {
      file: "dist/bundled/offscreen.js",
      format: "esm",
      minify: false,
      sourcemap: true,
    },
  },
  // content is a classic content script (isolated); iife keeps its bindings
  // private and, unlike esm, emits no top-level `export` statements
  {
    input: "src/content/content.ts",
    output: {
      file: "dist/bundled/content.js",
      format: "iife",
      name: "__saveInContent",
      minify: false,
      sourcemap: true,
    },
  },
  // clicktocopy is loaded standalone by the variablelist/clauselist help pages
  // (it auto-applies to `.click-to-copy` elements on load). Isolated → iife.
  {
    input: "src/options/clicktocopy.ts",
    output: {
      file: "dist/bundled/clicktocopy.js",
      format: "iife",
      name: "__saveInClickToCopy",
      minify: false,
      sourcemap: true,
    },
  },
  {
    input: "src/entries/reference-page.ts",
    output: {
      file: "dist/bundled/reference-page.js",
      format: "iife",
      name: "__saveInReferencePage",
      minify: false,
      sourcemap: true,
    },
  },
]);

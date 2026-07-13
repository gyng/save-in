import { defineConfig } from "rolldown";

const backgroundEntry =
  process.env.SAVE_IN_E2E === "1" ? "src/entries/background.e2e.ts" : "src/entries/background.ts";
const bundleDir = process.env.SAVE_IN_E2E === "1" ? "dist/bundled-e2e" : "dist/bundled";

// Store-submission bundler for the TypeScript/ESM codebase (docs/TS-MIGRATION.md).
// Each target has one module under src/entries; rolldown strips the types (oxc), resolves the imports and
// scope-hoists every module into ONE readable, NON-minified file per target — so
// top-level side effects and synchronous MV3 listener registration are preserved,
// while explicit composition calls preserve synchronous listener registration.
//
// Output format is per-target and load-bearing:
//   - background / background.sw / options / offscreen use `esm`: an entry with
//     NO exports emits bare top-level code (no `export` statements), valid as a
//     classic script in the SW / event page / page. The background entry then
//     e2e-only entry installs one explicit command bridge; store builds use the
//     production entry and contain no test-control surface.
//   - content uses `iife`: it runs as a classic content script and is isolated
//     (nothing outside reads its bindings), so a function wrapper is fine; `esm`
//     would emit `export` statements (a syntax error when injected).

export default defineConfig([
  // Firefox event page (has a real window) — loaded via background.scripts
  {
    input: backgroundEntry,
    output: {
      file: `${bundleDir}/background.js`,
      format: "esm",
      minify: false,
      sourcemap: true,
    },
  },
  // Chrome service worker: the same worker-safe module graph.
  {
    input: backgroundEntry,
    output: {
      file: `${bundleDir}/background.sw.js`,
      format: "esm",
      minify: false,
      sourcemap: true,
    },
  },
  {
    input: "src/entries/options.ts",
    output: {
      file: `${bundleDir}/options.js`,
      format: "esm",
      minify: false,
      sourcemap: true,
    },
  },
  {
    input: "src/entries/offscreen.ts",
    output: {
      file: `${bundleDir}/offscreen.js`,
      format: "esm",
      minify: false,
      sourcemap: true,
    },
  },
  // content is a classic content script (isolated); iife keeps its bindings
  // private and, unlike esm, emits no top-level `export` statements
  {
    input: "src/content/content.ts",
    transform: {
      define: {
        SAVE_IN_CONTENT_E2E: JSON.stringify(process.env.SAVE_IN_E2E === "1"),
      },
    },
    output: {
      file: `${bundleDir}/content.js`,
      format: "iife",
      name: "__saveInContent",
      minify: false,
      sourcemap: true,
    },
  },
  {
    input: "src/entries/reference-page.ts",
    output: {
      file: `${bundleDir}/reference-page.js`,
      format: "iife",
      name: "__saveInReferencePage",
      minify: false,
      sourcemap: true,
    },
  },
]);

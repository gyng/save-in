# TypeScript / ESM migration (Level 2)

Converting the classic-script + shared-global codebase to real ESM modules in
TypeScript, shipped via the rolldown bundler. Decision + rationale: ROADMAP §1
Phase B; chosen deliberately over Level 0 (checkJs+JSDoc, done) / Level 1 (.ts
scripts keeping globals).

## Toolchain (proven)

`rolldown` (v1.1.5, already a devDependency) consumes `.ts` ESM modules, strips
types (oxc), resolves `import`s, and **scope-hoists** every module into one
bare-code bundle per target — no IIFE, so top-level side effects and synchronous
MV3 listener registration are preserved. A shared object mutated across a module
boundary now uses named imports; the former `Menus.addDownloadListener = …`
extension idiom was removed after migration.
Output is readable + non-minified (the AMO "reviewable source" property becomes
"reviewable non-minified bundle + documented build").

## Hard constraints

- **A bundle target is all-or-nothing.** A classic (no import/export) file mixed
  into a module bundle does NOT share its top-level `const`s. So each target is
  converted whole, then its bundle switches from the concat plugin to real
  `input` resolution. Targets not yet converted stay on concat.
- **Shipped build must become the bundle.** `.ts` can't run in a browser and
  Firefox's `background.scripts` / a content script can't load a module list.
  So `build` → the bundled package (`build:bundled` already produces + e2e-passes
  a working one).
- **No native `type: module` service worker** — async module load breaks sync
  listener registration (#1 MV3 rule). Always bundle to a classic-scope file.
- **Mutable cross-file state** must become explicit: `currentTab` (now owned by
  `current-tab.ts` and composed by `background-main.ts`),
  `CURRENT_BROWSER`/`CURRENT_BROWSER_VERSION`/`BROWSER_FEATURES` (chrome-detector),
  `options` (option.js), `globalChromeState`. Exported `let` is live but only
  reassignable in its defining module — readers import read-only. Where a reader
  must trigger a change, call an exported setter.
- **`window.*` / `self` globals**: the SW aliases `self.window = self`
  (background.js). Keep using `window.ready`/`window.SI_DEBUG` (they resolve to
  the global); they don't need importing.

## Order (smallest / most isolated first)

1. **content** — `src/content/content.js` (1 file, isolated, no shared globals). Pilot: proves `.ts` → bundle → ship + e2e.
2. **offscreen** — `src/offscreen.js` (1 file).
3. **options** — ~14 files (`src/options/*` + shared `constants`, `chrome-detector`, `web-extension-api`). Cross-file: `OptionsLogic`, `HistoryView`, `PathEditor`, `renderHistory`, …
4. **background** — 24 files, leaf-first (see the dependency contract). The hard one.

## Per-target procedure

1. Convert every file: strip the `if (typeof module !== "undefined") module.exports = X` tail → `export`; every cross-file global read → `import`; add types; rename `.ts`.
2. Add an entry module importing the target's files in load order (for side effects + to force inclusion).
3. Switch that target's `rolldown.config.mjs` bundle from concat → `{ input: entry }`.
4. Fix that target's tests: drop `global.X =` seeding, `await import` the modules directly; `vi.resetModules` where load-order matters.
5. Shrink `.oxlintrc globals` + `types/globals.d.ts` for the now-imported names.
6. Verify: `vitest` for the target + `EXT_DIR=dist/bundled-pkg` e2e (both browsers) once background is done; earlier targets ride the existing bundled e2e.

## Background dependency contract (leaf-first order)

Mapped from the 24 background files. Cross-file reads are ALL call-time (inside
function bodies) — so the cyclic core converts with plain ESM `import`s and
live bindings; NO dependency-injection / lazy-import refactor is needed. No
exported `let` is reassigned from another module → NO setter functions needed.

- **Layer 0** (no cross-file reads): web-extension-api, vendor/content-disposition, chrome-detector, constants, util, session-state, history, counter
- **Layer 1** (reads Layer 0 only): log, download-state, offscreen-client
- **Layer 2 — CYCLIC CORE (one SCC, convert as ONE unit):** path, option, headers, variable, router, notification, download, messaging, menu-build, index. Eval-time reads only target Layer 0 (constants), so the cycle is eval-safe.
- **Layer 3** (downstream of the core): shortcut
- **Layer 4** (sinks — nothing imports them; they EXTEND `Menus`): menu-click, menu-tabs

`menu-click`/`menu-tabs` add methods to the shared `Menus` object (no new
names); `index` must `import "./menu-click.js"` + `"./menu-tabs.js"` (side-effect
imports) so the handlers attach before `index` calls them. Keep `index` last.
`window.*` shared state (`window.ready`/`optionErrors`/`lastDownloadState`/
`SI_DEBUG`) stays on `self` — it's cross-file coupling not expressed as bindings.

## Lessons banked (from the content pilot)

- **Output format is per-target.** A classic content script needs `format: "iife"`
  (an `esm` bundle emits `export` statements → syntax error when injected). The
  **background** bundle must stay bare `esm` (scope-hoisted top-level), because
  the e2e's `evalSW` reaches `Notifier`/`Download`/… as globals on the SW scope —
  an IIFE would hide them. So the background entry will need explicit
  `globalThis.X = X` for the handful the e2e + cross-context code touch.
- **The individual-scripts build is retired from the first `.ts` file** (a `.ts`
  can't be a classic script and the source manifest can't list it). So `build`,
  `lint` (`web-ext lint --source-dir dist/bundled-pkg -i "src/**"`), and
  `e2e:*` now stage + target the bundled pkg. `build:unpacked` / `e2e:source`
  kept for reference. Windows: use `env VAR=val cmd` (git's env.exe), not inline
  `VAR=val` (npm runs scripts via CMD).
- `tsconfig` now includes `src/**/*.ts`.

## Status: ✅ DONE — merged to `mv3`

The migration is complete and merged (fast-forward) to `mv3`. Final gate all
green: `tsc --noEmit` 0 (src + test), `vitest` 742/742, `lint` 0, bundled Chrome
22/22 + Firefox 10/10. All source is ESM/TS; all 33 test files are typed
`.test.ts`; the shipped build is the rolldown bundle. What REMAINS is the
`docs/ARCH-CYCLES.md` backlog (cut the SCC, strict sweep, TS-native, singletons,
remove the test-side globalThis bridge) — none blocking; 4.0.0 is shippable.

The section below is the historical resume-point from during the migration.

## Status / COLD-RESUME POINT (historical)

Work happened on branch **`ts-migration`** (off `mv3`).

### Done + committed (on `ts-migration`)
- **`c748dec`** Phase 1: `content.ts` (iife); `build`/`lint`/`e2e:*` switched to
  the bundled pkg (`dist/bundled-pkg`); `tsconfig` includes `src/**/*.ts`.
- **`2a8b4ed`** all 40 source files → ESM/TS (`module.exports`→`export`, globals→
  imports); per-target entries `src/entry.{background,options,offscreen}.ts`;
  `rolldown.config.mjs` reworked to real module resolution (concat helpers
  deleted). Extracted **`src/current-tab.ts`** as a leaf so nothing imports
  the former `index.ts` composition root (now `background/main.ts`, after the
  SCC was removed).
  VERIFIED: `npm run bundle` clean; bundled **Chrome 22/22 + Firefox 10/10**.

### Done, IN THE WORKING TREE (uncommitted — commit when the suite is green)
- **Typecheck greened 275→0** (Agent A): loose types (`Record<string,any>`, `as`
  casts) re-applying the old globals.d.ts looseness. KEY GOTCHA: **TS ignores
  JSDoc `@type`/`@returns` in `.ts`** (they only work in `.js` under checkJs) —
  every inline JSDoc cast silently broke on rename; fixed with real TS forms.
  `tsconfig`: `module: preserve`, `moduleResolution: bundler`,
  `allowImportingTsExtensions`. `option.ts`: `options: Record<string,any>`.
  VERIFIED typecheck 0 + bundle + Chrome e2e.
- `package.json`: `build`→bundled; `e2e:*` stage bundled + `env EXT_DIR=…`;
  `lint` drops the now-obsolete `check-background-scripts` + `check-globals`.
- **Test correctness refactor DONE + verified** (a subagent): 33 test files
  global-seeding → `vi.mock` (getter-bridge to `globalThis` for live bindings) +
  `.ts`-source imports, still `.test.js`; `vitest.setup.mjs` stripped of the
  obsolete `Util`/`SessionState`/`DownloadState`/`OffscreenClient` seeding
  (`browser`/`chrome` stay ambient). **`vitest run` = 742/742.** Also fixed the
  stale `vitest.config.mjs` coverage `include` (`src/**/*.js`→`.ts`) + include
  glob (`.test.{js,ts}`). Note: `chrome-detector.test.js` referenced accessors
  that never existed in source — adapted to the live bindings.

### Remaining to merge (the integration pass)
1. Verify `vitest run` green (after the correctness refactor lands).
2. **Typed tests (#66):** convert each to proper `.test.ts` + PRUNE over-mocking
   (real imports for pure deps; `vi.fn()` only where spied) + add `test/**` to
   `tsconfig` → green `tsc` AND `vitest`. Update `vitest.config.mjs` include
   (`.test.js`→`.test.ts`). Fan out sonnet (mechanical) + opus (download-flow,
   notification-session, menu-listeners, download-mv3). `.e2e.mjs` +
   `vitest.setup.mjs` + mockserver stay Node ESM.
3. Delete dead **`src/background.js`** (old SW bootstrap; unused by the bundle).
4. Add a **`clicktocopy` bundle** + rewrite `variablelist.html`/`clauselist.html`
   (the only broken help pages — they still `<script src="clicktocopy.js">`).
5. Rewrite the **AGENTS.md** architecture section ("no bundler / shared global
   scope / dual background lists / check-background-scripts" is now historical).
6. **Full gate:** `vitest` + `tsc` (src **and** test) + `lint` + Chrome + Firefox
   e2e, all on the bundled pkg.
7. **Merge `ts-migration` → `mv3`.**

### Bundle facts (load-bearing)
- Formats: background / background.sw / options / offscreen = `esm` (bare
  scope-hoisted; entries have NO exports; `entries/background.ts` does
  `Object.assign(globalThis, {…})` so the e2e's `evalSW` reaches
  `Notifier/Download/Menus/Path/options/…` by bare name). content = `iife`.
- `background.sw.js` gets a `banner: "self.window = self;\n"` (SW has no window).

### Post-migration backlog → `docs/ARCH-CYCLES.md` (tasks #55–68)
Cuts #55–59 (dissolve the SCC) · #61 renameAndDownload · #63 structure · #60
strict · #62 TS-native idioms · #64 runtime validation · #65 tooling (NO
typescript-eslint) · #66 typed tests · #67 PathEditor singleton · #68 singleton
sweep.

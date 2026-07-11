# save-in — agent/contributor guide

A WebExtension that adds a context menu to save media/links/pages into
chosen directories, with pattern-based routing and renaming. Ships to both
Firefox (AMO) and Chrome (Web Store).

## Architecture

**The code is ESM + TypeScript, shipped as a non-minified bundle.** Every
`src/*.ts` is a real ES module using `import`/`export`; `rolldown`
(`rolldown.config.mjs`) transpiles the types and scope-hoists each target into
ONE readable, non-minified file (`dist/bundled/*.js`) — so the shipped output is
still reviewable, but the source has real module boundaries. There is one entry
module per target (`src/entry.{background,options,offscreen}.ts`) that
side-effect-imports its modules in load order; `entry.background.ts` also
re-exposes the objects the e2e's `evalSW` reaches (`Object.assign(globalThis,
{ Notifier, Download, Menus, … })`). `menu-click.ts`/`menu-tabs.ts` `import { Menus }`
from `menu-build.ts` and add methods to that shared object; `index.ts`
side-effect-imports them so the handlers attach before it calls them, and stays
last. The cyclic core (path/option/headers/variable/router/notification/download/
messaging/menu-build/index) has real circular imports that resolve fine because
every cross-module reference is call-time (docs/ARCH-CYCLES.md tracks breaking
that cycle up). Mutable cross-file state is a plain `export let` (`options`,
`currentTab`, `CURRENT_BROWSER`) reassigned only in its own module; readers
observe the live binding. Bundle output format is per-target: `esm` (bare,
scope-hoisted, no `export` statements) for the SW/event-page/options/offscreen
classic contexts; `iife` for the content script + clicktocopy help-page script.

**Build/ship/test all target the bundle** (`dist/bundled-pkg`, staged by
`scripts/build-bundled.js`): `npm run build`, `npm run lint`
(`web-ext lint --source-dir dist/bundled-pkg`), and `npm run e2e:*` all stage +
use it. The old individual-scripts build (`build:unpacked`, `e2e:source`) is
retired. `npm run typecheck` (`tsc --noEmit`) covers `src/**` AND `test/**`.

Execution contexts:

- **Background** (`src/*.js`): menus, download pipeline, messaging hub.
- **Content script** (`src/content/content.js`): runs in every page;
  click-to-save and service-worker prewarming. Has no polyfill — uses
  callback-style `chrome.*` APIs, which work in both browsers.
- **Options page** (`src/options/*`): talks to the background exclusively
  via `runtime.sendMessage` (never `getBackgroundPage()`, which MV3 lacks).

### Single MV3 manifest, two background models

One `manifest.json` (MV3) serves both browsers via dual `background` keys, both
pointing at bundles: Firefox (≥ 121) uses `background.scripts: ["background.js"]`
(an **event page**, real `window`) and ignores `service_worker`; Chrome (≥ 123)
uses `background.service_worker: "background.sw.js"` (same modules, bundled with
a `self.window = self;` banner since the SW has no `window`) and ignores
`scripts`. Both bundles come from the SAME `src/entry.background.ts`; the staged
`dist/bundled-pkg` manifest (via `scripts/build-bundled.js`) points the keys at
the two outputs. Add a background module by importing it from the relevant entry
— there is no hand-maintained file list to keep in sync anymore.

|                 | Firefox (event page)                                                   | Chrome (service worker)                                           |
| --------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Referer feature | `declarativeNetRequest` session rule (`RequestHeaders.prepareReferer`) | same — `declarativeNetRequest` session rule                       |
| Blob downloads  | `URL.createObjectURL` (event pages have DOM)                           | data-URL fallbacks (`Download.makeObjectUrl` / `makeUrlFromBlob`) |

Both browsers set the Referer via a `declarativeNetRequest` session rule
(`RequestHeaders.prepareReferer`, per download): Firefox and Chrome MV3 both
support DNR `modifyHeaders` for the Referer header, so the extension no longer
requests `webRequest`/`webRequestBlocking` at all. (Chrome MV3 forbids blocking
`webRequest` for non-policy extensions anyway; requesting it risks a Web Store
rejection.) Other shared code must **feature-detect, not sniff**:
`URL.createObjectURL` and `browser.storage.session` are probed for presence.
Both lifecycles are non-persistent, so all the service worker rules below apply
to Firefox too.

### MV3 service worker rules (learned the hard way)

1. **Register event listeners synchronously at top level.** A listener added
   inside a `.then()` misses the event that woke the worker. Menu/tab
   listeners are registered top-level in `index.js`; their handlers
   `await window.ready` (the init promise) before touching options or
   `Menus.pathMappings`.
2. **Globals die between events.** Anything needed across wakeups goes to
   storage (via the `SessionState` wrapper, `session-state.js`):
   `Menus.state.lastUsedPath` (storage.local); the per-download records
   (`siDownloads`, keyed by downloadId — retry info, `historyEntryId`, and the
   `adopted` membership flag), the pending-download counter, and the per-URL
   final-filename map (storage.session). `DownloadState` (`download-state.js`)
   owns `siDownloads`: an in-memory `Map` mirror rebuilt from storage by
   `DownloadState.hydrate()` on each wake (awaited in `init`), plus a
   field-union `merge()` so download.js (at `downloads.download` resolution)
   and notification.js (at `onCreated`) converge on one record.
3. **No `URL.createObjectURL`, no DOM, no `window`.** The SW entry aliases
   `self.window = self` so legacy `window.foo` globals keep working.
4. **`chrome.downloads.onDeterminingFilename`** listeners must `return true`
   synchronously to call `suggest()` asynchronously.
5. **Content scripts can outlive a reload** ("extension context
   invalidated") — wrap `runtime.sendMessage` in try/catch, retry on
   failure, and prewarm the worker (`WAKE_WARM` message on combo keydown)
   so clicks don't race SW cold starts.

### Cross-browser gotchas

- Firefox `browser.*` is promise-only (no callbacks); Firefox `chrome.*`
  supports callbacks. Content scripts (no polyfill) therefore use
  callback-style `chrome.*` + `chrome.runtime.lastError` checks.
- There is no polyfill: `src/browser-shim.js` aliases `browser` to `chrome`
  (Chrome ≥ 123 is promise-native everywhere we await, contextMenus
  included). In Chrome-only code paths prefer bare `chrome.*` (e.g. DNR).
- `contextMenus.create` with an `icons` property throws on Chrome — wrapped
  in try/catch in `Menus.addLastUsed`.
- Tab-strip context menus (`contexts: ["tab"]`) are Firefox-only.

## Iteration workflow

| Command                           | What it does                                                                                                                                                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test` / `npm run test:watch` | vitest unit tests (jsdom + jest-webextension-mock via a vi alias); npm run test:coverage enforces 95%-line thresholds on src/ (vendor, options page, SW bootstrap excluded)                                                                                          |
| `npm run lint`                    | web-ext lint (Firefox manifest) + oxlint + oxfmt --check + background file-list sync check                                                                                                                                                                           |
| `npm run typecheck`               | tsc --noEmit with checkJs over all of src/ (shared globals + core typedefs declared in types/globals.d.ts)                                                                                                                                                           |
| `npm run e2e:chrome`              | vitest e2e suite (~15s): isolated Chrome over CDP, drives the real download pipeline — SW lifecycle, CSP, routing rules, messaging, session persistence (e2e/chrome.e2e.mjs)                                                                                         |
| `npm run e2e:firefox`             | vitest e2e suite for Firefox on a throwaway profile via RDP (e2e/firefox.e2e.mjs)                                                                                                                                                                                    |
| `npm run d:chrome`                | dev loop: isolated Chrome + auto restage/reload on file save                                                                                                                                                                                                         |
| `npm run d`                       | web-ext Firefox dev instance                                                                                                                                                                                                                                         |
| `npm run build`                   | alias for `build:bundled` — the store zip (the retired individual-scripts build is `build:unpacked`)                                                                                                                                                                 |
| `npm run bundle`                  | rolldown resolves the `src/entry.*.ts` modules → `dist/bundled/*.js`: one readable, NON-minified scope-hoisted file per target (background + SW, options, offscreen, content, clicktocopy). `esm` (bare) for classic-script contexts, `iife` for content/clicktocopy |
| `npm run build:bundled`           | stage `dist/bundled-pkg` (bundles + a manifest/HTML pointing at them) and zip it for the stores. `build`/`lint`/`e2e:*` all stage + target this                                                                                                                      |

Chrome ≥ 137 ignores `--load-extension`; the scripts load an unpacked copy
(staged by `scripts/stage.js` into `dist/unpacked` — the repo root can't be
loaded directly because node_modules contains `_`-prefixed names Chrome
rejects) via the CDP `Extensions.loadUnpacked` command (needs
`--enable-unsafe-extension-debugging`), see `scripts/lib/chrome.js`. An idle
MV3 service worker is absent from the CDP target list — wake it with a
runtime message first (`scripts/lib/cdp.js` does this). Set `HEADLESS=1`
for CI runs of either e2e suite.

## Testing practices

Work test-first where the change is logic: add/adjust a vitest test in
`test/`, watch it fail (`npm run test:watch`), then implement. Behavior that
spans the real browser (menus, downloads, SW lifecycle) belongs in the e2e
scripts instead — add a test to `e2e/chrome.e2e.mjs` /
`e2e/firefox.e2e.mjs` (vitest, sequential within each file). Both e2e suites must pass before a release; they are the
regression net for the two manifests.

vitest specifics (`test/*.test.ts`, typed; `tsc` covers them):

- `jest-webextension-mock` provides partial `browser`/`chrome` globals; it
  lacks `contextMenus`, download events, and `storage.session` — define
  those per test (see `test/menu-listeners.test.ts`,
  `test/notification-session.test.ts`). `browser`/`chrome` stay ambient host
  globals; only cross-MODULE deps are imported/mocked.
- Tests import the real `.ts` modules and mock deps via `vi.mock` /
  `vi.spyOn`. HISTORICAL WART: many still route mocks through `globalThis` (a
  `vi.mock` getter-bridge that forwards `global.X = …` seeding), typed via the
  `declare var X: any` ambients in `types/globals.d.ts` — being replaced with
  import-real + `vi.spyOn` (docs/ARCH-CYCLES.md). `jest` is aliased to `vi` in
  `test/vitest.setup.mjs`; `test/globals.d.ts` types the test-only ambients.
- Module-reset tests use `vi.resetModules()` + `await import(...)`. vitest jsdom
  provides `URL.createObjectURL`: stub it away to exercise MV3 paths.
- Capture browser event handlers via
  `vi.mocked(browser.x.onY.addListener).mock.calls[0][0]` and invoke them.

## Conventions

- oxfmt (prettier-compatible) + oxlint; `npm run lint:fix` before commit.
- No runtime dependencies; scripts under `scripts/` use Node built-ins only
  (Node ≥ 24, npm).
- Comments explain _constraints_ (why something must be this way — usually
  an MV3/cross-browser rule), not what the code does.
- Version lives in `manifest.json` and `package.json` — bump together.
- TypeScript is `strict: false` for now (the migration used deliberately-loose
  types; `docs/ARCH-CYCLES.md` queues the strict + TS-native sweeps).
  `npm run typecheck` (`tsc --noEmit`) must stay green over `src/**` and
  `test/**`. `types/globals.d.ts` is a shrinking residue of the old shared-global
  era (mostly test-facing ambients now) — prefer real `import`s.
  Runtime globals must not reuse platform class names (that is why they are
  `Notifier`/`RequestHeaders`, not `Notification`/`Headers`).

## Release checklist

1. `npm test && npm run lint && npm run typecheck && npm run e2e:chrome && npm run e2e:firefox`
2. Bump version in `manifest.json` and `package.json`.
3. `npm run build:bundled` (bundled, store-reviewable) or `npm run build`
   (individual scripts) → upload the same zip to AMO and the Chrome Web Store.
   For the bundled build, run both e2e suites against it first:
   `EXT_DIR=dist/bundled-pkg npm run e2e:chrome && EXT_DIR=dist/bundled-pkg npm run e2e:firefox`.
4. Manual spot-check of anything the e2e can't reach: notifications
   rendering, a pixiv Referer download (both browsers, via the shared DNR
   path), options page dialogs.

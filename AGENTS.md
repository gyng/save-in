# save-in — agent/contributor guide

A WebExtension that adds a context menu to save media/links/pages into
chosen directories, with pattern-based routing and renaming. Ships to both
Firefox (AMO) and Chrome (Web Store).

## Architecture

**There is no bundler and no module system in shipped code.** Background
scripts are plain scripts sharing one global scope, loaded in manifest order
(browser-shim first, `index.js` last). Files communicate through globals
(`Menus`, `Download`, `RequestHeaders`, `OptionsManagement`, `options`,
`currentTab`, ...). New cross-file globals must be added to
`.oxlintrc.json` `globals`. Each `src/*.js` ends with a
`if (typeof module !== "undefined") module.exports = ...` block so vitest can
require it in isolation. `menu-click.js`/`menu-tabs.js` extend the `Menus`
object from `menu-build.js` through that shared scope — under vitest, set
`global.Menus` before importing them (see `importMenus` in
`test/menu-listeners.test.js`).

Execution contexts:

- **Background** (`src/*.js`): menus, download pipeline, messaging hub.
- **Content script** (`src/content/content.js`): runs in every page;
  click-to-save and service-worker prewarming. Has no polyfill — uses
  callback-style `chrome.*` APIs, which work in both browsers.
- **Options page** (`src/options/*`): talks to the background exclusively
  via `runtime.sendMessage` (never `getBackgroundPage()`, which MV3 lacks).

### Single MV3 manifest, two background models

One `manifest.json` (MV3) serves both browsers via dual `background` keys:
Firefox (≥ 121) uses `background.scripts` (an **event page**) and ignores
`service_worker`; Chrome (≥ 123) uses `background.service_worker`
(`src/background.js`: `self.window = self` shim + `importScripts` of the
same file list) and ignores `scripts`. Keep the two lists in sync when
adding a background script — `scripts/check-background-scripts.js` (part of
`npm run lint`) fails on drift.

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

| Command                           | What it does                                                                                                                                                                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test` / `npm run test:watch` | vitest unit tests (jsdom + jest-webextension-mock via a vi alias); npm run test:coverage enforces 95%-line thresholds on src/ (vendor, options page, SW bootstrap excluded)                                                                        |
| `npm run lint`                    | web-ext lint (Firefox manifest) + oxlint + oxfmt --check + background file-list sync check                                                                                                                                                         |
| `npm run typecheck`               | tsc --noEmit with checkJs over all of src/ (shared globals + core typedefs declared in types/globals.d.ts)                                                                                                                                         |
| `npm run e2e:chrome`              | vitest e2e suite (~15s): isolated Chrome over CDP, drives the real download pipeline — SW lifecycle, CSP, routing rules, messaging, session persistence (e2e/chrome.e2e.mjs)                                                                       |
| `npm run e2e:firefox`             | vitest e2e suite for Firefox on a throwaway profile via RDP (e2e/firefox.e2e.mjs)                                                                                                                                                                  |
| `npm run d:chrome`                | dev loop: isolated Chrome + auto restage/reload on file save                                                                                                                                                                                       |
| `npm run d`                       | web-ext Firefox dev instance                                                                                                                                                                                                                       |
| `npm run build`                   | one zip for both stores (web-ext), loading the individual source scripts                                                                                                                                                                           |
| `npm run bundle`                  | rolldown → `dist/bundled/*.js`: one readable, NON-minified file per target (background event page + SW, options, offscreen, content). ESM output = bare top-level code, so the classic-script shared global scope is preserved                     |
| `npm run build:bundled`           | stage `dist/bundled-pkg` (bundles + a manifest/HTML pointing at them; secondary pages keep their source scripts) and zip it for the stores. `EXT_DIR=dist/bundled-pkg npm run e2e:chrome` / `e2e:firefox` run the suites against the bundled build |

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

vitest specifics:

- `jest-webextension-mock` provides partial `browser`/`chrome` globals; it
  lacks `contextMenus`, download events, and `storage.session` — define
  those per test (see `test/menu-listeners.test.js`,
  `test/notification-session.test.js`).
- Under vitest, src files are strict-mode ESM: top-level `let` is
  module-scoped, and assigning an undeclared global (fine in the browser
  shared scope) throws unless the test predefines it on `global` —
  seed state through exported functions or registered listeners, not by
  assignment.
- Module-reset tests use `vi.resetModules()` + `await import(...)`; the
  global `jest` is aliased to `vi` in test/vitest.setup.mjs. vitest jsdom
  provides `URL.createObjectURL`: stub it away to exercise MV3 paths.
- Capture browser event handlers via
  `browser.x.onY.addListener.mock.calls[0][0]` and invoke them directly.

## Conventions

- oxfmt (prettier-compatible) + oxlint; `npm run lint:fix` before commit.
- No runtime dependencies; scripts under `scripts/` use Node built-ins only
  (Node ≥ 24, npm).
- Comments explain _constraints_ (why something must be this way — usually
  an MV3/cross-browser rule), not what the code does.
- Version lives in `manifest.json` and `package.json` — bump together.
- Types are check-only (`npm run typecheck`, no build step): every src file
  is checked via `checkJs`; declare new cross-file globals in
  `types/globals.d.ts` and keep the check passing. Avoid inline
  `/** @type */ (…)` casts on parenthesized literals — oxfmt strips the
  parentheses and breaks the cast; prefer typedefs or optional fields.
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

# save-in — agent/contributor guide

A WebExtension that adds a context menu to save media/links/pages into
chosen directories, with pattern-based routing and renaming. Ships to both
Firefox (AMO) and Chrome (Web Store).

## Architecture

**The code is ESM + TypeScript, shipped as a non-minified bundle.** Every
`src/**/*.ts` is a real ES module using `import`/`export`; `rolldown`
(`rolldown.config.mjs`) transpiles the types and scope-hoists each target into
ONE readable, non-minified file (`dist/bundled/*.js`) — so the shipped output is
still reviewable, but the source has real module boundaries. There is one entry
module per target (`src/entries/{background,options,offscreen}.ts`) that
imports its dependencies normally and synchronously calls the background
registration functions. `entries/background.ts` also re-exposes only the narrow
objects the e2e `evalSW` bridge needs. Menu construction/click/tab behavior uses
named imports; `menuState` is the sole shared mutable menu record, and
`background/main.ts` is the composition root. Source is grouped by ownership:
`background`, `config`, `downloads`, `routing`, `platform`, and `shared`, plus
the execution-context directories `options`, `content`, `entries`, and `vendor`.
The import graph is acyclic and
checked by `scripts/check-import-cycles.js`. Mutable cross-file state uses
explicit records or live bindings (`options`, `currentTab`, `CURRENT_BROWSER`)
owned by one module. Bundle output format is per-target: `esm` (bare,
scope-hoisted, no `export` statements) for the SW/event-page/options/offscreen
classic contexts; `iife` for the content script + reference-page controller.

**Build/ship/test all target browser-specific staged bundles**, produced by
`scripts/build-bundled.js`: Chrome uses `dist/bundled-pkg`; Firefox uses
`dist/bundled-pkg-firefox`. `npm run build`, `npm run lint`, and
`npm run e2e:*` stage the matching package. The old individual-scripts build
is retired. `npm run typecheck`
(`tsc --noEmit`) covers `src/**` AND `test/**`.

Execution contexts:

- **Background** (`src/background`, `src/downloads`, `src/config`, and shared
  feature directories): menus, download pipeline, messaging hub.
- **Content script** (`src/content/content.ts`): runs in every page;
  click-to-save and service-worker prewarming. Has no polyfill — uses
  callback-style `chrome.*` APIs, which work in both browsers.
- **Options page** (`src/options/*`): talks to the background exclusively
  via `runtime.sendMessage` (never `getBackgroundPage()`, which MV3 lacks).

Ordinary browser downloads are an explicit opt-in integration. Both browsers
can record matching page/browser-owned downloads in Save In history without
adopting them for retries, prompts, or notifications. Chrome can additionally
route them through its synchronous `downloads.onDeterminingFilename` listener.
Firefox has a separately labelled experimental path that cancels a matching
HTTP(S) download and starts a routed replacement; this can lose POST bodies,
temporary URLs, or special request context. Downloads initiated by Save In or
another extension are excluded. A shared optional WebExtension match-pattern
filter limits both tracking and routing.

### One MV3 source manifest, two staged manifests and background models

The source `manifest.json` (MV3) carries dual `background` keys, both pointing
at bundles: Firefox (≥ 121) uses `background.scripts: ["background.js"]`
(an **event page**, real `window`) and ignores `service_worker`; Chrome (≥ 123)
uses `background.service_worker: "background.sw.js"` (the same worker-safe
modules, without a `window` shim) and ignores
`scripts`. Both bundles come from the SAME `src/entries/background.ts`.
Staging sets Chrome to `incognito: split` and Firefox to `incognito: spanning`;
Firefox otherwise treats the unsupported `split` value as `not_allowed`.
Add a background module by importing it from the relevant entry
— there is no hand-maintained file list to keep in sync anymore.

|                 | Firefox (event page)                         | Chrome (service worker)                                           |
| --------------- | -------------------------------------------- | ----------------------------------------------------------------- |
| Referer feature | Native `downloads.download({ headers })`     | Unsupported                                                       |
| Blob downloads  | `URL.createObjectURL` (event pages have DOM) | data-URL fallbacks (`Download.makeObjectUrl` / `makeUrlFromBlob`) |

Firefox sets the Referer through its native downloads API. Chrome rejects that
header as unsafe and extension-owned downloads do not match DNR request-header
rules. Referer support is therefore Firefox-only.
The extension does not request `webRequest`, `webRequestBlocking`, or DNR.
Other shared code must **feature-detect, not sniff**:
`URL.createObjectURL` and `browser.storage.session` are probed for presence.
Both lifecycles are non-persistent, so all the service worker rules below apply
to Firefox too.

### MV3 service worker rules (learned the hard way)

1. **Register event listeners synchronously at top level.** A listener added
   inside a `.then()` misses the event that woke the worker. Menu/tab
   listeners are registered top-level in `background/main.ts`; their handlers
   await `backgroundRuntime.ready` (the init promise) before touching options or
   `menuState.pathMappings`.
2. **Globals die between events.** Anything needed across wakeups goes to
   storage (via the `SessionState` wrapper, `session-state.ts`):
   `menuState.lastUsedPath` (storage.local); the per-download records
   (`siDownloads`, keyed by downloadId — retry info, `historyEntryId`, and the
   `adopted` membership flag), the pending-download counter, and the per-URL
   final-filename map (storage.session). `DownloadState` (`download-state.js`)
   owns `siDownloads`: an in-memory `Map` mirror rebuilt from storage by
   `DownloadState.hydrate()` on each wake (awaited in `init`), plus a
   field-union `merge()` so `download.ts` (at `downloads.download` resolution)
   and `notification.ts` (at `onCreated`) converge on one record.
3. **No `URL.createObjectURL`, no DOM, no `window`.** Shared background code
   uses worker-safe globals and capability detection; do not add a `window` shim.
4. **`chrome.downloads.onDeterminingFilename`** listeners must `return true`
   synchronously to call `suggest()` asynchronously.
   The ordinary-browser routing branch always does this, awaits initialization,
   and calls bare `suggest()` when disabled, unmatched, or unsuccessful.
5. **Content scripts can outlive a reload** ("extension context
   invalidated") — wrap `runtime.sendMessage` in try/catch, retry on
   failure, and prewarm the worker (`WAKE_WARM` message on combo keydown)
   so clicks don't race SW cold starts.

### Cross-browser gotchas

- Firefox `browser.*` is promise-only (no callbacks); Firefox `chrome.*`
  supports callbacks. Content scripts (no polyfill) therefore use
  callback-style `chrome.*` + `chrome.runtime.lastError` checks.
- There is no polyfill: `src/platform/web-extension-api.ts` selects the host's
  `browser` or `chrome` namespace (Chrome ≥ 123 is promise-native everywhere
  we await, contextMenus included). In Chrome-only code paths prefer bare
  `chrome.*` (e.g. DNR).
- `contextMenus.create` with an `icons` property throws on Chrome — wrapped
  in try/catch in `addLastUsed`.
- Tab-strip context menus (`contexts: ["tab"]`) work on Firefox and Chrome
  150+. Feature-detect `chrome.contextMenus.ContextType.TAB`; Chrome 123–149
  remain supported and simply omit the tab-strip menu.

### Backward compatibility

Preserve backward compatibility unless the task explicitly authorizes a
breaking change. Treat compatibility as part of correctness, not optional
cleanup:

- Continue accepting stored settings and persisted session/local data written
  by older Save In versions. Normalize or migrate legacy shapes at their input
  boundary, retain safe defaults for malformed values, and add regression tests
  before removing a legacy path.
- Preserve established message payloads, import/export configuration formats,
  routing/path syntax, menu identifiers, and user-visible workflows. When an
  internal refactor needs a new shape, adapt at the boundary instead of forcing
  existing callers or profiles to change atomically.
- Keep the declared minimum Firefox and Chrome versions working. Introduce newer
  browser functionality through capability detection and progressive
  enhancement unless a deliberate minimum-version increase is part of the task.
- Content scripts from an older extension instance may remain alive after an
  update. Background message handlers must tolerate stale/legacy callers, and
  content scripts must tolerate a reloaded or unavailable extension context.
- Do not silently reinterpret existing options. If behavior must change, prefer
  an explicit migration with a documented fallback and coverage for both old
  and new states.

## Iteration workflow

| Command                           | What it does                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test` / `npm run test:watch` | vitest unit tests (jsdom + jest-webextension-mock via a vi alias); npm run test:coverage enforces 95%-line thresholds on src/ (vendor, options page, SW bootstrap excluded)                                                                                                                                                                                     |
| `npm run lint`                    | stage the bundle, run web-ext lint against it, then oxlint and oxfmt --check                                                                                                                                                                                                                                                                                    |
| `npm run typecheck`               | checks application source independently against Firefox and Chrome API declarations, then the DOM-free Chrome worker, strict build/config tooling, explicitly isolated legacy JS drivers, and source+test projects. Production source additionally enables `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`.                                         |
| `npm run e2e:chrome`              | vitest e2e suite (~15s): isolated Chrome over CDP, drives the real download pipeline — SW lifecycle, CSP, routing rules, messaging, session persistence (e2e/chrome.e2e.mjs)                                                                                                                                                                                    |
| `npm run e2e:firefox`             | vitest e2e suite for Firefox on a throwaway profile via RDP (e2e/firefox.e2e.mjs)                                                                                                                                                                                                                                                                               |
| `npm run e2e`                     | stages once, then runs the Chrome and Firefox suites in parallel; use `npm run e2e:serial` when diagnosing shared machine-resource issues                                                                                                                                                                                                                       |
| `npm run d:chrome`                | dev loop: isolated Chrome + auto restage/reload on file save                                                                                                                                                                                                                                                                                                    |
| `npm run d`                       | bundled Firefox dev loop with automatic rebuilds and web-ext reloads                                                                                                                                                                                                                                                                                            |
| `npm run build`                   | alias for `build:bundled` — builds the store zip                                                                                                                                                                                                                                                                                                                |
| `npm run bundle`                  | rolldown resolves `src/entries/*.ts` → `dist/bundled/*.js`: one readable, NON-minified scope-hoisted file per target (background + SW, options, offscreen, content, reference page). Store builds use `background.ts`; e2e builds use `background.e2e.ts` to add the test-only command bridge. `esm` is bare for classic contexts; isolated scripts use `iife`. |
| `npm run build:bundled`           | stage `dist/bundled-pkg` for Chrome and `dist/bundled-pkg-firefox` for Firefox, then create one ZIP per store. `build`/`lint`/`e2e:*` target the matching staged package.                                                                                                                                                                                       |

Chrome ≥ 137 ignores `--load-extension`; the scripts load the staged bundled
package from `dist/bundled-pkg` via the CDP `Extensions.loadUnpacked` command (needs
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
  `vi.spyOn`. HISTORICAL WART: some suites still install partial browser mocks
  through `globalThis`; prefer the typed builders in
  `test/webextension-test-helpers.ts`, import-real + `vi.spyOn`, and typed
  listener capture (docs/ARCH-CYCLES.md). `jest` is aliased to `vi` in
  `test/vitest.setup.mjs`; `test/globals.d.ts` types the test-only ambients.
- Module-reset tests use `vi.resetModules()` + `await import(...)`. vitest jsdom
  provides `URL.createObjectURL`: stub it away to exercise MV3 paths.
- Capture browser event handlers via
  `vi.mocked(browser.x.onY.addListener).mock.calls[0][0]` and invoke them.

## Conventions

- oxfmt (prettier-compatible) + oxlint; `npm run lint:fix` before commit.
- When the user asks for repository changes, commit the completed, verified
  work before handing it back unless they explicitly ask to leave it uncommitted.
  Stage only task-related changes when the worktree contains unrelated edits.
- No runtime dependencies; scripts under `scripts/` use Node built-ins only
  (Node ≥ 24, npm).
- Comments explain _constraints_ (why something must be this way — usually
  an MV3/cross-browser rule), not what the code does.
- Version lives in `manifest.json` and `package.json` — bump together.
- TypeScript application source is `strict: true` and checked independently
  against the Firefox and Chrome API declarations. Keep both host projects,
  the DOM-free Chrome worker project, and the combined source/test project
  green. The TS-native sweep remains queued in `docs/ARCH-CYCLES.md`.
  Release-critical build/config scripts are strict; `tsconfig.tools-legacy.json`
  is the explicit migration boundary for the remaining checked-JS and e2e
  drivers. `test/globals.d.ts` contains only test-facing ambients; prefer real
  imports and typed host-boundary helpers.
  Runtime globals must not reuse platform class names (that is why they are
  `Notifier`/`RequestHeaders`, not `Notification`/`Headers`).

## Release checklist

1. `npm test && npm run lint && npm run typecheck && npm run e2e`
2. Bump version in `manifest.json` and `package.json`.
3. `npm run build` → upload the ZIP in `web-ext-artifacts/chrome` to the
   Chrome Web Store and the ZIP in `web-ext-artifacts/firefox` to AMO.
   For AMO, also run `npm run build:source` and attach the resulting source ZIP
   from `web-ext-artifacts/source` so reviewers can reproduce the TypeScript
   build with `npm ci && npm run build`.
   For the bundled build, run both e2e suites against it first:
   `npm run e2e` (it stages each browser's bundled package and runs both suites).
4. Manual spot-check of anything the e2e can't reach: notifications
   rendering, a pixiv Referer download (Firefox via native download headers;
   Firefox), options page dialogs.

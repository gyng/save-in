# save-in — agent/contributor guide

A WebExtension that adds a context menu to save media/links/pages into
chosen directories, with pattern-based routing and renaming. Ships to both
Firefox (AMO) and Chrome (Web Store).

## Architecture

**The code is ESM + TypeScript, shipped as readable, non-minified bundles.**
`rolldown.config.mjs` transpiles and scope-hoists each target into one file under
`dist/bundled/`. Production entries live in `src/entries/` for background,
options, offscreen, and reference-page targets; the content script is bundled
directly from `src/content/content.ts`. `background.e2e.ts` imports the
production background entry and adds the browser-test command only to e2e
builds.

`background/main.ts` is the background composition root. Source is grouped by
ownership under `background`, `config`, `downloads`, `i18n`, `menus`,
`platform`, `routing`, and `shared`, plus the execution-context directories
`content`, `entries`, `options`, and `vendor`. The import graph is acyclic and
checked by `scripts/check-import-cycles.js`. Mutable cross-file state uses
explicit records or owner-controlled live bindings such as `options`,
`currentTab`, and `CURRENT_BROWSER`.

Bundle output is bare, scope-hoisted `esm` for background, options, and
offscreen classic contexts, and `iife` for isolated content and reference-page
scripts.

**Build, ship, and browser tests target the staged bundle** in
`dist/bundled-pkg`. `npm run typecheck` covers source and the TypeScript test
suite with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`.

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

### Single MV3 manifest, two background models

One `manifest.json` (MV3) carries dual `background` keys, both pointing at
bundles: Firefox (≥ 121) uses `background.scripts: ["background.js"]`
(an **event page**, real `window`) and ignores `service_worker`; Chrome (≥ 123)
uses `background.service_worker: "background.sw.js"` (the same worker-safe
modules, without a `window` shim) and ignores
`scripts`. Both bundles come from the SAME `src/entries/background.ts`.
The shared manifest uses `incognito: spanning`. Firefox can associate
extension-started downloads with Private Browsing; Chrome's downloads API has
no Incognito selector, so a Save In download requested there may appear in the
regular Chrome download manager. Save In still excludes private activity from
its own history, restart state, and debug log. Add a background module by
importing it from the relevant entry
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
2. **Globals die between events.** Persist cross-wakeup state through the
   helpers in `shared/session-state.ts`. Last-used menu data lives in
   storage.local; per-download records and transient pending/final-filename
   state use storage.session. `downloads/state.ts` owns the in-memory download
   map; `hydrateDownloads()` rebuilds it at startup and `mergeDownload()`
   combines partial records from the download and notification event paths.
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

- `npm test`, `npm run test:watch`, and `npm run test:coverage`: unit tests;
  coverage enforces the configured source thresholds.
- `npm run lint`: run architecture, CSS, i18n, and release-package policy
  checks; stage and lint the bundle; then run oxlint and formatting checks.
- `npm run typecheck`: check Firefox, Chrome, the DOM-free worker, tooling,
  e2e drivers, and the source/test project.
- `npm run e2e`: stage once and run Chrome and Firefox in parallel. Use
  `e2e:chrome`, `e2e:firefox`, or `e2e:serial` when isolating failures or
  machine-resource issues.
- `npm run d:chrome` and `npm run d`: auto-rebuilding Chrome and Firefox dev
  loops.
- `npm run bundle`: emit readable bundles. `npm run build` also stages and
  packages the shared store ZIP.

Chrome ≥ 137 ignores `--load-extension`; the scripts load the staged bundled
package from `dist/bundled-pkg` via the CDP `Extensions.loadUnpacked` command (needs
`--enable-unsafe-extension-debugging`), see `scripts/lib/chrome.js`. An idle
MV3 service worker is absent from the CDP target list — wake it with a
runtime message first (`scripts/lib/cdp.js` does this). Set `HEADLESS=1`
for CI runs of either e2e suite.

## Testing practices

Test-first is a way to prove meaningful behavior, not a requirement to create
a new test for every edit. Before writing one, identify the regression it would
catch and choose the cheapest durable boundary:

- Add or adjust a unit test for logic, error handling, persistence,
  normalization, or a compatibility contract with a meaningful failure mode.
  Watch it fail before implementing when practical.
- Put a full input/output matrix at the pure function or model boundary. Keep
  handler and integration tests to delegation, lifecycle, persistence, privacy,
  and error containment; do not repeat the same matrix through every layer.
- Test browser-owned behavior such as menus, downloads, and service-worker
  lifecycle in the Chrome/Firefox e2e suites. Prefer one representative
  pipeline smoke test over duplicating lower-level cases end to end.
- Enforce architecture, packaging, configuration, formatting, and generated
  output with `check:*`, lint, typecheck, or build scripts. Do not assert source
  snippets from Vitest when a direct mechanical check can report the violation.
- Do not add bespoke tests for prose, typography, exact colors or contrast,
  class names, sibling placement, incidental item counts, or broad HTML/CSS
  snapshots. Use accessibility audits, visual/manual browser checks, and the
  existing consolidated document contract as appropriate. Test markup only
  when a stable control ID, semantic/ARIA relationship, submitted value, or
  backward-compatible default is the actual contract.
- Coverage is a regression floor, not a target to game. A change that is fully
  checked by an existing test or a mechanical command does not need a token
  test merely for TDD or coverage. Consolidate or delete redundant tests when
  the stronger boundary already covers them.

Both browser suites must pass before release; they are the regression net for
the two manifests.

vitest specifics (`test/*.test.ts`, typed; `tsc` covers them):

- Vitest defaults to the lightweight Node environment. Put
  `// @vitest-environment jsdom` at the top of tests that actually exercise the
  DOM; do not make pure model, protocol, or tooling tests pay for jsdom.
- `test/vitest.setup.ts` installs typed `browser`/`chrome` fixtures from
  `test/webextension-test-helpers.ts`. Replace only the host boundary a test
  exercises; `browser`/`chrome` stay ambient host globals and cross-module
  dependencies are imported or mocked normally.
- Tests import the real `.ts` modules and mock deps via `vi.mock` /
  `vi.spyOn`. Prefer the typed builders in `test/webextension-test-helpers.ts`,
  import-real + `vi.spyOn`, and typed listener capture.
- Module-reset tests use `vi.resetModules()` + `await import(...)`. In jsdom
  tests, stub away `URL.createObjectURL` to exercise MV3 paths.
- Compile-only API relationships belong in `test/type-contracts.ts`; do not
  wrap `expectTypeOf` assertions in runtime tests.
- Capture browser event handlers via
  `vi.mocked(browser.x.onY.addListener).mock.calls[0]![0]` and invoke them.

## Conventions

- oxfmt (prettier-compatible) + oxlint; `npm run lint:fix` before commit.
- UI copy must be concise, concrete, and action-oriented. Use sentence case for headings,
  labels, and buttons; name the user-visible outcome rather than the implementation; avoid
  jargon, idioms, unnecessary punctuation, and text assembled from translated fragments.
- Keep terminology consistent across settings, menus, notifications, help text, and
  accessibility labels. Give translators enough context in message descriptions when a label
  is ambiguous, preserve placeholders exactly, and write complete strings that allow languages
  to reorder words naturally. Accessible names must communicate the same action as visible copy.
- English is the canonical i18n key schema and the only browser-native catalog. Generated catalogs
  stay outside `_locales`: they are opt-in, clearly labelled in the language selector, bundled
  locally without runtime AI or network access, and fall back to English for missing messages. Add
  or update the `check:i18n` catalog/runtime-key policy when UI copy changes.
- When the user asks for repository changes, commit the completed, verified
  work before handing it back unless they explicitly ask to leave it uncommitted.
  Stage only task-related changes when the worktree contains unrelated edits.
- No extension runtime dependencies. Build tooling targets Node ≥ 24 and uses
  JSZip only to canonicalize `web-ext` archives for reproducible bytes.
- Editable SVG masters live under `assets/icons/` and are included only in the
  Mozilla source attachment. Regenerated runtime rasters belong under `icons/`.
- Comments explain _constraints_ (why something must be this way — usually
  an MV3/cross-browser rule), not what the code does.
- Version lives in `manifest.json` and `package.json` — bump together.
- TypeScript application source is `strict: true` and checked independently
  against the Firefox and Chrome API declarations. Keep both host projects,
  the DOM-free Chrome worker project, and the combined source/test project
  green. Release-critical build/config scripts, browser-control tooling, and
  e2e drivers are checked in separate strict projects. Prefer real imports and
  typed host-boundary helpers in tests.
  Runtime globals must not reuse platform class names (that is why they are
  `Notifier`/`RequestHeaders`, not `Notification`/`Headers`).

## Release checklist

Read [docs/RELEASE.md](docs/RELEASE.md) when preparing a release or changing
release automation, provenance, screenshots, or browser-owned checks.

1. `npm test && npm run lint && npm run typecheck && npm run e2e`
2. Bump version in `manifest.json` and `package.json`.
3. Run `npm run build` and `npm run build:source`. Upload the same runtime ZIP
   to both stores and attach the source ZIP in AMO.

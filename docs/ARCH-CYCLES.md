# Post-migration: breaking the 10-file dependency cycle

The ESM migration makes the dependency graph explicit but does NOT untangle it —
the 10-file strongly-connected component (path, option, headers, variable,
router, notification, download, messaging, menu-build, index) survives as real
circular imports. They're eval-safe (all cross-refs are call-time), so they
*work*, but the cycle is the deeper architecture smell. This queues the cuts.

**Do these AFTER the migration lands** (imports must be explicit to see the
edges), and validate each hypothesis against the actual converted imports —
the notes below are derived from the pre-migration global-reference contract.

Two hubs bind the cycle: **`download`** (read by notification, variable, router,
messaging, option) and **`options`** (read by path, headers, menu-build,
download, notification, messaging, index). Cut the back-edges into those two and
the SCC largely dissolves.

## Cut 1 — split `options` DATA from `OptionsManagement` LOGIC  ⬅ highest leverage

`option.js` bundles the config *data bag* (`options`, a leaf everyone reads)
with the load/save/validate *logic* (`OptionsManagement`, whose `onLoad`/`onSave`
validators + defaults reference `Router`, `Variable`, `Path`, `Download`,
`CLICK_TYPES`, `SHORTCUT_TYPES`). That mix is why `option ↔ path`,
`option ↔ download`, and the indirect `headers`/`menu-build` cycles exist.

- **Break:** move `options` into its own tiny module (just the mutable config
  object + `setOption`) with no cross-module deps. Keep `OptionsManagement`
  (validators/loaders) separate and downstream — it may depend on
  Router/Variable/Path/Download freely because nothing those touch reads it.
- **Unblocks:** `path`, `headers`, `menu-build`, `download`, `notification`,
  `messaging` now read only the `options` leaf → their edge into `option`
  disappears.

## Cut 2 — extract content fetch+hash out of `download`

`variable → download` exists ONLY for `Download.resolveContent` (the
`:sha256:` fetch-once-and-digest path). `download → variable` is
`Variable.applyVariables`.

- **Break:** move `resolveContent` (+ `HASH_MAX_BYTES`/`HASH_FETCH_TIMEOUT_MS`,
  and possibly `makeUrlFromBlob`) into a `content-fetch` module that depends on
  `OffscreenClient`. `variable` and `download` both import *it*, not each other.
- **Unblocks:** `variable ↔ download` cut.

## Cut 3 — make download's "downloaded" emit an event, not a Messaging import

`download → messaging` is only `Messaging.emit.downloaded(...)`.
`messaging → download` is genuine (`handleDownloadMessage` calls
`renameAndDownload`).

- **Break:** introduce a tiny event bus (or a registered callback) for the
  "downloaded" signal so `download` doesn't import `messaging`. Then
  `messaging → download` is a clean one-way edge.
- **Unblocks:** `download ↔ messaging` cut.

## Cut 4 — notification reads DownloadState/retry seam, not `download`

`notification → download` is `Download.getStartedDownload` (already a thin
delegation to `DownloadState` — point notification at `DownloadState` directly)
and `Download.retryViaFetch` (notifier triggers a retry).

- **Break:** read records via `DownloadState`; for the retry, either move the
  retry decision to a small module both import, or have `download` register a
  retry handler the notifier invokes (dependency inversion).
- **Unblocks:** `download ↔ notification` cut.

## Cut 5 — investigate `router → download`

`router` reads `Download` (and `currentTab`). Confirm why (a matcher? logging?).
Likely removable or invertible once the imports are explicit.

## Expected result

After Cuts 1–4, `download` still depends on many modules but few depend back on
it, and `options` is a clean leaf. The SCC should collapse to a short chain (or
dissolve), giving real layering: constants/util → options(data) → path/variable/
router/headers → download/notification → messaging → menus → index. Then
`strict: true` and further decomposition become straightforward.

Sequence: **Cut 1 first** (dissolves the most edges), then 2 → 3 → 4, re-checking
the SCC after each (a quick `madge`/import-graph pass). Each cut is independently
testable once tests are on real imports.

## Also queued (not cycle-related, but same neighbourhood)

- **Decompose `download.renameAndDownload` — DONE.** The orchestrator now runs
  explicit RESOLVE (path/route/filename/MIME plan) → ACQUIRE-URL (direct /
  fetch-fallback / offscreen / shared `:sha256:` content) → DOWNLOAD
  (`downloads.download` + bookkeeping) stages with typed plan values. (Task
  #61.)
- **`strict: true` sweep — DONE** — completed through staged `noImplicitAny`,
  `strictNullChecks`, and full-strict passes after the dependency cuts. (Task
  #60.)
- **TS-native pass** (do LAST) — the migration is a *straight* conversion that
  keeps the classic namespace-object idiom + loose types. Make it idiomatic:
  discriminated-union message protocol, `SaveInOptions` from OPTION_KEYS, real
  interfaces for the record/pipeline/rule shapes, named function exports for pure
  collections (Util/HistoryView/OptionsLogic), explicit functional state records
  (DownloadsState/SessionWriteState/CounterWriteState), `as const` literal-union type maps, and
  delete the `typeof X === "undefined"` guards + residual globals.d.ts. (Task #62.)
  - ✅ `Util` namespace/global removed; `withUrl` and `splitLines` are named
    functional exports imported directly by their consumers.
  - ✅ `OptionsLogic` namespace removed; options-page code imports its two
    DOM-free functions directly.
  - ✅ `HistoryView` namespace removed; history formatting, row projection,
    columns, and pagination are named exports.
  - ✅ Shared constant maps are `as const` and export their value unions;
    routing clauses now carry `RuleType` instead of an unconstrained string.
- **TS-native organization/structure** — the structural axis: group files by
  layer/feature (src/platform, src/core, src/download, src/routing, src/menus,
  src/messaging — reflecting the post-cut layering), modernize tsconfig
  (`moduleResolution: "bundler"`, `module: "esnext"`, `verbatimModuleSyntax`,
  `isolatedModules`), settle the import-specifier convention, filename ↔
  primary-export, entry `index.ts` → `main.ts`, and decide test co-location.
  Do the directory reorg in ONE pass after the cuts settle the layering. (Task #63.)
- **Runtime validation at trust boundaries** — TS erases at runtime, but
  `onMessageExternal` (any extension), storage reads, and imported config are
  untrusted. Small dependency-free type-guards that narrow `unknown` → the typed
  shape at those boundaries (no zod — no-runtime-deps rule). After the message
  union (#62). (Task #64.)
- **Defer module import-time side effects** (Task #2): ✅ DONE. The background
  modules ran their side effects at MODULE EVAL, so importing them in a test
  triggered them. Each is now an explicit exported function `entry.background.ts`
  calls synchronously at startup (registration stays synchronous — MV3 rule #1 —
  because the entry is the bundle's synchronous top-level code; verified by both
  e2e suites):
  - `messaging.ts` → `registerMessaging()` (onMessage + onMessageExternal)
  - `notification.ts` → `registerNotifier()` (downloads.onCreated/onChanged,
    notifications.onClicked); the `DownloadState.hydrate()` is still in
    `window.init`, now run via `start()`.
  - `download.ts` → `registerDownloadListener()` (downloads.onDeterminingFilename)
  - `index.ts` → `start()` (menu/tab listeners, `window.ready = init()`, tabs.query)
  - `option.ts` → `seedOptions()` (the OPTION_KEYS defaults; loadOptions overlays
    storage onto them, so the entry seeds before init). The options page has its
    own option handling, so only `entry.background` seeds.

  Payoff: modules are import-side-effect-free, so tests import them real and call
  the register/seed fn explicitly. Removed the messaging `vi.mock`s from
  download-flow + download-mv3 (the last one download-mv3 kept), and converted
  headers.test + notification.test off their `option`/`Log` globalThis bridges to
  import-real — 0 globalThis module-value bridges remain in the suite. Tests that
  capture a registered listener call the register fn after import; path.test +
  option.test seed defaults explicitly. `web-extension-api` selects the native
  `browser` namespace or Chrome's namespace without mutating `globalThis`.
- **Source refinements surfaced by the test migration** (Task #3): ✅ (a)+(b)
  DONE; (c)/(d) fold into #60/#62 as noted below.
  - (a) ✅ `Counter.next`/`peek` were typed `Promise<void>` but resolve to a
    number (the shared `writeQueue: Promise.resolve()` field's `Promise<void>`
    erased the count `opts.counter = await Counter.next()` awaited). Fixed:
    `next` returns the freshly-chained `Promise<number>` (not the shared field,
    now `Promise<unknown>`); `next`/`peek` annotated `Promise<number>`.
  - (b) ✅ Added `chrome-detector.setCurrentBrowser(browser)` — the write-half of
    the `CURRENT_BROWSER`/`BROWSER_FEATURES` live bindings (they always move
    together). The load-time detection block now calls it, so it is production
    code, not a test backdoor. `download-flow.test` converted from its
    hoisted-holder `vi.mock` to import-real + `setCurrentBrowser` (46 flip
    sites). `option`/`notification-session` keep their holder-mocks: both
    `resetModules` + re-import their SUT per test, so a fresh chrome-detector
    binds each test and the holder is the stable control point (re-grabbing the
    setter every re-import is strictly more plumbing). `menu.test` keeps its
    mock: it forces `BROWSER_FEATURES` to `{accessKeys:false}` and `undefined` —
    defensive states `setFeatures` cannot produce. Also typed `BrowserFeatures`
    and `CURRENT_BROWSER_VERSION`.
  - (c) `Log` is already properly typed (not `any` — its self-refs are in method
    bodies, lazily typed, so no TS7022). `Menus` IS `any`, but because
    `menu-click`/`menu-tabs` extend it via `Menus.x = …` (only legal on `any`);
    fixing needs the full `Menus` interface incl. those members → folded into #62
    (and dovetails with the #68 singleton sweep).
  - (d) `shortcut.makeShortcutContent` `title` optional is one lone param
    annotation in an otherwise-untyped file → folded into the #60 strict sweep.
- **Fix flaky tests** — (1) Chrome e2e "shortcut files download with redirect
  content" (download-timing race — waitFor the settled file/history, not a fixed
  sleep); (2) path-editor unit "switching to visual…/back…" (~1/12 flake from the
  shared PathEditor singleton — likely falls out of #67, else reset the singleton
  per test). Neither is a correctness bug but both undermine the green gate. (Task #69.)
- **TS tooling/CI hardening** — browser-only source typechecking (no Node/Vitest
  globals) plus the combined source+test check are now in place. Remaining:
  `expectTypeOf` contract tests, finer per-context `lib` (SW=webworker vs DOM),
  sourcemaps. **NO
  typescript-eslint** (decided — stay oxlint-only); the tradeoff is no
  `no-floating-promises`, so guard unawaited promises by `void` convention +
  review, not lint. NOT: TS-ifying scripts/*.mjs, .d.ts emit, path aliases. (Task #65.)
- **CI/CD + build attribution/provenance** (Task #69) — design task, mostly
  greenfield on top of what exists. Today: `.github/workflows/ci.yml` runs the
  gate (`build`+`lint`+`typecheck`+`test`) and both headless e2e, but ONLY on
  `master` — so `mv3` and feature branches get no CI until they merge up.
  `scripts/write-version.js` stamps `src/options/version.json` (short commit +
  date) into the options-page UI, but it's gitignored build metadata and uses
  `new Date()` — informational, not provenance, and not reproducible. Release +
  version bump + store upload are all manual (AGENTS.md checklist). Think about:
  - **CI coverage**: run on `mv3`/PRs too (or all branches), not just `master`;
    confirm the e2e job exercises the SAME `dist/bundled-pkg` artifact the store
    gets (the checklist wants `EXT_DIR=dist/bundled-pkg`), and that the runner's
    Chrome CDP `--enable-unsafe-extension-debugging` path (Chrome ≥ 137, see
    [[chrome-load-extension-removed]]) + web-ext Firefox both work headless there.
    Upload the built zip as a CI artifact for inspection.
  - **CD/release**: tag-triggered — `build:bundled` zip → GH release asset →
    optional AMO submit (`web-ext sign`, script already present) + Chrome Web
    Store API. Gate on manifest.json ↔ package.json version parity (add a check —
    they must bump together; write-version's stamp is a separate file, not the
    store version). Run both bundled e2e against the exact artifact first.
  - **Attribution/provenance**: add real provenance — GitHub artifact attestation
    / SLSA (`actions/attest-build-provenance`) on the store zip, tying it to the
    commit + workflow run. Make `build:bundled` DETERMINISTIC (pinned Node +
    `npm ci` → byte-stable zip from a commit); hunt the non-determinism sources
    (`new Date()` in write-version, zip mtimes/entry order in web-ext build).
    Write the AMO reviewer-facing BUILD doc: exact steps to reproduce the
    non-minified scope-hoisted `dist/bundled/*.js` from `src/**` (the "reviewable
    non-minified bundle + documented build" property, docs/TS-MIGRATION.md), and
    how the hoisted bundle maps back to modules. Independent of the TS backlog;
    complements #65's CI hardening.
- **Singleton sweep** — ✅ DONE for state ownership. `PathEditor` is now an
  instantiable class because each editor owns DOM state. Background persistence
  uses the data-only `BackgroundState` composition record plus functional
  `DownloadsState`, `SessionWriteState`, and `CounterWriteState`; no service
  classes or compatibility facades remain. Pure namespace collections
  (`Util`, `Path`, `Router`, `Variable`) can become named exports during #62.
  `Menus` still needs a real interface when its cross-module extension idiom is
  dissolved.

# Post-migration: breaking the 10-file dependency cycle

**Status: COMPLETE.** The source import graph is acyclic and lint enforces that
invariant with `scripts/check-import-cycles.js`.

The ESM migration originally exposed a 10-file strongly-connected component
(path, option, headers, variable, router, notification, download, messaging,
menu-build, index). The sections below preserve the rationale and completion
record for the cuts that removed it.

**Do these AFTER the migration lands** (imports must be explicit to see the
edges), and validate each hypothesis against the actual converted imports —
the notes below are derived from the pre-migration global-reference contract.

Two hubs bind the cycle: **`download`** (read by notification, variable, router,
messaging, option) and **`options`** (read by path, headers, menu-build,
download, notification, messaging, index). Cut the back-edges into those two and
the SCC largely dissolves.

## Cut 1 — split `options` DATA from `OptionsManagement` LOGIC — DONE

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

## Cut 2 — extract content fetch+hash out of `download` — DONE

`variable → download` exists ONLY for `Download.resolveContent` (the
`:sha256:` fetch-once-and-digest path). `download → variable` is
`Variable.applyVariables`.

- **Break:** move `resolveContent` (+ `HASH_MAX_BYTES`/`HASH_FETCH_TIMEOUT_MS`,
  and possibly `makeUrlFromBlob`) into a `content-fetch` module that depends on
  `OffscreenClient`. `variable` and `download` both import *it*, not each other.
- **Unblocks:** `variable ↔ download` cut.

## Cut 3 — make download's "downloaded" emit an event, not a Messaging import — DONE

`download → messaging` is only `Messaging.emit.downloaded(...)`.
`messaging → download` is genuine (`handleDownloadMessage` calls
`renameAndDownload`).

- **Break:** introduce a tiny event bus (or a registered callback) for the
  "downloaded" signal so `download` doesn't import `messaging`. Then
  `messaging → download` is a clean one-way edge.
- **Unblocks:** `download ↔ messaging` cut.

## Cut 4 — notification reads DownloadState/retry seam, not `download` — DONE

`notification → download` is `Download.getStartedDownload` (already a thin
delegation to `DownloadState` — point notification at `DownloadState` directly)
and `Download.retryViaFetch` (notifier triggers a retry).

- **Break:** read records via `DownloadState`; for the retry, either move the
  retry decision to a small module both import, or have `download` register a
  retry handler the notifier invokes (dependency inversion).
- **Unblocks:** `download ↔ notification` cut.

## Cut 5 — remove `router → download` — DONE

`router` reads `Download` (and `currentTab`). Confirm why (a matcher? logging?).
Likely removable or invertible once the imports are explicit.

## Result

`options-data` and `option-schema` are leaves; content fetch, download events,
retry, and download state are explicit seams. The former SCC dissolved into an
acyclic dependency graph, `strict: true` is enabled, and each lint run checks the
graph rather than relying on a one-time audit.

## Follow-on work completed in the same architecture pass

- **Decompose `download.renameAndDownload` — DONE.** The orchestrator now runs
  explicit RESOLVE (path/route/filename/MIME plan) → ACQUIRE-URL (direct /
  fetch-fallback / offscreen / shared `:sha256:` content) → DOWNLOAD
  (`downloads.download` + bookkeeping) stages with typed plan values. (Task
  #61.)
- **`strict: true` sweep — DONE** — completed through staged `noImplicitAny`,
  `strictNullChecks`, and full-strict passes after the dependency cuts. (Task
  #60.)
- **TS-native pass — DONE** (Task #62).
  - ✅ `Util` namespace/global removed; `withUrl` and `splitLines` are named
    functional exports imported directly by their consumers.
  - ✅ `OptionsLogic` namespace removed; options-page code imports its two
    DOM-free functions directly.
  - ✅ `HistoryView` namespace removed; history formatting, row projection,
    columns, and pagination are named exports.
  - ✅ Shared constant maps are `as const` and export their value unions;
    routing clauses now carry `RuleType` instead of an unconstrained string.
  - ✅ `Path` remains a legitimate mutable-value class; its segment class and
    namespace facade are gone. `Router` and `Variable` expose named functions.
  - ✅ Menu behavior is composed through named imports; only the data-only
    `menuState` record is shared. No module monkey-patches a `Menus` object.
  - ✅ `OPTION_KEYS` lives in a leaf schema module and derives `SaveInOptions`;
    the stable options bag and production consumers use that type.
  - ✅ Internal/external messages are discriminated unions with body guards.
    Pipeline, routing, state, and event seams have concrete types.
  - ✅ Imported-module `typeof X === "undefined"` guards are removed. Host
    augmentations live in `types/platform.d.ts`; the migration-era
    `types/globals.d.ts` is gone.
- **TS-native organization/structure — DONE** — the structural axis considered
  grouping files by
  layer/feature (src/platform, src/core, src/download, src/routing, src/menus,
  src/messaging — reflecting the post-cut layering), modernize tsconfig
  (`moduleResolution: "bundler"`, `module: "esnext"`, `verbatimModuleSyntax`,
  `isolatedModules`), settle the import-specifier convention, filename ↔
  primary-export, composition-root naming, and decide test co-location. (Task #63.)
  - ✅ The compiler settings are modernized: ESM + bundler resolution,
    `verbatimModuleSyntax`, and `isolatedModules`. Relative source imports keep
    their explicit `.ts` suffix; rolldown owns rewriting them into bundles.
  - ✅ `index.ts` is now the explicit `background-main.ts` composition root;
    the actual bundle entry remains `entry.background.ts`.
  - **Decision:** keep root feature modules and centralized `test/`. A broad
    directory/co-location move would rewrite imports and reviewer sourcemap
    paths without enforcing layers or changing the bundled runtime. Existing
    `src/options`, `src/content`, and `src/vendor` boundaries already identify
    the contexts where directories add information.
- **Runtime validation at trust boundaries — DONE** (Task #64). Dependency-free
  guards validate internal/external message bodies and Chrome offscreen
  requests/responses. External download metadata is allowlisted before entering
  pipeline state. Storage values fall back per schema entry, `APPLY_CONFIG`
  rejects unknown/type-invalid/schema-invalid values, and pasted JSON must be an
  object and passes through that same validated boundary.
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
  - `background-main.ts` → `start()` (menu/tab listeners, `window.ready = init()`, tabs.query)
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
- **Source refinements surfaced by the test migration — DONE** (Task #3).
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
  - (c) ✅ `Log` is typed, and the former `Menus` extension object was replaced
    by named functions plus the typed `menuState` data record.
  - (d) `shortcut.makeShortcutContent` `title` optional is one lone param
    annotation in an otherwise-untyped file → folded into the #60 strict sweep.
- **Fix flaky tests — DONE.** Chrome shortcut coverage polls download history
  until the matching item is complete before reading it. `PathEditor` owns its
  callback per instance, each test constructs a fresh editor, and the isolation
  regression passed 25 repeated focused runs without a failure. (Task #69.)
- **TS tooling/CI hardening — DONE** (Task #65). Browser-only source typechecking
  (no Node/Vitest globals) plus the combined source+test check are in place.
  `expectTypeOf` locks down
  pipeline stages, routing clauses, and functional state records; every bundle
  emits an external sourcemap. A narrower background `lib` is deliberately not
  useful: the same entry is both a Firefox DOM event page and a Chrome worker,
  and its capability branches are runtime feature-detected. Splitting the type
  environment would describe neither shared execution target faithfully. **NO
  typescript-eslint** (decided — stay oxlint-only); the tradeoff is no
  `no-floating-promises`, so guard unawaited promises by `void` convention +
  review, not lint. NOT: TS-ifying scripts/*.mjs, .d.ts emit, path aliases. (Task #65.)
- **CI/CD + build attribution/provenance — DONE** (Task #69). CI runs the
  complete gate for every branch push and pull request, retains the store ZIP,
  and runs both browser suites through the shared parallel staging command.
  Tag releases validate version parity, derive deterministic source metadata,
  build runtime + reviewer source archives, checksum and attest them, and create
  a draft GitHub Release. Store submission remains an intentional manual review
  step. Release metadata comes from the tagged commit, source/runtime archives
  and checksums use stable public names, and reviewer reproduction steps live in
  `docs/STORE-SUBMISSION.md`.
- **Singleton sweep** — ✅ DONE for state ownership. `PathEditor` is now an
  instantiable class because each editor owns DOM state. Background persistence
  uses the data-only `BackgroundState` composition record plus functional
  `DownloadsState`, `SessionWriteState`, and `CounterWriteState`; no service
  classes or compatibility facades remain. Pure namespace collections and the
  cross-module `Menus` extension object were removed during #62.

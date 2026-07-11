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

- **Decompose `download.renameAndDownload`** (~240-line async god-function with
  nested `download`/`fetchDownload`/`normalDownload`/`browserDownload` closures
  that capture shared state). Split into RESOLVE (path/route/filename/MIME plan)
  → ACQUIRE-URL (explicit strategy: direct / fetch-fallback / offscreen /
  contentPromise-for-`:sha256:`) → DOWNLOAD (the `downloads.download` call +
  bookkeeping) stages, converting the closures to methods that take an explicit
  plan param. Best done after Cuts 2–3 slim download's surface. (Task #61.)
- **`strict: true` sweep** — `noImplicitAny` → `strictNullChecks` → full strict,
  replacing the deliberately-loose `any`s the migration used. Per-flag, not all
  at once; layering (the cuts) first makes the types cleaner. (Task #60.)
- **TS-native pass** (do LAST) — the migration is a *straight* conversion that
  keeps the classic namespace-object idiom + loose types. Make it idiomatic:
  discriminated-union message protocol, `SaveInOptions` from OPTION_KEYS, real
  interfaces for the record/pipeline/rule shapes, named function exports for pure
  collections (Util/HistoryView/OptionsLogic), classes for stateful singletons
  (DownloadState/SessionState/Counter), `as const` literal-union type maps, and
  delete the `typeof X === "undefined"` guards + residual globals.d.ts. (Task #62.)
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
- **TS tooling/CI hardening** — typecheck `test/**`, `expectTypeOf` contract
  tests, per-context `lib` (SW=webworker vs DOM), sourcemaps. **NO
  typescript-eslint** (decided — stay oxlint-only); the tradeoff is no
  `no-floating-promises`, so guard unawaited promises by `void` convention +
  review, not lint. NOT: TS-ifying scripts/*.mjs, .d.ts emit, path aliases. (Task #65.)

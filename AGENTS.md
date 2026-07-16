# save-in — agent/contributor guide

A WebExtension that adds a context menu to save media/links/pages into
chosen directories, with pattern-based routing and renaming. Ships to both
Firefox (AMO) and Chrome (Web Store).

## Architecture

**The code is ESM + TypeScript, shipped as readable, non-minified bundles.**
`config/rolldown.config.mjs` transpiles and scope-hoists each target into one file under
`dist/bundled/`. Production entries live in `src/entries/` for background,
options, offscreen, and reference-page targets; the content script is bundled
directly from `src/content/content.ts`. `background.e2e.ts` imports the
production background entry and adds the browser-test command only to e2e
builds.

`background/main.ts` is the background composition root. Source is grouped by
ownership under `automation`, `background`, `config`, `downloads`, `i18n`,
`menus`, `platform`, `routing`, and `shared`, plus the execution-context
directories `content`, `entries`, `offscreen`, `options`, and `vendor`. The
import graph is acyclic and
checked by `scripts/check-import-cycles.js`. Mutable cross-file state uses
explicit records or owner-controlled live bindings such as `options`,
`currentTab`, and `CURRENT_BROWSER`.

Bundle output is bare, scope-hoisted `esm` for background, options, and
offscreen classic contexts, and `iife` for isolated content and reference-page
scripts.

Options CSS is rooted at `src/options/style.css`, which declares the supported
cascade-layer order and imports ownership-oriented `style-*.css` files. Keep
production CSS as separate, readable source files; do not concatenate or
minify it into a generated production stylesheet. Keep feature rules with their
owner, preserve the declared layer order, and use the final utilities layer for
cross-feature state such as `[hidden]`. Use logical properties and
`text-align: start/end`, component container queries for owned workspace
responsiveness, and dynamic viewport-height units. All options boxes inherit
`border-box`; use semantic `--z-*` tokens instead of numeric `z-index`, contain
nested scroll surfaces, and preserve visible states in forced-colors mode.
The main options tabstrip must wrap at every viewport width and must never be a
horizontal or vertical scroll container; `scripts/check-css.js` enforces this.
Native nesting is allowed for short state/pseudo-element groups; do not build
deeply nested selector trees or create catch-all override stylesheets.
`@scope` is documented as a future migration in `docs/UI.md`; `scripts/check-css.js`
rejects it outright while Firefox 121 remains supported.

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
- **Offscreen document** (`src/offscreen/offscreen.ts`, `src/offscreen.html`):
  Chrome-only. Lends the service worker a DOM so a fetched download becomes a
  blob object URL instead of a base64 data URL; it also hashes the same bytes
  and runs Prompt API calls.

The on-device rule assistant asks Gemini Nano for the facts of a request under a
response schema and assembles the rule text itself; it never asks the model to
write routing syntax, which it cannot do. Read
[docs/ON-DEVICE-PROMPT.md](docs/ON-DEVICE-PROMPT.md) before changing the prompts,
the response schemas, or the guardrails: what governs this model is measured
there, and prefer a schema change to a sentence — a sentence has never moved it.
Nothing reaches the rules editor until the deterministic guardrails, the
background `VALIDATE`, and the review all agree.

Automatic Page Sources saves reuse the normal `filenamePatterns` routing
language and editor. Eligibility is deliberately narrower than ordinary
routing: `routing/automatic-rule.ts` recognizes only rules with an explicit
`context` pattern for the synthetic `AUTO` context, plus at least one page
matcher and one source matcher. `automation/automatic-routing.ts` ignores all
other routing rules and selects the first eligible match. The content script
discovers previewable HTTP(S) sources and sends candidates to the background;
the background repeats rule matching before launching the download. Global
enable/live/private/per-page controls remain content options. The legacy
`autoDownloadRules` schema entry stays readable for imports and stored-profile
migration, but valid legacy rules are converted into `filenamePatterns` at the
configuration boundary. Do not add a second automation-rule grammar or editor.

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

|                 | Firefox (event page)                                      | Chrome (service worker)                                   |
| --------------- | --------------------------------------------------------- | --------------------------------------------------------- |
| Referer feature | Scoped DNR metadata/content; native direct final download | Scoped DNR metadata/content fetches, then a blob download |
| Blob downloads  | `URL.createObjectURL` (event pages have DOM)              | data-URL fallbacks (`makeObjectUrl` / `makeUrlFromBlob`)  |

Both browsers temporarily set the Referer on each exact extension-owned HEAD/GET
needed for requested lazy metadata or hashes. The rule covers the exact requested
URL plus up to three exact URLs the server redirected that request to (a failed
redirected hop extends the rule and refetches; any refused extension degrades to
the unextended rule). Firefox still sets it natively on
a direct final `downloads.download` request; if hashing fetched the content, that
blob is reused instead. Chrome rejects the header on `downloads.download`, so its
final acquisition is also protected by DNR and passed to the downloads API as a
blob. Each operation removes its session rule. Protected operations run
concurrently, each under its own rule ID from a small fixed pool; a single rule
still never carries two Referer values, and an operation whose exact URL is
already covered by an in-flight rule with a different Referer waits for it (a
mid-flight redirect extension toward such a URL degrades to the unextended rule
instead — waiting there could deadlock two extending operations). The extension
requests `declarativeNetRequestWithHostAccess`, but not `webRequest` or
`webRequestBlocking`.
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
   state use storage.session. `downloads/download-state-instances.ts` owns the
   in-memory download map; `hydrateDownloads()` (in `downloads/download-state.ts`)
   rebuilds it at startup and `mergeDownload()` combines partial records from
   the download and notification event paths.
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
6. **Referer DNR rules are temporary shared state.** Each protected
   extension-origin HEAD/GET operation holds its own rule ID from a small fixed
   pool (`REFERER_SESSION_RULE_IDS`), removes its rule in `finally`, and cold
   start recovery clears the whole pool range. A rule may grow only to exact
   URLs the server redirected that operation's request to, bounded per
   operation. The safety invariant: no two concurrent rules may cover the same
   exact URL with different Referer values — a conflicting start waits, a
   conflicting mid-flight extension refuses and degrades. Do not broaden a rule
   to page traffic, share one rule between operations, or let rules overwrite
   each other.

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

## Security and privacy reviews

Read [docs/SECURITY-PRIVACY-REVIEWS.md](docs/SECURITY-PRIVACY-REVIEWS.md) before
performing a security or privacy scan. It defines the client-extension threat
model, severity calibration, high-value boundaries, safe reproduction rules,
and the required fix-versus-acceptance analysis. In particular, distinguish
hostile-page authority from behavior that already requires an installed or
approved extension, and verify browser-owned private or input behavior in both
browsers before reporting it as confirmed.

## Iteration workflow

- `npm install`: install the development dependencies with Node 24 or newer.
- `npm run fmt:check` and `npm run fmt`: check or apply repository formatting.
- `npm test` and `npm run test:watch`: sandbox-safe unit tests.
  `npm run test:integration` runs tests that require loopback listeners or child
  processes; `npm run test:all` runs both. `npm run test:coverage` also runs
  both and enforces the configured source thresholds.
- `npm run lint`: run the strict TypeScript projects, architecture, CSS, i18n,
  and release-package policy checks; stage and lint the bundle; then run
  oxlint and formatting checks.
- `npm run lint:css`: run Biome's recommended correctness rules against CSS
  only. Oxfmt remains the formatter, and `check:css` continues to enforce this
  repository's custom CSS policies.
- `npm run lint:type-aware`: run the zero-baseline `oxlint-tsgolint` rules.
  Keep this check green when changing TypeScript, and add type-aware rules only
  after fixing their existing findings so lint does not accumulate a warning
  backlog.
- `npm run typecheck`: check Firefox, Chrome, the DOM-free worker, tooling,
  e2e drivers, and the source/test project.
- `npm run test:fuzz`: run the replayable property fuzz suite for one second.
  Override `FUZZ_TIME_MS` for longer runs; failures print `FUZZ_PROPERTY`,
  `FUZZ_SEED`, and `FUZZ_PATH` values for exact replay. See the
  [fuzzing guide](docs/FUZZING.md) for campaign and replay details.
- `npm run e2e`: stage once and run Chrome and Firefox in parallel. Use
  `e2e:chrome`, `e2e:firefox`, or `e2e:serial` when isolating failures or
  machine-resource issues.
- `npm run dogfood:functional`: run the fast isolated Chrome/WebMCP functional
  smoke round. Use `dogfood:functional:watch` to keep Chrome alive, rebuild and
  reload after source changes, or press Enter to rerun the same build immediately.
  Pass `-- --no-stage` to reuse the current bundle or `-- --headed` to inspect
  the browser. A headed run reuses and preserves `SAVE_IN_PROMPT_PROFILE` (or
  `~/.cache/save-in-nano-profile` when present) for its on-device Prompt API
  check; pass `--allow-no-prompt-api` to record an unavailable or failed model
  without failing the round. Reports and failure artifacts are written under
  `dist/dogfood-artifacts`.
- `npm run review`, then `p`: run the options page against the real on-device
  model. Needs both a provisioned profile and its provisioned runtime
  (`SAVE_IN_PROMPT_PROFILE`, `SAVE_IN_PROMPT_RUNTIME`; by default
  `~/.cache/save-in-nano-profile` and `~/.cache/save-in-nano-runtime`). Launch
  the model only through `promptRuntimeSettings()`: ChromeML owns its own Vulkan
  device, and on WSL/WSLg — where Ubuntu ships no Dozen — it reaches no device
  without that runtime and the model process crashes. `availability()` still
  answers "available" because the weights are present, so the failure surfaces
  only at `prompt()`, and three crashes trip Chrome's per-profile cutoff until
  the profile is reprovisioned — repair the launch, never the counter. The
  Dozen/Gallium settings and `--use-angle=gl` are WSL/WSLg specific; under WSLg
  `gl` is already what reaches D3D12 through Mesa, so asking ANGLE for `d3d12`
  or `vulkan` only removes the GPU context. What the model does with a prompt,
  and how to measure it, is in
  [docs/ON-DEVICE-PROMPT.md](docs/ON-DEVICE-PROMPT.md).
- `npm run d:chrome` and `npm run d`: auto-rebuilding Chrome and Firefox dev
  loops.
- `npm run bundle`: emit readable bundles. `npm run build` also stages and
  packages the shared store ZIP.
- `npm run clean`: remove generated bundles, browser profiles, coverage reports,
  and packaged artifacts while keeping installed dependencies.

Chrome ≥ 137 ignores `--load-extension`; the scripts load the staged bundled
package from `dist/bundled-pkg` via the CDP `Extensions.loadUnpacked` command (needs
`--enable-unsafe-extension-debugging`), see `scripts/lib/chrome.js`. An idle
MV3 service worker is absent from the CDP target list — wake it with a
runtime message first (`scripts/lib/cdp.js` does this). Set `HEADLESS=1`
for CI runs of either e2e suite.

### Commit cadence and boundaries

Commit at completed, reviewable boundaries rather than by elapsed time or file
count. A commit should have one reason to exist, leave the repository in a
working state, and be independently understandable and revertible.

- Keep mechanical moves and import/path updates separate from behavior changes.
  Use `git mv`, preserve history, and avoid opportunistic cleanup in a move-only
  commit.
- Commit one cohesive extraction or refactor at a time. Add or tighten an
  architecture check after the code satisfies the boundary, and verify that a
  temporary representative violation makes the check fail before reverting it.
- Keep a behavior change and the regression test that proves it in the same
  final commit. Do not mix unrelated fixes, broad formatting, generated churn,
  or follow-on cleanup into that commit.
- Land cleanup enabled by a refactor (dead shims, obsolete exclusions, duplicate
  code) separately when it has its own review or revert value. Documentation may
  accompany the implementation it precisely describes; broader plans and
  retrospectives belong in their own commit.
- Run focused tests while iterating, then the architecture/type/format checks
  proportionate to the boundary before committing. Mass moves also require a
  bundle/staging check; listener, lifecycle, HTML/CSS entry, or browser-owned
  behavior changes require the relevant browser e2e coverage. Run the full
  task-appropriate gate before handoff or merge.
- Never make a knowingly broken intermediate commit on a shared or merge-ready
  branch. On a private branch, temporary `fixup!` commits are acceptable while
  exploring; squash them into the commit they correct before integration.
- Recheck `git status` immediately before staging and again before committing.
  In a dirty or concurrently used worktree, stage explicit task-owned pathspecs,
  inspect the staged diff, and never absorb, restore, stash, reformat, or commit
  another session's work.

As a rule of thumb, commit whenever the current state is something a reviewer
might reasonably approve, reject, or revert on its own. Use imperative commit
subjects that name the outcome, such as `Separate options composition from
shared foundation`.

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
- Keep e2e waits event-driven and in-browser where possible. Fixed sleeps and
  repeated runner-side CDP/RDP polling are not acceptable when a browser event,
  observer, or storage listener can signal completion. Preserve real
  user-visible timing and keep only measured wins.
- Review e2e performance primarily through deterministic work: protocol
  evaluations, page reloads, polling iterations, and browser/server lifetimes.
  Ordinary cases should not reload a page or restart a browser/background unless
  the behavior requires it, and should normally complete within two seconds.
  Document legitimate lifecycle or network costs beside the case.
- Send serializable e2e setup, browser-state, and wait operations through the
  shared structured control client. Reserve direct CDP/RDP evaluation for
  page-local DOM behavior and lifecycle diagnostics. When migrating a raw
  evaluation, lower its enforced ceiling in `scripts/check-e2e-harness.js`.
- Treat a per-case duration increase above 25% as an advisory regression. An
  increase above 50% and at least two seconds requires a fix or an explanation
  backed by repeated measurements. Enforce total wall-clock budgets only in a
  stable scheduled environment; shared PR runners use timings diagnostically.
  Raising a baseline requires before/after evidence, and retries must never hide
  a performance regression.
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

vitest specifics (`test/**/*.test.ts`, typed; `tsc` covers them):

- Vitest defaults to the lightweight Node environment. Put
  `// @vitest-environment jsdom` at the top of tests that actually exercise the
  DOM; do not make pure model, protocol, or tooling tests pay for jsdom.
- `test/support/vitest.setup.ts` installs typed `browser`/`chrome` fixtures from
  `test/support/webextension-host.fixture.ts`. Replace only the host boundary a test
  exercises; `browser`/`chrome` stay ambient host globals and cross-module
  dependencies are imported or mocked normally.
- Tests import the real `.ts` modules and mock deps via `vi.mock` /
  `vi.spyOn`. Prefer the typed builders in `test/support/webextension-host.fixture.ts`,
  import-real + `vi.spyOn`, and typed listener capture.
- Module-reset tests use `vi.resetModules()` + `await import(...)`. In jsdom
  tests, stub away `URL.createObjectURL` to exercise MV3 paths.
- Compile-only API relationships belong in `test/contracts/type-contracts.ts`; do not
  wrap `expectTypeOf` assertions in runtime tests.
- Capture browser event handlers via
  `vi.mocked(browser.x.onY.addListener).mock.calls[0]![0]` and invoke them.

## Conventions

- oxfmt (prettier-compatible) + oxlint; `npm run lint:fix` before commit.
- File-suffix naming is a contract, not decoration: `-model.ts` is pure,
  DOM-free, unit-tested logic, paired with a view file of the same base name
  that owns DOM/browser events (`path-editor.ts`/`path-editor-model.ts`,
  `rule-visual-editor.ts`/`rule-visual-editor-model.ts`,
  `syntax-editor.ts`/`syntax-editor-model.ts`,
  `route-debugger.ts`/`route-debugger-model.ts`).
  `content/source-panel-model.ts` is the sole exception: page-DOM source
  discovery is its subject matter, so it reads the document and its test runs
  under jsdom. It is not licence to add DOM to any other `-model.ts`.
  `-state.ts` is reserved for
  genuinely pure state containers with no DOM references (e.g.
  `field-save-state.ts`, `download-state.ts`); a module that queries or wires
  DOM is a controller/view file even if it tracks state, and should not use
  the `-state` suffix (see `syntax-editor/manual-editor-controller.ts`).
  `-panel.ts` names a module that wires one distinct options-page panel
  (`history-panel.ts`, `webhook-panel.ts`, `integration-panel.ts`), not any
  structurally-panel-shaped module. A per-layer `ports.ts` (`background/`,
  `downloads/`, `routing/`) is the intentional dependency-injection
  pattern, not a naming collision. `shared/` hosts cross-context contracts and
  pure helpers only — a module belongs there because two or more directories
  that cannot legally import each other both need it, not because it is
  merely reused; when that happens, add a short header comment on the file
  explaining which importers force it to stay (see `shared/webhook.ts`,
  `shared/source-panel-copy.ts`, `shared/history-normalization.ts`,
  `shared/streaming-content.ts` for the pattern).
- UI copy must be concise, concrete, and action-oriented. Use sentence case for headings,
  labels, and buttons; name the user-visible outcome rather than the implementation; avoid
  jargon, idioms, unnecessary punctuation, and text assembled from translated fragments.
- Treat typography as a shared UI system, not per-component decoration. Preserve the native UI
  font stack and the tokenized scale in `src/options/style.css`; avoid raw one-off font sizes and
  keep meaningful help, status, and error text at least 13px. Reserve smaller dense typography for
  nonessential metadata, keep editor/code text comfortably legible, prefer the 400/500/600/700
  weight vocabulary, and verify hierarchy and wrapping in both browser screenshots after broad
  typography changes.
- Make new UI feel native to the existing app. Reuse the spacing, typography, controls,
  disclosures, borders, and feedback patterns of adjacent settings before adding component-specific
  variants; verify new states alongside the surrounding page in both themes and at narrow widths.
  Follow the hierarchy, interaction contracts, responsive rules, and anti-drift checklist in
  [docs/UI.md](docs/UI.md); update that contract before introducing a legitimate new variant.
- Keep terminology consistent across settings, menus, notifications, help text, and
  accessibility labels. Give translators enough context in message descriptions when a label
  is ambiguous, preserve placeholders exactly, and write complete strings that allow languages
  to reorder words naturally. Accessible names must communicate the same action as visible copy.
- English is the canonical i18n key schema and the only browser-native catalog. Generated catalogs
  stay outside `_locales`: they are opt-in, clearly labelled in the language selector, bundled
  locally without runtime AI or network access, and fall back to English for missing messages. Add
  or update the `check:i18n` catalog/runtime-key policy when UI copy changes. Follow the authoring,
  semantic-review, concurrency, and staged-snapshot workflow in
  [docs/TRANSLATIONS.md](docs/TRANSLATIONS.md).
- When the user asks for repository changes, commit the completed, verified
  work before handing it back unless they explicitly ask to leave it uncommitted.
  Stage only task-related changes when the worktree contains unrelated edits.
- No extension runtime dependencies. Build tooling targets Node ≥ 24 and uses
  JSZip only to canonicalize `web-ext` archives for reproducible bytes.
- Editable SVG icon sources and regenerated runtime rasters live under `icons/`.
  Shipped icon files must be referenced explicitly by the manifest or runtime.
- Comments explain _constraints_ (why something must be this way — usually
  an MV3/cross-browser rule), not what the code does.
- Version lives in `manifest.json` and `package.json` — bump together.
- TypeScript application source is `strict: true` and checked independently
  against the Firefox and Chrome API declarations. Keep both host projects,
  the DOM-free Chrome worker project, and the combined source/test project
  green. Release-critical build/config scripts, browser-control tooling, and
  e2e drivers are checked in separate strict projects. Prefer real imports and
  typed host-boundary helpers in tests.
- Production source must not use non-null assertions (`value!`); oxlint enforces
  this for `src/**/*.ts`. Prove availability with a runtime guard, preserve a
  checked value in a local before an async callback, or model correlated optional
  fields as a discriminated object. For indexed access, handle the missing case
  explicitly; do not replace an assertion with a default that hides a broken
  invariant.
- Type assertions do not validate or convert runtime data. Narrow DOM nodes,
  browser messages, storage, imported configuration, and other untrusted values
  before use. Keep unavoidable assertions local to generic adapters, platform
  declaration gaps, or branded values whose runtime invariants were already
  checked; never use a cast merely to silence a boundary error. Convert unknown
  errors with `String(error)` or a checked `Error.message` instead of casting.
- Tests may use non-null assertions only where fixture construction or captured
  listener setup already proves the value exists. Behavior at malformed or stale
  runtime boundaries belongs in a regression test when it has a meaningful
  failure mode.
  Runtime globals must not reuse platform class names such as `Notification` or
  `Headers`; that is why `downloads/notification.ts` keeps the `Notifier`
  spelling in `registerNotifier`.

## Release checklist

Read [docs/RELEASE.md](docs/RELEASE.md) when preparing a release or changing
release automation, provenance, screenshots, or browser-owned checks.

1. `npm run test:all && npm run lint && npm run typecheck && npm run e2e`
2. Bump version in `manifest.json` and `package.json`.
3. Run `npm run build` and `npm run build:source`. Upload the same runtime ZIP
   to both stores and attach the source ZIP in AMO.

# Code organization decisions

A record of how Save In's source came to be arranged. Scope is
file/directory layout, module boundaries, and naming — not runtime behavior,
features, or the build model. The ESM + readable-bundle architecture,
the enforced import layering, and the execution-context split described in
[AGENTS.md](../AGENTS.md) stay as they are; the work below strengthens them.

**All four phases have landed**, so this is a record, not pending work: each
step carries a "Landed" note describing what actually happened, including where
the plan was adapted, rejected, or wrong. It is kept because the reasoning is
not recoverable from the code — the code shows a file sitting in `shared/`, not
why moving it out was tried and refused. Source
files and `scripts/check-import-cycles.js` cite these phase numbers, so they are
stable references. The problem statements and phase scopes deliberately name
files by their **pre-move** paths — a rename is only legible if it names what it
renamed — and line counts are measurements taken when a phase landed. For the
current structure and conventions, read [AGENTS.md](../AGENTS.md) instead.

## What already works (keep and extend)

- **Enforced layering.** `scripts/check-import-cycles.js` codifies real rules:
  `shared` imports only `shared`/`vendor`; `platform` only adds `shared`;
  `config` and `routing` cannot reach feature directories; `downloads` cannot
  import `background`; listener registration and port wiring are restricted to
  named composition owners. Every move below must keep this checker green, and
  several steps extend it.
- **The `*-model.ts` pattern.** `path-editor`, `rule-visual-editor`,
  `syntax-editor`, and `route-debugger` each pair an imperative view with a
  pure, DOM-free model built for unit testing. This is the strongest pattern
  in the UI code and the template for splitting the remaining god modules.
- **Feature-scoped CSS.** Options and source-panel styles are already split
  into per-feature files with a declared layer order.
- **Test-side taxonomy.** `test/options/` has begun grouping into
  `page/`, `path-editor/`, `routing-editor/`, `history/`, `webhooks/`,
  `contracts/` — a taxonomy the source side should mirror.

## Problems, in priority order

1. **`src/options/` is a flat directory of ~120 files.** Feature clusters
   (path editor, rule editor, history, dialogs, reference, integrations…)
   are visible only through naming prefixes. Feature TS and its CSS are
   separated in listings, and the test tree already uses subdirectories the
   source tree lacks.
2. **Five god modules mix multiple concerns:**
   - `src/content/source-panel.ts` (2051 lines) — one ~1730-line function
     containing layout persistence, host lifecycle, icons, menus, resize,
     drag, filter/sort, lazy previews, selection painting, row rendering,
     and diffing.
   - `src/options/options.ts` (1166) — composition root plus top-level DOM
     event wiring, rendering, autosave/dirty-state tracking, and
     cross-module orchestration (46 imports, 54 `querySelector` calls).
   - `src/background/messaging.ts` (915) — message transport, external API
     surface, ~13 handlers, and ~250 lines of auto-download orchestration in
     `handleAutoDownloadSource`; imports across every layer.
   - `src/downloads/download.ts` (932) — state glue, history-entry
     construction, content-disposition parsing, plan resolution, URL
     acquisition, and execution.
   - `src/downloads/notification.ts` (~700) — notification creation/queueing,
     expected-download tracking, and two very large browser event handlers
     (`onDownloadChanged` alone is ~280 lines).
3. **`src/shared/` mixes true primitives with feature code.**
   `source-panel-copy.ts`, `webhook.ts`, `history-normalization.ts`, and
   `streaming-content.ts` are feature logic parked in the bottom layer because
   two contexts need them. `shared/message-protocol.ts` (684 lines) mixes
   wire types with runtime marshalling, validators, and a live
   `sendInternalMessage`, and `import type`s upward into five feature
   directories — legal only because the checker erases type edges, which
   weakens the "shared points downward" guarantee.
4. **Convention drift and noise.**
   - `-model` means "pure and DOM-free" in four features, but
     `manual-editor-state.ts` holds 14 DOM references and `-panel` is applied
     to structurally unrelated modules; none of this is written down.
   - `src/offscreen.ts` is the only context implementation at the src root;
     every other context uses `subdir/impl.ts` + `entries/` shim.
   - One-line shims: `src/options/floating-position.ts` re-exports
     `shared/floating-position.ts` (five importers use the shim, content
     imports shared directly); `style-welcome.css` and `style-reference.css`
     are one-line `@import`s of differently named siblings.
   - Name collisions across layers: `event-task.ts` twice (`shared/`,
     `background/`, both 22 lines), `state.ts` twice, `ports.ts` three times
     (the `ports.ts` triplet is an intentional injection pattern; the others
     are accidental).
   - Stale comments still referencing `options.js` from the JS→TS migration.
5. **The automation concern spans three directories:**
   `routing/automatic-rule.ts`, `automation/automatic-routing.ts` +
   `auto-download-rules.ts` + `source-rule-draft.ts`, and the orchestration
   inside `background/messaging.ts`.

## Phase 1 — mechanical moves (no code changes beyond import paths)

Low risk, high daily-navigation payoff. Use `git mv` so history follows.
Do this on a clean worktree in one dedicated commit series, because it
touches many import specifiers and will conflict with any open branch.

1. **Introduce subdirectories under `src/options/`,** mirroring and extending
   the existing `test/options/` taxonomy. Each feature directory holds its TS
   *and* its `style-*.css` so a feature is one directory:

   | Directory | Contents (actual placement) |
   | --- | --- |
   | `core/` | the `options-*` family, `options.ts`, `tabs.ts`, `tab-controls.ts`, `tab-context-controls.ts`, `theme.ts`, `l10n.ts`, `language-selector.ts`, `saved-indicator.ts`, `field-save-state.ts`, `option-search.ts`, `option-navigation.ts`, `reset-options.ts`, `settings-transfer.ts`, `deferred-page-reload.ts`, `shortcut-options.ts`, `source-shortcut.ts`, `style-option-tools.css`, `style-source-settings.css`, `style-workflows.css`, `style-automation.css`, `style-advanced.css`, `style-advanced-responsive.css` |
   | `path-editor/` | `path-editor{,-model,-insert-menu}.ts`, `path-source-selection.ts`, `style-path-editor.css`, `style-editor-actions.css`, `style-editor-responsive.css`, `style-menu-preview.css` |
   | `rule-editor/` | `rule-visual-editor{,-model}.ts`, `rule-builder.ts`, `rule-templates.ts`, `source-rule-draft.ts`, `style-rule-editor*.css`, `style-template-library.css` |
   | `syntax-editor/` | `syntax-editor{,-model}.ts`, `editor-validation.ts`, `manual-editor-state.ts`, `autocomplete.ts`, `style-syntax-editor.css`, `style-syntax-popovers.css` |
   | `route-debugger/` | `route-debugger{,-model}.ts`, `style-route-debugger*.css` |
   | `history/` | `history-panel.ts`, `history-view.ts`, `history-feedback.ts`, `style-history*.css` |
   | `integrations/` | `webmcp.ts`, `webhook-panel.ts`, `integration-panel.ts`, `debug-log-panel.ts`, `counter-panel.ts`, `style-advanced-integrations.css` |
   | `dialogs/` | `*-dialog.ts` (`about-dialog.ts`, `privacy-dialog.ts`, `unsaved-changes-dialog.ts`, `welcome-dialog.ts`), `welcome-dialog.css`, `style-welcome.css`, `style-dialogs.css`, `style-about.css` |
   | `reference/` | `reference-page.ts`, `reference-descriptions.ts`, `matcher-descriptions.ts`, `vocabulary-groups.ts`, `variables-preview.ts`, `reference.css`, `style-reference.css`, `style-variables-preview.css`, `style-editor-reference.css` |
   | `ui/` | shared UI primitives: `typeahead.ts`, `anchored-floating-surface.ts`, `details-menu-positioning.ts`, `dismissible-details.ts`, `clipboard.ts`, `click-to-copy.ts`, `latest-only.ts`, `latest-task.ts`, `checkbox-rows.ts`, `permissions-banner.ts`, `floating-position.ts`, `style-typeahead.css` |
   | `styles/` | non-feature CSS: tokens, base, themes, palettes, shell (+responsive), layout (+responsive), components, utilities, accessibility, status, feedback, `style-option-rows.css` |

   Every one of the ~120 flat files landed in a feature directory; nothing
   stays at the top level except `style.css`, `options.html`,
   `clauselist.html`, `favicon.png`, `assets/`, `i/`. A few files span more
   than one plausible owner (mixed-content CSS grab-bags, or `.ts` files
   wired from multiple features); those were placed with their dominant
   or most-specific concern rather than split, since Phase 1 is a pure move
   with no content changes. Notably: `style-editor-actions.css` and
   `style-editor-responsive.css` style both the path and rule editors but
   lean path-editor by selector count; `style-advanced.css` mixes the theme
   picker (core) with integration-only chrome, and stayed with `core/`
   alongside the page-level "Advanced" tab nav it also owns;
   `shortcut-options.ts`/`source-shortcut.ts` and their paired CSS are
   options-page-level settings wired directly from `options.ts`, so they
   went to `core/` rather than a new single-purpose directory.
2. **Align `test/options/` to the same names** and fold the 43 flat test files
   into the matching subdirectories. Group the five scattered
   `test/content/source-panel*.test.ts` files into
   `test/content/source-panel/`. Landed alignment: `test/options/page/` was
   renamed to `test/options/core/` (its `shell.test.ts` group of `.cases.ts`
   fixtures matches `core/`'s composition-root tests), except its
   `about-dialog*` files, which moved to `test/options/dialogs/` alongside
   their source; `test/options/routing-editor/` was split along the actual
   src taxonomy into `test/options/route-debugger/` (the
   `route-debugger*.test.ts` files) and `test/options/rule-editor/` (the
   `rule-builder*`/`rule-visual-editor*` files), rather than a single rename,
   since it already mixed both features; `test/options/webhooks/` was folded
   into `test/options/integrations/` to match `src/options/integrations/`.
3. **Move `src/offscreen.ts` → `src/offscreen/offscreen.ts`** and update the
   `entries/offscreen.ts` shim and the listener-owner allowlist in
   `check-import-cycles.js`. Landed as described; also updated the coverage
   exclusion path in `config/vitest/base.mjs` and the direct-source-file
   import in `test/downloads/offscreen-document.test.ts` (that test stays
   under `test/downloads/`, matching where the offscreen-fetch contract is
   exercised from).
4. **Delete the one-line `floating-position.ts` shim.** Pointed all five
   `src/options/**` importers (`anchored-floating-surface.ts`,
   `details-menu-positioning.ts`, `syntax-editor.ts`, `autocomplete.ts`,
   `typeahead.ts`) at `../../shared/floating-position.ts` directly, deleted
   `src/options/ui/floating-position.ts`, moved its test to
   `test/shared/floating-position.test.ts` (it exercises the shared module,
   not an options-only concern), and updated the import-string contract in
   `scripts/check-css.js`.

   `style-welcome.css` and `style-reference.css` turned out **not** to be
   redundant shims, so they were kept as-is. `style.css` declares the
   document-wide `@layer` order (`tokens, base, …, welcome, reference,
   utilities`) but deliberately imports nothing into the `welcome`/`reference`
   layers itself; `options.html` (and, for `reference`, `clauselist.html`)
   loads `welcome-dialog.css`/`reference.css` into those layers by linking a
   tiny `@import url(...) layer(name);` entry file instead. This is load-
   bearing: the HTML `<link>` element has no shipped way to assign a layer to
   a linked stylesheet (the `layer` attribute on `<link>` is only a WHATWG
   proposal, not implemented in any shipping browser — see
   https://github.com/whatwg/html/issues/7540), so a same-document `@import
   … layer(...)` is the only mechanism available. Removing the entry files
   would either lose the layer assignment (a real cascade-order/behavior
   change, out of scope for Phase 1) or require wrapping ~160–260 lines of
   each real stylesheet in a new `@layer name { … }` block, a pattern used
   nowhere else in this codebase. Left in place.
5. **Rename the accidental collisions:**
   - `event-task.ts`: `src/background/event-task.ts` already built on
     `src/shared/event-task.ts` (`runBackgroundTask` wraps the shared
     `runEventTask` with background-specific logging) rather than
     duplicating it, so there was nothing to merge. Renamed it to
     `src/background/background-event-task.ts` to describe what it actually
     is: the background's logged event-task wrapper. The shared file keeps
     its name.
   - `state.ts`: renamed `src/background/state.ts` →
     `src/background/application-state.ts` (it aggregates every background
     write-state instance — session, counter, config, and the downloads
     record map — into the frozen `BackgroundState` object; `menu-state.ts`
     from the original plan would have been misleading, since menu state
     actually lives in `background/menu-build.ts`'s `menuState`). Renamed
     `src/downloads/state.ts` → `src/downloads/download-state-instances.ts`
     (it owns the two live singleton instances — `downloadsState` and
     `sessionWriteState` — consumed by `download-state.ts`'s pure
     hydrate/merge functions; `download-map.ts` was rejected as a name
     because it would not have covered `sessionWriteState`, and plain
     `download-state.ts` was already taken by the pure-logic module). Updated
     every importer in `src/` and `test/`, plus the `downloads/state.ts`
     reference in AGENTS.md's MV3 service-worker rules.
   - Kept the intentional per-layer `ports.ts` pattern untouched.
6. **Swept stale `.js` references in comments** in `src/options/history/history-view.ts`,
   `src/options/core/options-logic.ts`, `test/options/core/options-logic.test.ts`, and
   `test/options/history/view.test.ts` (all said "extracted from options.js"; the
   source has been `options.ts` since the JS→TS migration). Left
   `src/options/options.html`'s `<script src="../../options.js">` alone — that is the
   real bundled runtime filename, not a stale comment.

Verification: `npm run lint && npm run typecheck && npm test` after each
commit; `check-import-cycles.js` and `check-css.js` must stay green;
`npm run bundle` to confirm rolldown entry resolution; one e2e run at the end
of the phase.

## Phase 2 — split the god modules

Each split follows the proven pattern: pure logic into a `-model`-style
module, browser/DOM glue stays in the view/handler file, and existing tests
move with their code. Order by value and by how much other work each unblocks.

1. **`background/messaging.ts` → a `background/messaging/` directory:**
   - `protocol.ts` — `API_VERSION`, `API_CAPABILITIES`, `API_ERRORS`, and the
     external API surface declaration.
   - `handlers.ts` (or one file per cohesive group) — the ~13 `handle*`
     functions, kept as thin adapters that validate and delegate.
   - `auto-download.ts` — the ~250-line `handleAutoDownloadSource` business
     logic, which belongs with the automation concern (see Phase 3.4).
   - `index.ts` — `registerMessaging()` wiring `onMessage` /
     `onMessageExternal`; remains the sole listener owner.
   Rationale: this is the single riskiest file to change today; splitting
   transport from orchestration shrinks the blast radius of every future
   message change.

   Landed as described, `git mv`'d onto `handlers.ts` (the largest share of
   the original file). `handleAutoDownloadSource` had already shrunk to
   ~65 lines by the time of this split (routing now delegates to
   `automation/automatic-routing.ts`), so `auto-download.ts` is small today;
   it still stays separate because it is the automation-orchestration seam
   Phase 3.4 will grow. `getUntrustedValidationRejection` (the external
   VALIDATE rate-limit/shape check) and the `sourcePanelCopies` cache landed
   in `handlers.ts` alongside the handler they support, exported for
   `index.ts` to call/read. The per-message-type dispatch tables
   (`internalHandlers`/`externalHandlers`, including the handlers that were
   already inline closures rather than named `handle*` functions —
   `WAKE_WARM`, `SOURCE_PANEL_*`, `CREATE_SOURCE_RULE`, `DIAGNOSTICS_*`,
   `HISTORY_*`, `EXTERNAL_DOWNLOAD_REJECTION*`, `OPTIONS*`, `PREVIEW_MENUS`)
   stayed in `index.ts` as part of the `onMessage`/`onMessageExternal` wiring
   they're built for, rather than being extracted into more named handler
   functions; that keeps `index.ts` as the one place reviewers check for the
   full message-type surface. `index.ts` re-exports `handlePing`,
   `handleDownloadMessage`, `emitDownloaded`, `resetMessagingTransientState`
   (from `handlers.ts`) and `isValidDownloadUrl` (from `protocol.ts`) so
   `import * as Messaging from ".../messaging/index.ts"` keeps working for the
   tests that exercise a handler directly instead of only through dispatch.
   Updated the listener-owner allowlist in `scripts/check-import-cycles.js`
   to `src/background/messaging/index.ts`, and the two external importers
   (`entries/background.ts`, `background/e2e-command.ts`) to the same path.
2. **`shared/message-protocol.ts` → types vs runtime:**
   - `shared/message-protocol.ts` keeps wire *types* and the message-type
     maps/sets/guards (contract only).
   - Move `toWireDownloadState`/`fromWireDownloadState` marshalling next to
     the download state it serializes (`downloads/`), and `sendInternalMessage`
     into `platform/` or the messaging composition layer.
   - Then tighten policy: shared contract modules should not need `import
     type` from five feature directories; invert by having feature dirs
     declare their wire shapes in shared, or accept and *document* the
     type-edge exemption in `check-import-cycles.js`.

   Landed as described (611 lines remain). `toWireDownloadState`/
   `fromWireDownloadState` moved to `downloads/wire-state.ts`, next to the
   `DownloadPipelineState`/`DownloadInfo` shapes in `downloads/download-types.ts`
   they marshal; `WIRE_INFO_STRING_FIELDS`, `isRoutingCounter`, and
   `isBrowserTabId` stayed in `shared/message-protocol.ts` (exported) because
   the wire-state validators that remain there — `isWireDownloadInfo`,
   `isValidationInfo`, `isWireCurrentTab` — still need them, so `wire-state.ts`
   imports them back rather than duplicating the contract. `sendInternalMessage`
   went to `platform/messaging.ts`, not the messaging composition layer: every
   current importer is an options-page caller (13 files under `src/options/`),
   none is background composition code, and the function's only dependency is
   a generic `{ sendMessage }` shape, so `platform/` (generic, importable from
   any execution context) fit better than growing
   `background/messaging/`. Updated all importers directly (no shim); split
   `test/shared/message-protocol.test.ts` into the surviving contract test plus
   `test/downloads/wire-state.test.ts` and `test/platform/messaging.test.ts`.

   The type-only upward policy tightening (last bullet) did not land in this
   pass: `shared/message-protocol.ts` still carries `import type`s into
   `downloads/download-types.ts` (`DownloadInfo`, used by `DownloadRequestBody`),
   `menus/menu-tree.ts`, `routing/rule-types.ts`, and `background/runtime.ts` /
   `background/route-preview.ts` — all needed by `InternalResponseMap`/
   `InternalMessage` entries (`PREVIEW_MENUS`, `VALIDATE`, `CHECK_ROUTES`, the
   `DOWNLOAD` request body) that were never part of the marshalling or
   transport code this step moved. Inverting those (feature dirs declaring
   their own wire shapes in `shared/`) is a real design change, not a
   mechanical extraction, and is left for a dedicated Phase 3 step.
3. **`content/source-panel.ts`:** extract the module-level seams first —
   `source-panel-layout.ts` (layout type, normalization, storage/sort
   persistence), `source-panel-icons.ts`, `source-panel-format.ts`
   (theme/locale/formatters), `source-panel-host.ts` (WeakMap registries +
   lifecycle). Then break up the 1730-line `toggleSourcePanel` by introducing
   an explicit panel-context object (shadow root, panel element, layout,
   options) passed to builder functions: menus/positioning, resize, header
   drag, filter+sort, preview observer, selection painting, row rendering.
   The pure logic largely already lives in `source-panel-model.ts`; this step
   is about making the view navigable. Split the 2287-line
   `test/content/source-panel.test.ts` along the same seams.

   **Landed** (module-level seams and the panel-context builder split; the
   test file was left as-is — see below). `source-panel-layout.ts`,
   `source-panel-icons.ts`, `source-panel-format.ts`, and
   `source-panel-host.ts` landed first, as a dedicated commit, exactly as
   scoped above (the `activePanelHost` WeakMap-adjacent live binding moved to
   `source-panel-host.ts` and gained a `setActivePanelHost` owner-controlled
   setter, following the `currentTab` pattern in
   `platform/current-tab.ts`, since `toggleSourcePanel` needed to reassign it
   from outside its owning module).

   `toggleSourcePanel` (1730 lines) is now under 200 lines of orchestration.
   `source-panel-context.ts` defines `SourcePanelContext`: one mutable object
   per panel instance carrying every field two or more builders read or
   write (DOM elements, the mutable `panelOptions`/`copy`/`formatters`/
   `panelSendDownload`/`layout`, and behavior hooks like `render`,
   `refreshSources`, `closeOpenMenus`, `applyLayout`). `createSourcePanelContext`
   seeds every field with a real value (for the handful created before any
   builder runs — `host`, `shadow`, `panel`, `list`, `liveStatus`, `announce`,
   `cleanupTasks`) or a safe no-op placeholder (a shared `noop`, plus three
   typed one-offs for non-`void`-returning fields), because every placeholder
   is overwritten by its owning builder before `toggleSourcePanel` returns and
   before any panel event can fire — the same pattern the original code used
   for its one forward-declared closure (`updatePlacementControls`), just
   generalized to every cross-builder field instead of threading setters.
   Builders run in one fixed, dependency-ordered sequence from
   `toggleSourcePanel`: `wirePanelMenus` → `wirePanelResize` →
   `wirePanelHeader` → `wirePanelFilterSort` → `wirePanelPreview` →
   `wirePanelSelection` → `wirePanelRowRender` → `wirePanelRefresh` (`header`
   depends on `menus`+`resize`; `row-render` depends on everything before it;
   `refresh` depends on `row-render`). `wirePanelViewportLock` and
   `buildPanelUpdate` (the options-diffing update path, plus
   `applyStaticCopy`, which touches controls owned by five different
   builders and has no other caller) run outside that sequence, at the same
   relative points the original code did. Each builder pushes its own
   teardown into `ctx.cleanupTasks`; `toggleSourcePanel` aggregates them into
   the single `panelCleanups` entry instead of one large inline closure.
   `source-panel.ts` itself keeps only: the existing-panel reopen/close
   guard, host/shadow/style/panel/list/liveStatus construction (the inline
   style-array assembly and CSS imports stay here — `scripts/check-css.js`
   parses this exact file for them), the builder call sequence, final DOM
   assembly (`panel.append`/`shadow.append`/`document.documentElement.append`),
   and `replaceSourcePanel`/`setSourcePanelOpen` (unchanged).
   `scripts/check-css.js` had three checks (menu floating-positioning,
   reduced-motion scroll behavior, `--source-panel-*` custom-property
   tokens) that read `source-panel.ts` alone for behavior its builders now
   own; they were repointed at a `sourcePanelFeatureSource` aggregate of
   every `src/content/source-panel*.ts` file, while the CSS-wiring checks
   (owned stylesheet imports, the forbidden-inline-style check, stylesheet
   order) stayed scoped to `source-panel.ts` alone, since that file still
   owns those literally. `scripts/check-coverage-policy.js`'s reviewed-ignore
   ceiling moved from 72 to 74: dropped the one ignore tied to the original
   single forward-declared closure, gained three covering the shared `noop`
   placeholder and the two non-`void` one-off placeholders (`currentDock`,
   `closeOpenMenus`), all annotated the same way the original ignore was.

   The test file was **not** split. `test/content/source-panel/source-panel.test.ts`
   is a single flat list of ~90 `test()` calls under one
   `describe("Page Sources panel interactions")` with one shared `afterEach`
   — it was never organized into per-seam `describe` blocks the way the
   task assumed, so there is no existing structural boundary to move
   mechanically. Its tests are black-box/integration style (drive
   `toggleSourcePanel` and assert on the rendered shadow DOM), and many
   individual tests exercise two or more builders at once (e.g. the
   options-diffing update path together with row re-rendering, or row
   actions together with menu wiring), so assigning each test to one seam
   would be a judgment call, not a mechanical line-range cut, and risks
   silently mis-categorizing or duplicating coverage in a suite that
   currently passes at 100%. The shared `afterEach` itself is small and
   self-contained (not the "heavily entangled" case the task named as the
   reason to fall back to a fixture-helper file), so that specific
   complication did not apply here — the blocker was the test-to-seam
   mapping, not the setup.
4. **`options/options.ts`:** move top-level DOM side effects into named setup
   functions registered through the existing `options-bootstrap.ts` ports
   pattern; extract autosave/dirty-state tracking into a `core/` module and
   the `onDownloaded` fan-out into a small subscriber registry so panels
   subscribe instead of being hard-wired. Target: `options.ts` becomes a real
   composition root under ~200 lines.

   **Landed** (247 lines; the ~200 target was a stretch once every `ready[]`
   wiring call and the persistence/webmcp-sync orchestration stayed put — see
   below). Six new `core/` modules plus one `ui/` helper absorbed the rest:
   `pending-changes.ts` (211 lines: `createFieldSaveState`-backed autosave
   scheduling, the beforeunload guard, and `confirmPendingChanges`, all behind
   a `createPendingChangesTracker(ports)` factory options.ts calls once and
   re-delegates `confirmPendingChanges` from — a thin re-export, per the
   backward-compatibility note, since `entries/options.ts` still imports it
   from `options.ts`); `routing-preview-panel.ts` (464 lines: the VALIDATE
   error channels and the CHECK_ROUTES-driven last-download/variables/capture
   panel stayed one module, not two, because `updateErrors` already does both
   in a single round trip; also owns `jumpToError`, shared with
   `menu-preview.ts`); `menu-preview.ts` (237 lines: the live context-menu
   tree renderer and its paths-textarea wiring — placed in `core/`, not
   `path-editor/`, even though `style-menu-preview.css` lives there per Phase
   1, because the renderer also reads other options-page fields
   `path-editor.ts` doesn't own, and `path-editor.ts` is already an 867-line
   file slated for its own future split); `manual-editor-actions.ts` (69
   lines: the Apply/Discard button wiring for the two grammar editors);
   `option-field-sync.ts` (42 lines: `setOptionFieldValue`, the schema→DOM
   field writer, now unit-tested like `options-logic.ts`);
   `browser-capability-ui.ts` (38 lines: the Chrome/Firefox capability
   toggles, formerly `setupChromeDisables`); `download-refresh.ts` (16 lines:
   the `subscribeDownloadRefresh`/`notifyDownloadRefresh` subscriber
   registry — a plain array of callbacks, since panels' refresh order had to
   stay identical to the original hard-coded `onDownloaded` fan-out, so
   `options.ts` still does the registering, just through the registry instead
   of an inline closure); and `ui/disclosure-help.ts` (27 lines: the generic
   `.help` disclosure toggle, unrelated to any one feature).

   `options.ts` itself keeps: the persistence round trip
   (`restoreOptionsHandler`/`optionsPersistence`/`restoreOptions`/
   `saveOptions`), the exported `syncOptionsPageAfterWebMcpApply` (WebMCP
   sync needs to reach into `pendingChanges`' and `manualEditorState`'s dirty
   tracking to avoid clobbering an in-progress local edit — a real
   composition-root concern), the `manualEditorState`/`routingPreview`/
   `pendingChanges`/`localePageReload` construction that wires the extracted
   modules together, a handful of one-line `ready[]` wrapper functions
   (`setupResetOptionsPanel`, `setupManualEditors`, `setupThemePicker`,
   `setupSettingsTransferPanel`, `setupDefaultDownloadsFolderLinks`), and the
   final `bootstrapOptionsPage({ ready: [...], onDownloaded:
   notifyDownloadRefresh, ... })` call.

   Module import is now side-effect-light with one documented exception:
   `const updateOptionDependencies = setupOptionDependencies();` stays eager
   at module top level (not moved into `ready[]`). `bootstrapOptionsPage`
   calls `ports.startBrowserDetection()` — which, on Chrome, synchronously
   invokes `waitForBrowserDetection` → `updateOptionDependencies()` — before
   it runs any `ready[]` entry, so the binding must already exist by then.
   Everything else that used to run at import time (help-disclosure wiring,
   the beforeunload guard, manual-editor setup, the paths/filenamePatterns
   live-preview and live-validation wiring, autosave wiring, Apply/Discard
   buttons, settings-transfer wiring) now runs as a `ready[]` entry, in the
   same relative order those blocks executed in the original file. This does
   shift them later relative to `entries/options.ts`'s own
   `setupSyntaxEditors()`/`setupRouteDebugger()`/`setupRuleVisualEditor()`
   calls, which used to run *after* all of `options.ts`'s import-time code
   (ES module evaluation completes before `entries/options.ts`'s
   `DOMContentLoaded` handler runs) and now run *before* `setupOptionsPage()`
   invokes `ready[]`. Checked for a load-bearing dependency on the old order:
   `createSyntaxEditor` wraps the `#paths`/`#filenamePatterns` textareas with
   a sibling overlay rather than replacing them, so the elements
   `options.ts`'s wiring queries stay the same nodes either way, and neither
   side reads state the other writes. Verified with a full `npm run
   e2e:chrome` (49/49) and `npm run e2e:firefox` (32/32) pass, including the
   paths live-preview, autosave-persists-and-survives-restart, Apply/Discard,
   and reset-defaults scenarios that exercise this exact reordering.

   `config/vitest/base.mjs`'s coverage `exclude` list grew from one entry to
   six: `options.ts` plus `pending-changes.ts`, `routing-preview-panel.ts`,
   `menu-preview.ts`, `manual-editor-actions.ts`, and
   `browser-capability-ui.ts` — the pieces that still run DOM/message-round-
   trip wiring against the real document the way `options.ts` always did
   (exercised by e2e, not unit coverage). `option-field-sync.ts`,
   `download-refresh.ts`, and `ui/disclosure-help.ts` are plain data-in/data-
   out or deterministic-DOM helpers and gained real unit tests instead
   (`test/options/core/option-field-sync.test.ts`,
   `test/options/core/download-refresh.test.ts`,
   `test/options/ui/disclosure-help.test.ts`); global coverage after the
   split matches the pre-existing baseline exactly (99.97/99.9/99.96/99.99%,
   the same numbers as before this change, with the same unrelated
   `shared/serial-queue.ts` gap the baseline already had).
5. **`downloads/download.ts`:** extract `download-plan.ts` (resolve/create
   plan, fetch rewrite, routing-match helpers), `download-disposition.ts`
   (content-disposition parsing), and `download-execution.ts`
   (`executeBrowserDownload`, `renameAndDownload`). Note
   `test/downloads/download-plan.test.ts` and `download-execution.test.ts`
   already exist — the test boundary predicts the module boundary.

   **Landed**, with the boundary adapted once the acyclic-import constraint
   was applied literally: `download.ts` (932 lines) is now six files totaling
   998 lines. `download-plan.ts` (228 lines) holds `resolveDownloadPlan`,
   `createDownloadPlan`, `applyFetchRewrite`, and `getRoutingMatch`/
   `getRoutingMatches`, exactly as scoped. `download-disposition.ts`
   (104 lines) holds `DISPOSITION_FILENAME_REGEX`,
   `getFilenameFromContentDisposition`, `resolveDispositionFilename`, and
   `finalizeFullPath` — `finalizeFullPath` moved here rather than staying
   with plan/execution because it is pure filename-finalization logic with no
   dependency on routing, ports, or `downloadRuntime`, and both `download-plan.ts`
   (`createDownloadPlan`) and `browser-downloads.ts`'s routing (via
   `registerDownloadListener`) call it without needing anything else this
   file owns; `makeObjectUrl` stayed in `download.ts` instead (see below).
   `download-execution.ts` (459 lines, `git mv`'d from `download.ts` as the
   largest share) holds `executeBrowserDownload` and `renameAndDownload` as
   scoped, plus `acquireFetchedUrl`/`acquireDownloadUrl` and
   `rememberStartedDownload`/`getStartedDownload`: the original plan listed
   these under "`download.ts` keeps," but their only production callers are
   `executeBrowserDownload`/`renameAndDownload` themselves, and `download.ts`
   already has to import `renameAndDownload` back for `launchDownload` — so
   leaving the acquisition/record helpers in `download.ts` would have made
   `download.ts` and `download-execution.ts` import each other, which
   `check-import-cycles.js` forbids. `download.ts` (75 lines) keeps
   `launchDownload`, `retryViaFetch`, `makeObjectUrl` (its only state is
   `downloadRuntime.generatedObjectUrls`, so it stays beside the runtime glue
   rather than moving to execution), and `registerDownloadListener`,
   importing `getRoutingMatches`/`finalizeFullPath`/`renameAndDownload` from
   their new homes for that wiring.

   Three more small files fell out of the same acyclic-graph requirement,
   since `requireDownloadUrl`, `isSourceSidecar`, `isPrivateDownloadState`,
   `addDownloadLog`, `isHttpDownloadUrl`, `throwIfAborted`,
   `releaseUnusedContent`, and `ensureHistoryEntry`/`historyEntry` are each
   called from two or more of `download.ts`/`download-plan.ts`/
   `download-execution.ts` and none of those three may import another:
   `download-pipeline-state.ts` (63 lines) holds the state guards and cleanup
   helper; `history-entry.ts` (60 lines, matching the doc's suggested name)
   holds the history-entry builder; `download-runtime-instance.ts` (9 lines)
   holds the `downloadRuntime` singleton, mirroring the existing
   `download-state.ts` (functions) vs. `download-state-instances.ts`
   (singleton) split. All three are leaves with no `downloads/` peer
   dependencies, so `download.ts`, `download-plan.ts`, and
   `download-execution.ts` each import downward from them without importing
   each other.

   The only production importer that needed an updated path was
   `background/route-preview.ts` (`getRoutingMatches` now from
   `download-plan.ts`); every other external importer
   (`background/ports.ts`, `background/e2e-command.ts`,
   `background/menu-click.ts`, `background/menu-tabs.ts`,
   `background/messaging/{auto-download,handlers}.ts`,
   `downloads/shortcut.ts`, `downloads/source-sidecar.ts`,
   `entries/background.ts`) imports `retryViaFetch`, `launchDownload`,
   `makeObjectUrl`, or `registerDownloadListener`, all of which stayed in
   `download.ts` unchanged. No barrel re-export was added to `download.ts`
   for the moved symbols; test fixtures update their import paths instead,
   per the no-barrel rule. The one deliberate exception is
   `test/downloads/download-flow.fixture.ts`, which merges fresh imports of
   `download-plan.ts`/`download-disposition.ts`/`download-execution.ts`/
   `download-runtime-instance.ts`/`download.ts` into one plain `Download`
   object — it backs five large test files
   (`download-plan.test.ts`, `download-execution.test.ts`,
   `download-flow.test.ts`, `download-retry.test.ts`,
   `download-acquisition.test.ts`, plus `history-source-url.test.ts` and
   `webhooks/download-webhook.test.ts`) that call `Download.<fn>` directly;
   updating every call site to import from the right one of five files would
   have been pure churn for the same coverage. `test/downloads/download-mv3.test.ts`
   and the `download-execution.test.ts` "concurrent downloads" describe block
   build the same kind of per-test merged object from fresh (`vi.resetModules()`)
   imports for the same reason. Two test files were `git mv`'d to match the
   symbols they actually exercise: `download.test.ts` →
   `download-disposition.test.ts` (it only ever tested `finalizeFullPath` and
   `getFilenameFromContentDisposition`), and `content-disposition.test.ts`'s
   inner "real parser" describe block now imports `download-disposition.ts`
   directly. `test/config/option.test.ts`'s `vi.mock` of `download.ts` (for
   `getRoutingMatches`, consumed via `route-preview.ts`) was repointed at
   `download-plan.ts`.

   Verified with `npm run lint`, `npm run typecheck`, `npm test` (2923
   passed), `npm run test:coverage` (99.97/99.9/99.96/99.99%, matching the
   pre-existing baseline exactly — including the same three now-relocated
   partially-covered branches in `download-plan.ts` and the unrelated
   `shared/serial-queue.ts` gap), `npm run check:coverage-policy` (74
   reviewed ignores, unchanged), and a full `npm run e2e` pass (Firefox
   32/32; Chrome 49/49 on rerun — one run had an unrelated flaky timeout in
   the template-library scenario, reproduced as a pass in isolation and on a
   clean rerun of the full suite).
6. **`downloads/notification.ts`:** extract `notification-events.ts` for the
   `onDownloadCreated` / `onDownloadChanged` / `onNotificationClicked`
   handlers, leaving creation/queueing and expected-download tracking in the
   core file alongside the existing `notification-model.ts` and
   `notification-recovery.ts`.

   **Landed**, with two extra extractions the acyclic-import constraint
   forced: `notification.ts` (695 lines) is now four files. `notification-events.ts`
   (505 lines, `git mv`'d from `notification.ts` as the largest share) holds
   `onDownloadCreated`, `onDownloadChanged`, and `onNotificationClicked`
   exactly as scoped, plus `addDownloadLog` and the `historyPort`/
   `backgroundRuntime` port bindings, which only those handlers used.
   `notification.ts` (128 lines) keeps `EXTENSION_NOTIFICATION_STREAMS`,
   `createExtensionNotification`, `reportExternalDownloadRejection`,
   `reportDownloadFailure`, `isDownloadFailure`, `resetNotifierTransientState`,
   and `registerNotifier` as the sole registrar, importing the three handlers
   from `notification-events.ts` for that wiring.

   `registerNotifier` needs the handlers and the handlers need
   `createNotification`/`EXTENSION_NOTIFICATION_STREAMS`/expected-download
   tracking, so leaving those three groups physically in `notification.ts`
   would have made `notification.ts` and `notification-events.ts` import each
   other — forbidden by `check-import-cycles.js`, the same shape the
   `download.ts` split hit. Two dependency-free modules absorb them, mirroring
   `download-pipeline-state.ts`: `notification-runtime.ts` (96 lines) holds
   `EXTENSION_NOTIFICATION_STREAMS`, the notification timer maps,
   `createNotification`, `queueExtensionNotification`, and
   `resetNotificationTimers`; `expected-downloads.ts` (57 lines) holds the
   `ExpectedDownload` tracking (`mergeTrackedDownload`, `getTrackedDownload`,
   `expectDownload`, `cancelExpectedDownload`, `findExpectedDownload`,
   `resetExpectedDownloads`) — the "another cohesive extract" this phase's
   scope allowed for. `notification.ts` re-exports `EXTENSION_NOTIFICATION_STREAMS`,
   `expectDownload`, and `cancelExpectedDownload` from these two files (its
   `resetNotifierTransientState` calls `resetNotificationTimers` and
   `resetExpectedDownloads`) because `menu-click.ts`, `filename-listener.ts`,
   `download.ts`, and `download-execution.ts` all import them via
   `"./notification.ts"` and that path is a preserved compatibility contract;
   `onDownloadCreated`/`onDownloadChanged`/`onNotificationClicked` are not
   re-exported since nothing in `src/` imports them from `notification.ts` —
   only two test call sites did, and those were repointed at
   `notification-events.ts` directly (`test/downloads/notifications/notification.test.ts`,
   `session.fixture.ts`), the same "update the test import path, don't add a
   barrel" rule the `download.ts` split used.

   Verified with `npm run lint`, `npm run typecheck`, and `npm test` (2923
   passed, including the unchanged 108 `test/downloads/notifications/` cases).
   Removing the now-dead `/* v8 ignore next */` guard in `onDownloadCreated`
   (a `findExpectedDownload`/`cancelExpectedDownload` pair replaced the old
   `findIndex`/`splice` that needed it) dropped the reviewed-ignore count from
   74 to 73; `scripts/check-coverage-policy.js`'s recorded ceiling was lowered
   to match, per that script's own policy.

Verification: unchanged unit tests must pass before and after each split
(splits are refactors, not behavior changes); watch the listener-owner and
composition-call allowlists in `check-import-cycles.js` — moving a listener
registration requires updating the owner list deliberately, not reflexively.

## Phase 3 — boundary and convention hardening

1. **Re-home feature code out of `shared/`.** For each of
   `source-panel-copy.ts`, `webhook.ts`, `history-normalization.ts`,
   `streaming-content.ts`: either move it into its owning feature directory
   (if the layering allows all current importers to reach it) or keep it in
   `shared/` but under a documented `shared/<feature>-` naming rule stating
   that shared may host feature *contracts and pure helpers* needed by
   multiple contexts. The goal is that `shared/` membership is a decision,
   not a default.

   **Landed** — none of the four moved; each was kept with a short comment
   explaining why, and the underlying reason is the same shape in every case:
   the file has two or more importers in directories that cannot legally
   import one another, so no single "owning feature directory" exists.
   - `source-panel-copy.ts`: imported by `background/messaging/{handlers,index}.ts`
     (runtime `createSourcePanelCopy`, not type-only) and by
     `content/source-panel*.ts`. Background and content are peer execution
     contexts; background importing a content/ implementation module would be
     the exact inversion the doc's own example called out. Stays in `shared/`.
   - `webhook.ts`: imported by `config/option-schema.ts`,
     `downloads/webhook-delivery.ts`, and
     `options/integrations/webhook-panel.ts`. `config/` may only reach
     `shared/`/`platform/` (`scripts/check-import-cycles.js`'s explicit config
     rule), so moving this into `downloads/` or `options/` would make
     `option-schema.ts` violate that rule outright. Stays in `shared/`.
   - `history-normalization.ts`: imported by `background/history.ts` and
     `options/history/history-panel.ts`. `options/` may not import
     `background/` (explicit checker rule); the reverse has no explicit
     checker rule but has zero existing precedent anywhere in `src/`
     (confirmed by grep) and would contradict AGENTS.md's "options talks to
     background exclusively via `runtime.sendMessage`" contract. Stays in
     `shared/`.
   - `streaming-content.ts`: imported by `downloads/content-fetch.ts` and
     `offscreen/offscreen.ts`. These are peer execution contexts that already
     communicate exclusively through `platform/offscreen-client.ts` message
     passing (verified: neither directory imports the other's implementation
     anywhere today); the helper itself is generic (streams a `Response` body
     into a `Blob` while incrementally hashing it) and arguably closer to
     `platform/`-tier than "feature" code, but no importer-driven move was in
     scope here, so it stays in `shared/` per the same two-peer-context
     reasoning as the other three.

   Each file now carries a short header comment recording this so the
   decision doesn't have to be re-derived by the next reader.
2. **Write the naming conventions down** (in AGENTS.md's Conventions section):
   `-model.ts` = pure, DOM-free, unit-tested; view file owns DOM and browser
   events; `-state.ts` reserved for genuinely pure state containers (rename
   `manual-editor-state.ts` accordingly); `-panel.ts` only for modules that
   wire a distinct options-page panel; per-layer `ports.ts` is the injection
   pattern. Conventions that are only in people's heads regress.

   **Landed.** Added a bullet to AGENTS.md's Conventions section covering all
   four points, plus the `shared/` membership rule from 3.1 (a module belongs
   there because two-or-more mutually-unreachable directories need it, not
   because it's merely reused — with a pointer to the four files' header
   comments as the pattern to follow). `manual-editor-state.ts` was renamed to
   `manual-editor-controller.ts`: it has 14 DOM references
   (`getElementById`/`querySelectorAll`/`addEventListener`/
   `dispatchEvent`/`insertBefore`) and is a stateful DOM controller, not a
   pure container, unlike every other `*-state.ts` file in `src/` (checked:
   `application-state.ts`, `source-panel-state.ts`, `download-pipeline-state.ts`,
   `download-runtime-state.ts`, `download-state.ts`, `wire-state.ts`,
   `field-save-state.ts`, `shared/session-state.ts` are all DOM-free). The
   rename was cheap — one production importer (`options/core/options.ts`) and
   its own test file — so it landed rather than being left as a documented
   exception; `git mv` preserved history for both files. The exported factory
   name `createManualEditorState` was left unchanged (it is an established
   call site, and the naming rule governs file suffixes, not every internal
   identifier); the file now carries a comment pointing at this distinction so
   a future reader doesn't assume the export needs to match. The "Problems" list
   (item 4, above) and Phase 1's file-placement table were left referencing
   the original filename, since both describe what existed at the time they
   were written; only live importers were updated.
3. **Extend `check-import-cycles.js`** for the new structure: options feature
   subdirectories should not import each other's internals (only `core/`,
   `ui/`, and cross-layer modules), mirroring how the checker already
   protects the top-level directories. Add the rule after Phase 1 so the new
   boundaries cannot silently erode.

   **Landed.** Measured first with a throwaway script that walked every
   `.ts` import under each of the eight feature directories (`dialogs/`,
   `history/`, `integrations/`, `path-editor/`, `reference/`,
   `route-debugger/`, `rule-editor/`, `syntax-editor/`) and flagged any target
   in a *different* feature directory: 22 existing cross-feature edges, too
   many and too varied to add as a blanket rule exception.

   Three files were genuinely shared data/vocabulary, not feature logic, and
   moved out of `reference/` into `core/` instead of being exempted:
   `matcher-descriptions.ts`, `reference-descriptions.ts`, and
   `vocabulary-groups.ts` (with their tests, `test/options/reference/{matcher,
   reference}-descriptions.test.ts` → `test/options/core/`, and
   `test/i18n/vocabulary-groups.test.ts`'s import path updated in place). All
   three had zero or trivial same-directory dependencies and were already
   imported by three or more unrelated features (`path-editor`, `rule-editor`,
   `syntax-editor`, plus `reference/` itself) — the same "no single owning
   feature directory" shape as Phase 3.1, resolved the same way Phase 3.1's
   own reasoning suggested: relocate to `core/` when the layering allows every
   importer to reach it there (it does — `core/` is always a legal cross-
   feature target). This dropped the count from 22 to 12. Phase 1's
   file-placement table and the "Problems" list (both above) still describe
   `reference/` as it was when Phase 1 landed; they were not rewritten, same
   as the `manual-editor-state.ts` precedent in 3.2.

   The remaining 12 edges are real infrastructure reuse — one editor feature
   built on another editor's engine or pure model (`path-editor.ts` and
   `rule-visual-editor.ts` both drive their text-mode textarea through
   `syntax-editor/{autocomplete,editor-validation,syntax-editor-model}.ts`;
   `rule-builder.ts` inserts generated rule text through `PathEditor
   .insertText` and highlights it via `syntax-editor.ts`;
   `reference/variables-preview.ts` inserts a clicked variable into the
   focused path-editor field; `route-debugger-model.ts` reuses
   `rule-visual-editor-model.ts`'s pure rule parser to resolve which rule a
   simulated request matches; `manual-editor-controller.ts` reads both
   editors' pure models to diff visual rows). None of this is a second
   grammar or a redesign target — it is the same kind of load-bearing reuse
   Phase 1 already described for the `-model.ts` pattern, just crossing a
   feature-directory line the checker had never enforced before. These landed
   as an exact, file-to-file `allowedCrossFeatureImports` allowlist in
   `check-import-cycles.js` (12 entries, one per real edge, each with a
   one-line comment on why it exists) rather than a directory-level exception,
   so a new, unrelated cross-feature import still fails the check. Verified
   the rule actually fires by temporarily adding an unauthorized edge
   (`history-panel.ts` importing `path-editor.ts`) and confirming it was
   reported, then reverting.
4. **Consolidate the automation concern.** Gather
   `routing/automatic-rule.ts` eligibility, `automation/*`, and the
   `handleAutoDownloadSource` orchestration (Phase 2.1) so `automation/`
   owns the feature end-to-end, with `routing/` keeping only what the generic
   rule engine needs. This must not introduce a second automation grammar —
   it is a relocation, not a redesign (see the AGENTS.md constraint).

   **Assessed; not cleanly achievable — documented instead.** Three of the
   five pieces already live under `src/automation/`
   (`automatic-routing.ts`, `auto-download-rules.ts`, `source-rule-draft.ts`
   — the last is the pure `createSourceRuleDraft` template builder, imported
   by `background/messaging/index.ts`; do not confuse it with the unrelated
   `options/rule-editor/source-rule-draft.ts`, which *consumes* a stored draft
   into the rule editor UI and is correctly an options-page concern). The two
   remaining candidates both have a real dependency that blocks the move,
   checked by enumerating every importer:
   - `routing/automatic-rule.ts`: `routing/rule-parser.ts` — a routing-internal
     module, not just a downstream automation consumer — imports
     `automaticRuleClauseIssues`/`isAutomaticRuleClauses` to validate an
     AUTO-context rule's clauses inline while parsing. Moving the file to
     `automation/` would force `rule-parser.ts` to import `automation/`,
     inverting the intended direction (automation depends on the generic
     routing engine, not the reverse) and contradicting AGENTS.md's own
     framing of this file as what "the generic rule engine needs" to
     recognize AUTO-context eligibility. Confirmed via `grep` that no other
     `routing/` file imports `automation/` today, so this stays a routing/
     module by design, not by drift.
   - `background/messaging/auto-download.ts`: `handleAutoDownloadSource`'s
     signature (`MessageSender`, `ProtocolSendResponse` from
     `background/messaging/protocol.ts`) is a background message-handler
     shape, registered into `background/messaging/index.ts`'s
     `internalHandlers` dispatch table — the sole reviewable listener owner
     per AGENTS.md's "listener registration ... restricted to named
     composition owners." Moving it into `automation/` would require
     `automation/` to import background-messaging protocol types, the same
     kind of inversion as above. Phase 2.1's Landed note already anticipated
     this file would grow as the automation-orchestration seam; it grows in
     place, not by relocating.

   Both boundaries this assessment surfaced are now enforced mechanically,
   not just documented in prose: `check-import-cycles.js` gained
   `src/automation/` to the existing "routing must depend only on shared
   contracts and injected ports" forbidden-dependency list, plus a new
   symmetric rule forbidding `src/automation/` from importing
   `src/background/` or `src/downloads/` implementations. Both were verified
   to fire (temporarily added an unauthorized edge in each direction,
   confirmed the violation was reported, then reverted) and both are green
   against the current tree — no existing import needed to change. No rule
   grammar, editor behavior, or message payload changed in this step.

## Phase 4 — the sixth god module

Phase 2 named five god modules and split all five. It missed a sixth, because
the list was written before that file grew: by the time Phases 1–3 had landed,
`src/options/history/history-panel.ts` (1155 lines) was the largest file in
`src/` — larger than any of the five had been except `source-panel.ts`.

1. **`options/history/history-panel.ts` → the concerns it had accumulated.**
   It had the Phase 2 shape exactly: `renderHistoryTable` alone ran ~470 lines
   and 49 `createElement` calls, and the file also owned the filter bar, inline
   SVG icons, a `setInterval` progress poller, reroute destinations, CSV/JSON/
   TSV export, and a clear-history dialog.

   **Landed**, following the Phase 2 pattern: pure logic stayed in the existing
   `history-view.ts`, view state moved to a DOM-free `history-panel-state.ts`,
   and each concern became a module — `history-icons.ts`, `history-messages.ts`
   (the localizer seam), `history-columns.ts`, `history-filters.ts`,
   `history-row.ts`, `history-row-actions.ts`, `history-table.ts`,
   `history-toolbar.ts`, `history-actions.ts`, `history-progress.ts`,
   `history-clear-dialog.ts`. `history-panel.ts` is now a 46-line composition
   root.

   The same acyclic-import wall the `download.ts` and `notification.ts` splits
   hit shaped the result: the table, its row actions, and the progress poller
   all need to reload history, and `renderHistory` needs to repaint the table.
   `renderHistory` therefore lives in a leaf `history-refresh.ts`, and
   `history-panel.ts` registers the table renderer through an owner-controlled
   live binding — the `activePanelHost` pattern from Phase 2.3. For the same
   reason `setupHistoryFilters`/`setupHistoryColumnOptions` take the repaint
   callback instead of importing `history-table.ts`. `renderHistory`,
   `setHistoryLocalizer`, and `showClearHistoryDialog` are re-exported from
   `history-panel.ts` because `entries/options.ts`, `core/options.ts`, and the
   panel tests import them from that path (the `notification.ts` precedent); no
   other barrel was added.

   Two dead branches the split introduced were removed rather than annotated.
   `HistoryDisplayColumn["key"]` was `keyof HistoryRow | "index"`, always looser
   than reality — it admits `historyId`, `reroutable`, and `variableEntries`,
   none of which are columns. `HistoryColumnKey` now excludes them, which makes
   the cell-builder table total: a column added without a builder is a compile
   error instead of a silently missing cell. Building each cell only when its
   column is visible also let the row builder read its label off the column it
   was already iterating, retiring the `columnLabels` lookup and its `v8 ignore`;
   the reviewed-ignore ceiling stays at 76 because `history-refresh.ts`'s
   placeholder renderer gained one, annotated as `source-panel-context.ts`'s
   placeholders are.

   The 89 existing panel/view tests passed untouched, which is Phase 2's stated
   verification rule for a split. Unlike Phase 2.3, the test file did not need
   splitting: `panel.cases.ts` was already a separate cases file behind a
   three-line `panel.test.ts`.
2. **Audit existing names against the Phase 3.2 conventions.** Phase 3.2 wrote
   the naming rules down but did not check the tree against them.

   **Landed** — one file had drifted. `history-view.ts` was the only
   `*-view.ts` in `src/` and had zero DOM references, while the eight
   `*-model.ts` files it sat beside are the pure ones; under 3.2's own rule its
   name said the opposite of what it was. Renamed to `history-model.ts` with
   `git mv` (and its test, `view.test.ts` → `model.test.ts`), the same call 3.2
   made for `manual-editor-state.ts` → `manual-editor-controller.ts`: the rename
   was cheap, so it landed rather than becoming a documented exception. Its
   header comment was stale in the same way and was rewritten.

3. **Make the suffix prove itself.** A convention that only a reviewer enforces
   drifts again — 4.2 is the evidence. The durable fix is mechanical: a check
   that `*-model.ts` and `*-state.ts` contain no DOM references, the way
   `check-import-cycles.js` already enforces layering.

   **Landed** in `check-import-cycles.js`, which already walks every module and
   owns the per-file text rules. `scripts/lib/architecture-checks.js` gained
   `domReferences`, which reports the DOM globals (`document`, `window`,
   `navigator`, `localStorage`, `sessionStorage`, and their `globalThis.` forms)
   and DOM element types (`HTML*Element`, `SVG*Element`, `ShadowRoot`,
   `NodeList`, `HTMLCollection`, `DOMParser`, `DOMRect`) a module references.
   `src/content/source-panel-model.ts` is the one exception, carrying AGENTS.md's
   documented reason inline; removing it was verified to make the check fire.

   The scanner reads code, not text. Three of the eighteen `-model.ts`/`-state.ts`
   files mention "document" in prose or in a string — `prompt-assistant-model.ts`
   has it as a *vocabulary term* in the on-device prompts, and it is a
   source-kind the DSL offers — so a word match would have failed the build on
   correct code. `domReferences` therefore strips comments and string literals
   first, keeping `${...}` substitutions (`` `${document.title}` `` is real DOM
   usage) and skipping regex literals whole, since a quote inside `/["']/` would
   otherwise open a phantom string and hide the code after it. Bare `Node`,
   `Element`, and `Event` are deliberately not flagged: a pure model may name its
   own AST node or domain event type.

   Verified by construction rather than by assertion: the rule was confirmed to
   fire on real DOM access, on a DOM type, and on a template substitution; to
   stay silent on comments, strings, and a regex containing quotes; and to be
   green across the tree as it stands. `test/contracts/architecture-checks.test.ts`
   covers `domReferences` and `stripCommentsAndStrings` at the pure-function
   boundary, where the existing scanners are already tested.

Verification: `npm run lint`, `npm run typecheck`, `npm test`,
`npm run test:coverage` (`options/history` at 100% on all four metrics; global
99.99/99.99/100/99.99, at or above the baseline recorded in Phase 2.5),
`check-import-cycles.js` across 252 modules, and `npm run bundle` for entry
resolution. No e2e run: the split preserves `setupHistoryPanel`'s wiring order
and its import-time call exactly, and the panel is options-page DOM covered by
90 jsdom tests rather than browser-owned behavior.

4. **Make `shared/` actually point downward.** Phase 2.2 left this as its one
   unfinished bullet: `shared/message-protocol.ts` `import type`s upward into
   four feature directories, "legal only because the checker erases type edges,
   which weakens the `shared` points downward guarantee."

   **Landed**, in the form the problem turned out to have. The guarantee was
   enforced by two different maps: the `routing/` rule iterates `imports`
   (every edge, type included), while the `shared/`/`platform/` rule iterated
   `graph`, whose own comment said "Type-only contract references remain erased
   from this graph." The lower layers had the weaker check. Both now run over
   `imports`, and the violation names whether the edge was `type` or `runtime`.

   Three edges were inverted rather than exempted, each a pure contract that had
   simply been declared beside its implementation:
   - `RoutePreview` (`background/route-preview.ts` → `shared/route-preview-types.ts`).
     Four lines, no dependencies, and literally the CHECK_ROUTES response
     payload. `RoutePreviewState` stayed in `background/` — it is `previewRoutes`'
     own argument and never travels.
   - `ExtensionFetchCredentials` (`config/fetch-credentials.ts` →
     `shared/content-fetch-types.ts`). A one-line `"include" | "omit"` union,
     joining the fetch contracts its only consumers already imported from there.
     `getExtensionFetchCredentials` stays in `config/`: reading the option is
     config's job, naming the mode is not.
   - The storage port shapes (`platform/storage-areas.ts` →
     `shared/storage-types.ts`). `StorageReader`/`Writer`/`Setter`/`Remover`/
     `Area` are structural "something with a `.get()`" contracts with no browser
     dependency, and `shared/session-state.ts` accepts them as injected ports.
     Only the two live areas needed `webExtensionApi`, and they stayed. This
     edge was **not** in the original problem statement — the stricter rule
     found it, because a `grep` for `^import type` misses inline `{ type X }`
     specifiers.

   The four remaining edges are an exact `allowedUpwardTypeEdges` allowlist, one
   entry per real edge with its reason, mirroring Phase 3.3's
   `allowedCrossFeatureImports`. Each covers the **erased type edge only**: the
   same file pair still fails if it ever needs the value, which was verified.
   They are `DownloadInfo` (a DOWNLOAD body carries the pipeline's own type),
   `MenuTree` (PREVIEW_MENUS answers with the builder's tree verbatim),
   `RuleError` (VALIDATE reports the parser's error shape), and `OptionErrors`.

   `OptionErrors` is the one left worth inverting — the only remaining edge into
   the composition layer — and it is deliberately not done here. It is
   `{ paths: MenuTreeError[]; filenamePatterns: OptionError[] }`, so moving it
   would trade a `shared → background` edge for a `shared → menus` one unless
   `MenuTreeError` moves too. Whether the menu tree is a wire contract in its own
   right is the design question Phase 2.2 named, and it deserves its own step
   rather than being smuggled into an enforcement change.

   Verified by construction: the rule fires on a new upward type edge and on a
   new upward runtime edge, reports each with the right kind, and an allowlisted
   pair still fails when it needs a value. Green across 255 modules, with
   `npm run lint`, `npm run typecheck`, `npm test` (4014), and `npm run bundle`.

5. **`options/path-editor/path-editor.ts` — decomposed, not split.** Phase 2.4's
   note called this "an 867-line file slated for its own future split." Measuring
   it first changed the verdict, and the note should not be read as a standing
   plan.

   **Landed as a decomposition.** The file's concerns are not mixed: everything
   in it serves the drag-and-drop directory-tree editor. What it had was a god
   *function* — `setupVisualEditor`'s `render` closure ran ~480 lines and built
   every part of every row in one pass (indent, handle, enabled toggle, directory
   input, alias and its toggle, access key, the six "more" actions, and the drop
   zones between rows), naming none of it. Its two sibling editors do not work
   that way: `rule-visual-editor.ts` is longer still and stays legible because its
   closure is ~17 named helpers.

   So sixteen named builders now sit in that same closure and `render` is 30
   lines. The shared state (`nodes`, `dragFrom`, `deletedNodes`) never moved,
   which is why this needed no context object and no module boundary — unlike
   Phase 4.1, where the concerns genuinely were unrelated. Splitting the file
   would have invented seams the feature does not have, and the line count is not
   the defect: a file that does one job thoroughly is not a god module at 900
   lines.

   The 87 existing tests passed untouched. Coverage is 100% statements and
   functions; `check-import-cycles.js`'s cross-feature allowlist was unaffected,
   since no import moved.

6. **Sweep the remaining god functions.** With 4.5's bar established —
   decompose the function, do not split a cohesive file — the tree was measured
   for every function over 150 lines rather than trusting the earlier
   impressions. Two more were the same defect, and both landed:
   - `content/source-panel-row-render.ts`'s `render` (536 lines) was the largest
     function in `src/`. Phase 2.3 extracted this file *as* a builder but left
     everything inside one pass: kind facets, empty state, and per row the
     selection checkbox, preview or glyph, source link, metadata, the "more"
     menu, the hover tooltip, and the alt-click gestures. Twenty named builders;
     `render` is 64 lines. The subtlety worth knowing: `render` destructured
     `copy`/`formatters`/`panelOptions` from `ctx` at render time, and those are
     mutable (`buildPanelUpdate` replaces them) while the row cache keeps rows
     across renders — so each builder destructures at row-build time, the same
     tick. Reading `ctx.*` lazily inside the update closures would have been a
     real behavior change.
   - `options/route-debugger/route-debugger.ts`'s `renderTrace` (347 lines) →
     eleven builders, 13 lines. `TracedRule`/`TracedClause` are derived from
     `RouteDebuggerTrace` rather than re-imported, so they cannot drift.

   What was deliberately left, having been measured rather than assumed:
   `rule-templates.ts`'s `localizeRuleTemplates` (369) and `webmcp.ts`'s
   `buildTools` (356) are declaration tables — a translations map and a list of
   self-contained tool definitions. Long, not tangled; splitting them buys
   nothing. `setupRuleVisualEditor` (823), `setupRouteDebugger` (769),
   `wirePanelRowRender` (733), and `wirePanelRefresh` (304) are the
   decomposed-container shape this phase produces, which is the goal, not a
   finding.

   **`downloads/notification-events.ts`'s `onDownloadChanged` (287) is the one
   real god function left, and it is not a sweep-up job.** The original problem
   statement named it ("`onDownloadChanged` alone is ~280 lines") and Phase 2.6
   moved it without decomposing. Every function above was straight-line DOM
   building, where extraction is mechanical; this one is an async procedure with
   5 early returns and 31 awaits over the download pipeline's own state. Its
   sections cannot be lifted without threading handled/continue signals back to
   the caller — a design change (a pipeline of steps, say), not a rename, in the
   file where a subtle mistake silently breaks downloads. It needs its own step
   with `npm run e2e`, not the end of a sweep. (It got one: 4.8 below, where the
   "threading signals" prediction turned out to be wrong.)

7. **The last accidental name collision.** Phase 1.5 renamed the collisions it
   found (`event-task.ts`, `state.ts`) and kept the intentional `ports.ts`
   triplet. It missed one, because both halves sit in different top-level
   directories rather than side by side: `automation/source-rule-draft.ts`
   (the pure `createSourceRuleDraft` builder that writes a draft rule) and
   `options/rule-editor/source-rule-draft.ts` (which picks a stored draft up and
   applies it to the editor). Unrelated jobs, same name — and Phase 3.4's own
   prose above is the evidence, since it has to tell the reader "do not confuse
   it with" the other one.

   **Landed.** The consumer is now
   `options/rule-editor/source-rule-draft-intake.ts`, named for what it does:
   `applySourceRuleDraft`/`setupSourceRuleDraft` take in a draft made elsewhere.
   The builder keeps its name, which matches its export, and the "draft"
   vocabulary still finds both. The test files moved with it
   (`source-rule-draft-intake{,-concurrency}.test.ts`), which retires the same
   collision in the test tree. `check-import-cycles.js`'s listener-owner
   allowlist names this file by path and had to be updated — it reported the
   rename, which is the rule working.

   Phase 3.4's text above still says the old path, per this document's rule that
   a phase names files as they were when it landed.

   Two flat directories were measured and deliberately left: `src/shared/` (34
   files) and `src/downloads/` (33, with `test/downloads/` already grouped into
   `notifications/`, `webhooks/`, and `history/`). That is Phase 1's own problem
   statement — a test tree with subdirectories the source lacks — recurring at
   a tenth of the scale: `downloads/`'s biggest cluster is 5 `notification*.ts`
   files against the ~120 that justified splitting `options/`. Subdividing would
   rewrite import paths across the layer and every path-based rule in
   `check-import-cycles.js` for a directory a reader can already scan. Revisit
   if a cluster grows, not before.

8. **The last god function.** `downloads/notification-events.ts`'s
   `onDownloadChanged` (287 lines), deferred by 4.6 above and named in this
   document's original problem statement.

   **Landed, and 4.6's reasoning for deferring it was half wrong.** The fear was
   that its sections could not be lifted without threading handled/continue
   signals back to the caller. Reading it closely, its control flow is much
   smaller than its size: the early returns are all *one question* — is this
   delta ours? — answered three ways (no record, a browser-owned download, one we
   no longer adopt). They stay in the orchestrator, where a reader can see them,
   and everything after them is straight-line. No signal threading was needed;
   what looked like tangled control flow was branches that had never been named.

   So the branches became steps: `handleObservedBrowserDownload`,
   `syncChromeDeltaFilename`, `writeSourceSidecar`, `handleFailedDownload` (which
   owns the retry-then-report chain), `notifyDownloadFailure`,
   `notifyDownloadSuccess`, `releaseTerminalDownload`, and `recordHistoryStatus`,
   which now takes the download id instead of closing over the delta.
   `onDownloadChanged` is 63 lines. The helpers are deliberately unexported —
   4.6's own export rule would flag them otherwise, which is the rule doing its
   job on the next change after it landed.

   The behavior-preserving subtlety worth knowing: the four notify settings were
   read once at the top, ahead of 31 awaits. A helper reading `options` live
   would let a settings change mid-download report one save two different ways,
   so `readNotifySettings` snapshots them and each step takes the snapshot.

   Verified as 4.6 said it must be: the 135 notification tests and all 746
   download tests pass untouched, and both browser suites pass on the staged
   bundle — Chrome 56/56, Firefox 39/39. A first Chrome run failed the
   template-library scenario, the same flake Phase 2.5 records; it passes on a
   clean rerun and does not touch this file.

   **`src/` now has no god module and no god function.** The largest functions
   left are the decomposed container closures this work produces
   (`setupRuleVisualEditor`, `setupRouteDebugger`, `wirePanelRowRender`) and two
   declaration tables (`localizeRuleTemplates`, `buildTools`) that are long
   rather than tangled.

## Non-goals

- No behavior, message-payload, storage-shape, or manifest changes; all
  established compatibility contracts hold.
- No frameworks, no barrel-file `index.ts` re-export layers for their own
  sake, no bundling/minification changes — bundles stay readable.
- No mass renaming beyond the specific collisions listed; churn without a
  navigation payoff is a cost.

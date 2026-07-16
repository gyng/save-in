# Code organization improvement plan

A phased plan for improving how Save In's source is arranged. Scope is
file/directory layout, module boundaries, and naming — not runtime behavior,
features, or the build model. The ESM + readable-bundle architecture,
the enforced import layering, and the execution-context split described in
[AGENTS.md](../AGENTS.md) stay as they are; this plan strengthens them.

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
4. **Consolidate the automation concern.** Gather
   `routing/automatic-rule.ts` eligibility, `automation/*`, and the
   `handleAutoDownloadSource` orchestration (Phase 2.1) so `automation/`
   owns the feature end-to-end, with `routing/` keeping only what the generic
   rule engine needs. This must not introduce a second automation grammar —
   it is a relocation, not a redesign (see the AGENTS.md constraint).

## Non-goals

- No behavior, message-payload, storage-shape, or manifest changes; all
  established compatibility contracts hold.
- No frameworks, no barrel-file `index.ts` re-export layers for their own
  sake, no bundling/minification changes — bundles stay readable.
- No mass renaming beyond the specific collisions listed; churn without a
  navigation payoff is a cost.

## Sequencing and risk

- **Phase 1 is one merge hazard.** It rewrites import paths across the
  options tree; land it as its own PR on a quiet worktree, after in-flight
  branches (currently the v4 namespace-export work) merge. Everything in
  Phases 2–3 can then proceed incrementally, one module per PR.
- **Mechanical checks are the safety net.** Every phase must keep
  `npm run lint`, `npm run typecheck`, `npm test`, and the bundle build
  green; Phase 1 and each Phase 2 split should also get one
  `npm run e2e` pass since entry resolution and listener registration are
  exactly the things file moves can break.
- **History preservation:** use `git mv`, keep move-commits free of content
  edits so `git log --follow` and blame stay useful.

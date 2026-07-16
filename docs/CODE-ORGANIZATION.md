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

   | Directory | Contents (today's flat files) |
   | --- | --- |
   | `core/` | the `options-*` family, `options.ts`, `tabs.ts`, `tab-controls.ts`, `tab-context-controls.ts`, `theme.ts`, `l10n.ts`, `language-selector.ts`, `saved-indicator.ts`, `field-save-state.ts`, `option-search.ts`, `option-navigation.ts`, `reset-options.ts`, `settings-transfer.ts`, `deferred-page-reload.ts` |
   | `path-editor/` | `path-editor{,-model,-insert-menu}.ts`, `path-source-selection.ts`, `style-path-editor.css` |
   | `rule-editor/` | `rule-visual-editor{,-model}.ts`, `rule-builder.ts`, `rule-templates.ts`, `source-rule-draft.ts`, `style-rule-editor*.css`, `style-template-library.css` |
   | `syntax-editor/` | `syntax-editor{,-model}.ts`, `editor-validation.ts`, `manual-editor-state.ts`, `autocomplete.ts`, `style-syntax-editor.css`, `style-syntax-popovers.css` |
   | `route-debugger/` | `route-debugger{,-model}.ts`, `style-route-debugger*.css` |
   | `history/` | `history-panel.ts`, `history-view.ts`, `history-feedback.ts`, `style-history*.css` |
   | `integrations/` | `webmcp.ts`, `webhook-panel.ts`, `integration-panel.ts`, `debug-log-panel.ts`, `counter-panel.ts`, `style-advanced-integrations.css` |
   | `dialogs/` | `*-dialog.ts`, `welcome-dialog.css`, `style-dialogs.css`, `style-about.css` |
   | `reference/` | `reference-page.ts`, `reference-descriptions.ts`, `matcher-descriptions.ts`, `vocabulary-groups.ts`, `variables-preview.ts`, `reference.css` |
   | `ui/` | shared UI primitives: `typeahead.ts`, `anchored-floating-surface.ts`, `details-menu-positioning.ts`, `dismissible-details.ts`, `clipboard.ts`, `click-to-copy.ts`, `latest-only.ts`, `latest-task.ts`, `checkbox-rows.ts`, `permissions-banner.ts`, `style-typeahead.css` |
   | `styles/` | non-feature CSS: tokens, base, themes, palettes, shell, layout, components, utilities, accessibility, status, feedback |

   Leftovers (`shortcut-options.ts`, `source-shortcut.ts`,
   `style-automation.css`, `style-workflows.css`, …) get placed with their
   closest owner during the move; nothing stays at the top level except
   `style.css`, `options.html`, `clauselist.html`, `assets/`, `i/`.
2. **Align `test/options/` to the same names** and fold the 43 flat test files
   into the matching subdirectories. Group the five scattered
   `test/content/source-panel*.test.ts` files into
   `test/content/source-panel/`.
3. **Move `src/offscreen.ts` → `src/offscreen/offscreen.ts`** and update the
   `entries/offscreen.ts` shim and the listener-owner allowlist in
   `check-import-cycles.js`.
4. **Delete the three one-line shims.** Point the five options importers of
   `floating-position.ts` at `../shared/floating-position.ts`; rename
   `welcome-dialog.css` / `reference.css` (or the shims) so `style.css`
   imports real files directly.
5. **Rename the accidental collisions:** merge or rename the two
   `event-task.ts` files (they are both 22 lines — check if one can import
   the other), and give `background/state.ts` / `downloads/state.ts` more
   specific names if a cheap rename is possible (`menu-state.ts`,
   `download-map.ts` or similar). Keep the intentional per-layer `ports.ts`
   pattern.
6. **Sweep stale `.js` references in comments** while touching these files.

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
4. **`options/options.ts`:** move top-level DOM side effects into named setup
   functions registered through the existing `options-bootstrap.ts` ports
   pattern; extract autosave/dirty-state tracking into a `core/` module and
   the `onDownloaded` fan-out into a small subscriber registry so panels
   subscribe instead of being hard-wired. Target: `options.ts` becomes a real
   composition root under ~200 lines.
5. **`downloads/download.ts`:** extract `download-plan.ts` (resolve/create
   plan, fetch rewrite, routing-match helpers), `download-disposition.ts`
   (content-disposition parsing), and `download-execution.ts`
   (`executeBrowserDownload`, `renameAndDownload`). Note
   `test/downloads/download-plan.test.ts` and `download-execution.test.ts`
   already exist — the test boundary predicts the module boundary.
6. **`downloads/notification.ts`:** extract `notification-events.ts` for the
   `onDownloadCreated` / `onDownloadChanged` / `onNotificationClicked`
   handlers, leaving creation/queueing and expected-download tracking in the
   core file alongside the existing `notification-model.ts` and
   `notification-recovery.ts`.

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
2. **Write the naming conventions down** (in AGENTS.md's Conventions section):
   `-model.ts` = pure, DOM-free, unit-tested; view file owns DOM and browser
   events; `-state.ts` reserved for genuinely pure state containers (rename
   `manual-editor-state.ts` accordingly); `-panel.ts` only for modules that
   wire a distinct options-page panel; per-layer `ports.ts` is the injection
   pattern. Conventions that are only in people's heads regress.
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

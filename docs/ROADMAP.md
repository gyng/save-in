# Roadmap

Planned work after the 4.0.0 release. The 4.1 section is an implementation
plan rather than a directional list: the routing-grammar decision is made and
part of the work is in flight, so items name the modules they change and the
tests that gate them. Nothing lands without the usual test, lint, and review
gates. Issue numbers refer to the GitHub tracker.

## 4.0 release follow-through

Not features — release hygiene that unblocks everything below.

- Close the issues cited in the 4.0.0 changelog (the MV3 rebuild, ordinary
  browser download handling, route debugger, templates, autosave, redirect
  Referer protection, Recent locations, per-location Save As dialogs, and
  source shortcuts resolve roughly 28 open reports).
- Close #104 as by-design: the Last used access key is its own setting
  (`keyLastUsed`), deliberately independent of the numbered-shortcut toggle.
- Ask the reporters of #207, #196, and #143 to retest on 4.0; those Firefox
  breakage reports predate the rewrite.

## 4.1 — coverage and control

Shipped while 4.0.x patches absorb feedback. Five tracks. The first two are
ordered — the template collections build on `fetch:` — and the remaining
three are independent of each other and can land in any order.

1. Routing grammar: `fetch:` URL rewriting (#137) — decided, in progress.
2. Site template collections (#187, #189, #209, #210, #211) — after `fetch:`.
3. Page Sources automatic scan: link-discovered sources.
4. Per-site disable list (#183).
5. Undo last save (#102).

### Routing grammar: `fetch:` URL rewriting (#137)

The grammar RFC planned for 4.1 resolved early: 4.1 ships URL rewriting as a
`fetch:` clause and rejects conditionals (#180) and continuous rules (#171)
— rationale under non-goals. `fetch:` adds a capability the grammar lacked
(choosing the URL that gets downloaded), requires no change to the ordered
first-match router, and directly unblocks the site-originals templates
below. It extends the single `filenamePatterns` grammar and its editor; no
second grammar is introduced.

Design: a rule may carry at most one `fetch:` clause holding a URL template.
When the rule matches, the download is acquired from the expanded `fetch:`
URL while `into:` keeps controlling destination and naming. Capture
placeholders `:$n:` and routing variables expand inside the template, but
never through `Path` — slashes and query strings stay literal
(`routing/fetch-url.ts`).

Validation, enforced in `routing/rule-parser.ts`: literal `http(s)://`
prefix, at most one `fetch:` per rule, capture indexes within bounds, unknown
variables rejected, and metadata-dependent variables banned
(`FETCH_URL_BANNED_VARIABLES`) because expanding them would fetch the very
URL being replaced. Rules with `fetch:` are excluded from rename-only
ordinary-download routing — `downloads.onDeterminingFilename` can rename a
browser download but cannot swap its URL. Shadow diagnostics treat fetch and
non-fetch rules separately.

Remaining work, in order:

- Pipeline: the download-plan rewrite step in `downloads/download.ts`
  (template expansion, plan invalidation, disposition-filename factoring),
  the ordinary-download eligibility seam in `downloads/filename-listener.ts`,
  and the fetch template through automatic saves and messaging.
- Diagnostics: route-debugger trace gains per-rule fetch state, the selected
  template, and the rewritten URL, with two-stage expansion; new rule-error
  keys in `_locales/en`.
- Editor surfaces: insert menu and autocomplete vocabulary (excluding banned
  variables), syntax-editor tokens and completions, a visual-editor row
  ("Rewrite download URL"), and a route-debugger stage row.
- Reference and guides: clause reference tables on the options and reference
  pages, `check-reference-vocabulary`, the routing guide and AI-prompt block,
  integration-grammar prose, and updates to
  [AUTOMATIC-SOURCE-SAVES](AUTOMATIC-SOURCE-SAVES.md) and
  [INTEGRATIONS](INTEGRATIONS.md).
- i18n: every new key translated in the generated catalogs; `check:i18n`
  stays green.

Tests: parser/matcher/expansion unit matrices (in place with the core),
pipeline and ordinary-seam and automatic-save coverage, debugger trace tests,
editor tests. The changelog entry cites #137 when it lands.

### Site template collections (#187, #189, #209, #210, #211)

Two new categories in the template catalog
(`src/options/rule-templates.ts`); pure data and copy, no engine change.

- Site originals — `fetch:`-based templates that rewrite to the
  original-quality asset URL (Twitter `?name=orig`, Reddit, Wikimedia,
  YouTube thumbnails). The user-facing payoff of the grammar decision.
- Site filing — naming and routing rules: strip the scheme from
  `:pageurl:`-based names (#209), Twitter handle prefixes (#210), Instagram
  username prefixes (#211), title-based renames for DeviantArt's hashed
  filenames (#189), and underscore/slug naming through the existing
  `:pagetitleslug:` (#187).

Implementation notes:

- New entries in `RULE_TEMPLATES` plus the new categories in the
  `RuleTemplate` union and their label keys.
- Every template ships a self-contained `proof` (routing input → expected
  destination); the `test.each` proof suite in
  `test/routing/core-matcher-regressions.test.ts` enforces it.
- Names and descriptions localize through `localizeRuleTemplates`,
  `_locales/en`, and the generated catalogs. The library search filter only
  matches name, description, and rule text, so site names must appear in the
  copy (there is no keyword field).
- Honest limits stay documented in template descriptions: #187's general
  find-and-replace ask is not covered — slug variables handle the common
  cases, and the general form is a 4.2 grammar question, not a template.

### Page Sources automatic scan: link-discovered sources

Phase A of the scan-coverage plan. The automatic scan and the Page Sources
panel already share one collector (`collectPageSourceCandidates` in
`src/content/source-panel-model.ts`); the scan currently passes
`includeLinks: false` (`src/content/auto-download.ts`). Phase A turns anchor
discovery on for the automatic scan, restricted to anchors the collector
classifies as previewable media — image, video, or audio by URL extension.
Anchors classified `stream`, `document`, or plain `link` stay out until 4.2,
as do CSS backgrounds, resource-timing playlist hints, and `data:`/`blob:`
sources.

Everything else is deliberately unchanged: eligibility (`context: ^auto$`
plus at least one page and one source matcher), the HTTP(S)-only URL gate,
once-per-visit dedup, the per-page save limit, and the background's
re-matching against the trusted sender-tab URL. The live-discovery
`MutationObserver` already watches `href` mutations. A matched `.jpg` anchor
flows through as `sourcekind: image`, so existing rules keyed on
`sourcekind:`, `urlfileext:`, or `fileext:` apply without new matchers.

Implementation: enable link collection in the scan's collector call and
filter the collected candidates to media kinds; no message, background, or
eligibility change. Retire the "does not adopt sources found through links"
paragraph in [AUTOMATIC-SOURCE-SAVES](AUTOMATIC-SOURCE-SAVES.md) and state
the anchor-classification rule there.

Tests: discovery-matrix additions at the scan and collector boundaries
(`test/content/auto-download-content*.test.ts`,
`test/content/source-panel-model.test.ts`) covering anchor kind × previewable
× per-page limit; one representative e2e smoke per browser.

### Per-site disable list (#183)

A content option holding newline-delimited WebExtension match patterns; on
matching pages, click-to-save, the Page Sources panel, and the automatic scan
stay inactive. Same list grammar as the ordinary-download and Referer
filters, same contained per-line validation — an invalid line is a
diagnostic, never a broad match.

Implementation:

- Option: a new VALUE entry across `src/config/content-options.ts`
  (defaults, keys, normalizers, `ResolvedContentOptions`) and
  `content-option-schema.ts`, keeping the schema-alignment test green.
- Content gates: parse once per options application with
  `parseMatchPatternList` (`shared/match-pattern.ts` and
  `shared/pattern-list.ts` are pure and content-bundle-safe). A page match
  short-circuits the click-to-save install gate, the panel
  readiness/creation/reconfiguration paths, and the automatic-scan mount in
  `src/content/content.ts`.
- Background backstop: the automatic-save message handler also checks the
  sender-tab URL against the list, so a stale content script cannot keep
  automatic saves alive on a disabled site.
- Options UI: a `match-patterns` syntax-editor textarea (same wiring as the
  ordinary-download filters in `src/options/syntax-editor.ts`) beside the
  other content controls, plus an `options-dependencies.ts` entry.

Tests: normalization matrix in `test/config/content-options.test.ts`; live
gating and un-gating through the `storage.onChanged` harness in
`test/content/content.test.ts`; a background-backstop case.

### Undo last save (#102)

Removes the just-saved file and marks — not deletes — the History entry:
`downloads.removeFile(id)`, then `downloads.erase({ id })`, then a History
status update to an `undone` state. Two surfaces:

- A button on the success notification. Chrome only: Firefox's
  `notifications.create` rejects the `buttons` property, so Firefox omits it
  behind a capability check (mirroring the existing `icons` try/catch
  precedent in the menus code).
- A History row action next to "Show in folder", on both browsers, enabled
  under the same gate that action uses (`status === "complete"` with a known
  `downloadId`).

Privacy rule: private saves never reach history and their download records
are never persisted, so the row action is inherently non-private. The
notification button is additionally suppressed when the download record is
private (`isPrivateDownloadRecord`), matching the existing exclusion of
private activity from history and notifications.

Implementation:

- Notification: add `buttons` to the success-notification details in
  `downloads/notification.ts` and register `notifications.onButtonClicked`
  synchronously in `registerNotifier` (MV3 listener rule); the notification
  ID already is the download ID.
- Message: a new `HISTORY_UNDO` modeled on `HISTORY_CANCEL` (constants,
  `shared/message-protocol.ts` types and validators, handler in
  `background/messaging.ts`). The handler resolves the entry's download ID,
  removes the file, erases the shelf entry, and marks the entry through
  `background/history.ts`. A file already deleted out-of-band still erases
  and marks, with a distinct response so the UI can say so.
- History UI: the row action plus an `undone` status label and class in
  `src/options/history-view.ts` and `history-panel.ts`, with feedback through
  the existing history toast channel.
- Explicit browser checks (the open question this feature carries): verify
  `removeFile`/`erase` semantics in both browsers' e2e suites, including
  file-already-removed and shelf-entry-already-cleared cases.

Tests: notification-lifecycle (button present or absent by browser and
privacy; click removes, erases, and marks), history persistence (the undone
state survives normalization), history-panel row-action delegation and
failure containment, message-protocol validation, one e2e smoke per browser.

## 4.2 candidates

- Remaining automatic-scan phases: anchors beyond previewable media
  (`stream`, `document`), CSS backgrounds, playlist hints, and
  `data:`/`blob:` acquisition.
- Grammar follow-up only if 4.1 feedback shows template-resistant demand
  (for example #187's general value transforms). Any extension must stay
  inside the single `filenamePatterns` grammar and its editor.
- Promote or retire the experimental Firefox cancel-and-redownload mode based
  on 4.0/4.1 reports.

## Non-goals

- Conditionals in rules (#180): rejected by the 4.1 grammar decision.
  `if/elif` chains inside one rule duplicate what ordered rules already
  express — write the narrow rule first; the first complete match wins — and
  custom variables would introduce cross-rule state. The cost lands on every
  grammar surface (parser, visual editor, debugger, references, catalogs)
  for compression, not capability.
- Continuous/fall-through rules (#171): rejected by the 4.1 grammar
  decision. Routing is deliberately ordered and non-chaining: the first
  complete match owns the destination, and later rules never inspect its
  output. Chaining would invalidate the shadowed-rule diagnostic and the
  debugger's single-selected-rule trace, and make results depend on rule
  outputs instead of rule order. The cited use cases are served by capture
  groups and the template collections.
- Clipboard-based variables (#121): MV3 backgrounds have no clean clipboard
  access, and the privacy cost outweighs the value.
- Downloading from the browser cache (#148): no WebExtension API exists.
- CSS `@scope` migration: deferred until the minimum Firefox version rises
  (see [UI](UI.md)); a v5-era change.

## Watch items

- WebMCP remains an experimental Chrome origin trial; the
  `navigator.*` → `document.*` move is shimmed, but the API can still change
  mid-cycle.
- Chrome cannot assign extension-started downloads to its Incognito download
  context; unfixable platform limitation, documented in the store description.

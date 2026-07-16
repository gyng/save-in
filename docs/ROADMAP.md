# Roadmap

Planned work after the 4.0.0 release. The 4.1 section is the record of what
shipped in 4.1.0; the 4.2 section is the current implementation plan —
items name the modules they change and the tests that gate them, and the
decision-gated tracks fix their designs and criteria in advance. Nothing
lands without the usual test, lint, and review gates. Issue numbers refer
to the GitHub tracker.

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

Shipped while 4.0.x patches absorb feedback. Five tracks, all implemented
(see the 4.1.0 changelog).

1. Routing grammar: `fetch:` URL rewriting (#137) — landed.
2. Site template collections (#187, #189, #209, #210, #211) — landed.
3. Page Sources automatic scan: link-discovered sources — landed.
4. Per-site disable list (#183) — landed.
5. Undo last save (#102) — landed.

### Routing grammar: `fetch:` URL rewriting (#137)

The grammar RFC planned for 4.1 resolved early: 4.1 ships URL rewriting as a
`fetch:` clause (landed) and rejects conditionals (#180) and continuous
rules (#171) — rationale under non-goals. `fetch:` adds a capability the grammar lacked
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

All layers landed together: the download-plan rewrite step (template
expansion, plan invalidation, disposition-filename re-resolution), the
rename-only seam for ordinary downloads, the fetch template through
automatic saves and messaging, route-debugger trace fields with two-stage
expansion, the editor surfaces (insert menu, autocomplete minus banned
variables, syntax tokens, a "Rewrite download URL" visual-editor row, a
debugger stage row), the clause references and guides, and translated
catalog keys — each with unit coverage, plus both browsers' e2e suites. The
4.1.0 changelog entry cites #137.

### Site template collections (#187, #189, #209, #210, #211)

Two new categories in the template catalog
(`src/options/rule-editor/rule-templates.ts`); pure data and copy, no engine change.

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
  ordinary-download filters in `src/options/syntax-editor/syntax-editor.ts`) beside the
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
  `background/messaging/index.ts`). The handler resolves the entry's download ID,
  removes the file, erases the shelf entry, and marks the entry through
  `background/history.ts`. A file already deleted out-of-band still erases
  and marks, with a distinct response so the UI can say so.
- History UI: the row action plus an `undone` status label and class in
  `src/options/history/history-view.ts` and `history-panel.ts`, with feedback through
  the existing history toast channel.
- Explicit browser checks (the open question this feature carries): verify
  `removeFile`/`erase` semantics in both browsers' e2e suites, including
  file-already-removed and shelf-entry-already-cleared cases.

Tests: notification-lifecycle (button present or absent by browser and
privacy; click removes, erases, and marks), history persistence (the undone
state survives normalization), history-panel row-action delegation and
failure containment, message-protocol validation, one e2e smoke per browser.

## 4.2 — scan completion and verdicts

Four tracks. The scan phases are planned work; the last two are
decision-gated, with the designs and decision criteria fixed now so 4.1
feedback converts directly into action instead of reopening design.

1. Automatic scan phase B: linked documents and streams, CSS backgrounds,
   playlist hints.
2. Automatic scan phase C: `data:` sources. (`blob:` acquisition is a
   non-goal — rationale below.)
3. Grammar: general value transforms (#187) — gated on template-resistant
   demand.
4. Firefox cancel-and-redownload verdict — gated on 4.0/4.1 field evidence.

### Automatic scan phase B: documents, streams, backgrounds, hints

Discovery already exists; phase B is gating work, not collector work. The
shared collector classifies anchors into all six kinds
(`src/content/source-panel-model.ts` — `stream` is `.m3u8`/`.mpd`,
`document` is `.pdf`), collects CSS backgrounds
(`collectBackgroundElements` + `urlsFromCss`, emitted as `kind: image`) and
HLS/DASH resource-timing hints (`collectResourceHintSources`, emitted as
`kind: stream`). Routing needs no new vocabulary: `sourcekind:` is a plain
info matcher and every editor/WebMCP enumeration already lists `stream` and
`document`. The automatic scan currently forces these channels off
(`src/content/auto-download.ts`: the `AUTOMATIC_MEDIA_KINDS` filter, plus
`includeBackgrounds: false` and `resourceHints: false` in its collector
call).

Adopting new kinds silently would broaden existing rules — a profile with
`urlfileext: pdf$` and link adoption on would start firing on `.pdf` anchors
that phase A deliberately dropped. Each channel is therefore its own
content option, default off, beside `autoDownloadLinks`:

- Linked documents and streams: anchors classified `stream` or `document`
  pass the kind filter. Plain `link` anchors stay out permanently
  (non-goal below).
- Page backgrounds: the scan's collector call turns `includeBackgrounds`
  on; candidates arrive as `kind: image` and existing image rules match
  only if their matchers do.
- Streaming manifests: `resourceHints` on; candidates arrive as
  `kind: stream`. A saved manifest is the playlist file itself — the
  description must say so (Save In does not assemble segmented media).

The options UI groups the three with the existing link control under one
"Automatic scan coverage" cluster in the content settings, wired through
`content-options.ts` defaults/keys/normalizers and the schema-alignment
test like `autoDownloadLinks`. Everything else is deliberately unchanged:
eligibility, the HTTP(S) gate (`automaticUrl`), the background re-match and
protocol backstop (`background/messaging/auto-download.ts`), per-page
limit, once-per-visit dedup, and the live-discovery `MutationObserver`
(which already observes attribute mutations; background/hint changes ride
the existing debounced rescan).

Tests: extend the discovery matrices in
`test/content/auto-download-content*.test.ts` (kind × channel toggle ×
per-page limit) and `test/content/source-panel-model.test.ts` where the
collector gains no behavior but the scan's option plumbing does; a
background-backstop case per new channel; one e2e smoke covering a linked
document and a background image. Update
[AUTOMATIC-SOURCE-SAVES](AUTOMATIC-SOURCE-SAVES.md): retire the
"backgrounds and playlist hints are not adopted" sentence, state the
channel-toggle rule, keep the `data:`/`blob:` exclusion wording until
phase C.

### Automatic scan phase C: `data:` sources

`data:` and `blob:` differ fundamentally and split here. A `data:` URL is
self-contained — the browser can download it from any context — while a
`blob:` URL is resolvable only inside the page that minted it; adopting
`blob:` needs a content-to-background byte-transfer protocol that does not
exist (`runtime.sendMessage` carries JSON candidates only, and
`shared/streaming-content.ts` serves the background/offscreen fetch paths,
not content scripts). `data:` lands in 4.2; `blob:` is a non-goal.

Design: a content option (default off) admits `data:` URLs through the
scan. The collector already resolves them (`absoluteUrl` accepts `data:`);
the two protocol gates open conditionally — `automaticUrl` on the content
side and the background handler's protocol check
(`background/messaging/auto-download.ts`). Bounds and semantics:

- Size cap: the URL string is the payload and rides a runtime message; a
  fixed cap (order of 2 MB) is enforced at both gates, rejected candidates
  logged to the debug log, never a broad failure.
- Dedup: the `seen` set and history keying cannot hold megabyte URLs;
  candidates above a small threshold dedup on a `sha256` of the URL
  (`shared/sha256.ts`) computed content-side, and history stores the
  truncated form with the hash.
- Rule matching and naming: `data:` has no path, so `fileext:`/
  `urlfileext:` are empty; the background parses the mediatype from the
  URL header into the candidate info so `mime`-derived matching and
  `:mimeext:` naming work. Rules key on `sourcekind:` plus mime.
- Pipeline: `downloads.download` accepts `data:` URLs in both browsers;
  the plan/execution path already treats non-HTTP URLs as direct
  acquisitions with HTTP-only optimizations off (`isHttpDownloadUrl`
  gates in `download-plan.ts` and `download-execution.ts`). Verify the
  Referer/DNR path is never engaged for them.

Tests: gate matrix (cap, protocol, dedup-by-hash) at the content and
messaging boundaries; a pipeline case proving direct acquisition with no
DNR rule; one e2e smoke saving a small inline `data:` image.

### Grammar: general value transforms (#187) — gated

Trigger: proceed only if post-4.1 reports show repeated asks that a Site
filing template cannot express and that reduce to a pure value edit
(find/replace, case, trim) on one expanded value — #187's general form.
Template-expressible asks keep landing as templates.

Shape, fixed now: one new clause (working name `rename:`), at most one per
rule like `fetch:`, holding a find → replacement applied to the expanded
filename component before truncation — never through `Path`, so slashes
stay literal. No variable-modifier syntax: the `:name:` token grammar
(`routing/path-variables.ts`) stays untouched, which is what keeps the
editor surfaces cheap. The surface checklist is exactly the `fetch:` one
from 4.1: `rule-syntax.ts` clause kind, `rule-parser.ts` validation,
runtime application beside `applyVariables`, autocomplete and syntax
tokens, a visual-editor row, a debugger stage row, vocabulary groups,
clause references and guides, catalog keys, and template proofs. Anything
beyond a single find/replace per rule (chains, conditionals, cross-rule
state) stays rejected under the 4.1 non-goals.

### Firefox cancel-and-redownload verdict — gated

The experimental mode is `routeBrowserDownloadsFirefox`
(`config/option-schema.ts`; runtime path in
`downloads/notification-events.ts`: route, record
`mechanism: "firefox-replacement"`, cancel, erase, re-download with
`allowOriginalUrlFallback: false` and a 10-second adoption window).
Evidence already exists on both sides: history records successful
replacements (`firefox-replacement` + complete) and failures
(`FIREFOX_REROUTE_FAILED` plus a debug-log entry), so no new telemetry is
needed — the verdict reads issue reports against those records.

- Promote when reports show completions dominate and failures stay inside
  the documented classes (POST bodies, expiring URLs, custom headers,
  authenticated downloads): remove the `o_lExperimental` badge and warning
  styling from the `options.html` block, keep the risk help text and the
  Mozilla bug 1245652 link, reword the option description in
  `config/option.ts`. No schema or behavior change.
- Retire when failures dominate, or the mode sees no adoption, or Mozilla
  ships filename suggestion (bug 1245652 — the
  `WEB_EXTENSION_CAPABILITIES.downloadFilenameSuggestion` gate already
  turns the path off automatically the moment it exists): remove the
  schema entry, UI block, and runtime branch; keep tolerating the stored
  key at the config boundary (the `combineRoutingAndMenus` precedent);
  `history-normalization.ts` keeps accepting `firefox-replacement`
  records and `history-view.ts` keeps their labels so old history renders.
  Regression tests cover stored profiles from both states.

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
- Plain `link` anchors in the automatic scan: an anchor with no
  classifiable extension carries no media signal, and adopting it turns
  every page's navigation into download candidates — unbounded noise for
  no expressible rule.
- `blob:` acquisition: page-minted object URLs cannot be resolved outside
  their page, so adoption requires a chunked content-to-background byte
  protocol with its own size, privacy, and lifetime rules. Revisit only
  with a concrete streaming design and demonstrated demand.
- Variable-modifier syntax (e.g. `:pagetitle|slug:`): changes the token
  grammar every editor surface parses; the `rename:` clause shape covers
  the demonstrated asks without touching it.
- Clipboard-based variables (#121): MV3 backgrounds have no clean clipboard
  access, and the privacy cost outweighs the value.
- Downloading from the browser cache (#148): no WebExtension API exists.
- CSS `@scope` migration: deferred until the minimum Firefox version rises
  (see [UI](UI.md)); a v5-era change.

## Watch items

- Mozilla bug 1245652 (native filename suggestion on Firefox): shipping it
  auto-disables the cancel-and-redownload path via the
  `downloadFilenameSuggestion` capability gate and makes the retire branch
  of the 4.2 verdict free.
- WebMCP remains an experimental Chrome origin trial; the
  `navigator.*` → `document.*` move is shimmed, but the API can still change
  mid-cycle.
- Chrome cannot assign extension-started downloads to its Incognito download
  context; unfixable platform limitation, documented in the store description.

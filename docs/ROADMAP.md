# Roadmap

Planned work after the 4.0.0 release. Scope here is directional: items move
between versions based on release feedback, and nothing lands without the
usual test, lint, and review gates. Issue numbers refer to the GitHub tracker.

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

Small release shipped while 4.0.x patches absorb feedback.

### Page Sources automatic scan: link-discovered sources

The automatic page scanner currently queues only previewable HTTP(S) image,
video, and audio elements (see
[AUTOMATIC-SOURCE-SAVES](AUTOMATIC-SOURCE-SAVES.md)). Phase A extends
discovery to anchors that point at previewable media, without changing
eligibility rules, the `context: ^auto$` requirement, or the per-page limit.
CSS backgrounds, resource-timing playlist hints, and `data:`/`blob:` sources
stay out of scope until 4.2.

Tests: eligibility and discovery matrix at the scanner model boundary; one
representative e2e smoke per browser.

### Per-site disable list (#183)

A content option listing WebExtension match patterns where click-to-save and
Page Sources stay inactive. Reuses the shared match-pattern filter
infrastructure already used by ordinary-download tracking; invalid lines must
produce contained validation errors, not broad matches.

### Undo last save (#102)

A notification button and History row action that removes the just-saved file
(`downloads.removeFile` + `erase`) and marks the History entry. Needs explicit
Firefox/Chrome behavior checks and a privacy rule: private downloads expose no
undo surface, matching the existing exclusion of private activity from
history and notifications.

### Site-specific routing templates (#187, #189, #209, #210, #211)

Searchable rule templates for common sites and rename patterns (Twitter,
Instagram, DeviantArt, protocol-stripping). Pure data in the existing template
catalog; closes several long-open "help me write a rule" threads without
engine changes.

### Routing grammar RFC (design only)

Choose one grammar extension for 4.2 from URL rewriting (#137), conditionals
(#180), or continuous rules (#171). Hard constraint: the result must extend
the single `filenamePatterns` grammar and its editor — a second
automation-rule grammar is not acceptable. Deliverable is a design document,
not code.

## 4.2 candidates

- Remaining automatic-scan phases: CSS backgrounds, playlist hints,
  `data:`/`blob:` acquisition.
- The grammar extension selected by the 4.1 RFC.
- Promote or retire the experimental Firefox cancel-and-redownload mode based
  on 4.0/4.1 reports.

## Non-goals

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

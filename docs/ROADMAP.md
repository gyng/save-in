# Roadmap

This roadmap tracked the work planned after the Manifest V3 rebuild. Because no
interim release ever shipped, everything listed under Landed went out in 4.0.0
itself rather than in the separate 4.1, 4.2, and 4.3 releases the tracks were
once grouped under. The one genuinely open decision and the remaining release
hygiene follow below. Issue numbers refer to the GitHub tracker.

## Landed in 4.0.0

The designs are implemented; their rationale now lives in the code, commit
messages, and feature docs. Each track is one line with its issue refs.

### Coverage and control

1. Routing grammar: `fetch:` URL rewriting (#137).
2. Site template collections (#187, #189, #209, #210). #211 (Instagram
   username prefix) is **not** covered: that template was built and then
   removed as unreliable, and `core-matcher-regressions.test.ts` asserts it is
   not offered. An Instagram post URL carries no username.
3. Page Sources automatic scan: link-discovered sources.
4. Per-site disable list (#183).
5. Undo last save (#102).

### Scan completion and verdicts

1. Automatic scan phase B: linked documents and streams, CSS backgrounds,
   playlist hints.
2. Automatic scan phase C: `data:` sources.
3. Grammar: general value transforms — the `rename:` clause (#187).

The fourth track under this theme, the Firefox cancel-and-redownload verdict,
did not land; it remains the one evidence-gated decision (see below).

### Save workflow and acquisition maturity

1. Save workflow: Quick Save, switchable default destination, and post-save tab
   actions (#213, #115). #144, #162, and #201 were cited by this track but are
   **not** resolved by it: Quick Save still sits inside the Save In submenu, so
   #144's extra step remains; click-to-save still takes `last?.path`
   unconditionally with no option to prefer the download folder (#162); and
   `setLastUsed` is only ever called from a context-menu click, so a browser
   Save As dialog cannot update Last used (#201).
2. Parallel Referer protection (#193).
3. Grammar follow-through: `finalfilename:` matching (#178, #189) and the
   `:menupath:` variable (#208).
4. Undo and History maturity: Move / re-route last save and per-auto-save undo
   (#102).

## Release follow-through

Not features — release hygiene that gates the close-out of everything above.

- Close the issues cited in the 4.0.0 changelog (the MV3 rebuild, ordinary
  browser download handling, route debugger, templates, autosave, redirect
  Referer protection, Recent locations, per-location Save As dialogs, and
  source shortcuts resolve roughly 28 open reports).
- Close #104 as by-design: the Last used access key is its own setting
  (`keyLastUsed`), deliberately independent of the numbered-shortcut toggle.
- Ask the reporters of #207, #196, and #143 to retest on 4.0; those Firefox
  breakage reports predate the rewrite.
- The wider verify-and-close sweep for the landed features is drafted and waits
  for the release. Several reports are already fixed by the rebuild or by the
  later sanitization and match-pattern hardening but were never cited closed:
  #221 (domain without subdomain) is the `:pagerootdomain:` / `:sourcerootdomain:`
  variables; #220 (control characters in page titles) is covered by filename
  sanitization and has a regression case; the remaining pre-rewrite reports
  (#172, #178 matching, #186 Waterfox detection, #212, #205) need a close or a
  retest ask. Verification is complete; the close/retest drafts live outside the
  repo, and posting them stays an explicit outward action.

## Gated: Firefox cancel-and-redownload verdict

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

- Conditionals in rules (#180): rejected by the routing-grammar decision
  (see Landed). `if/elif` chains inside one rule duplicate what ordered rules
  already express — write the narrow rule first; the first complete match wins —
  and custom variables would introduce cross-rule state. The cost lands on every
  grammar surface (parser, visual editor, debugger, references, catalogs)
  for compression, not capability.
- Continuous/fall-through rules (#171): rejected by the routing-grammar
  decision (see Landed). Routing is deliberately ordered and non-chaining: the
  first complete match owns the destination, and later rules never inspect its
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
  of the cancel-and-redownload verdict free.
- WebMCP remains an experimental Chrome origin trial; the
  `navigator.*` → `document.*` move is shimmed, but the API can still change
  mid-cycle.
- Chrome cannot assign extension-started downloads to its Incognito download
  context; unfixable platform limitation, documented in the store description.

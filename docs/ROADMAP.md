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
   actions (#213, #115, #144, #162). #144 and #162 were cited by this track but
   not resolved by it, and were finished afterwards: `quickSaveOnly` offers Quick
   save alone at top level (browsers only skip the submenu for a single item),
   and `contentClickToSaveUseDefault` opts click-to-save out of inheriting the
   last folder. #201 was cited too and is **not** resolved; it is planned for
   after 4.0 (see below).
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
- **Neither #207 nor #143 is a retest ask, and #196 was not either.** All three
  sat under a "Firefox breakage reports predate the rewrite" line that was wrong
  about every one of them. #207 **still reproduced on 4.0** — Firefox refuses a
  filename ending .url or .desktop, which is what its shortcut formats produce;
  fixed in `9dcbbddb`, so the reply is an apology and a fix, not a retest. #143's
  author is gyng: it is the maintainer's own tracking issue for Bugzilla 1245652
  (still NEW), so there is no reporter to ask. #196 is a feature request: its
  thread (five people, 2022–2024, one migrating to Chrome for a downloads
  router) wants routing applied to downloads the browser starts, which v4 added
  — Chrome routes them opt-in, Firefox only through the experimental replacement
  mode. Their posted rules are also wrong independently (`into: STL` files every
  match onto one file named STL; the editor now warns), so a reply must correct
  the rule *and* name the option, or they will bounce off a third time.
  The pattern is worth naming: every issue on that line was mis-shelved, and the
  shelf was the only thing they had in common.
- The wider verify-and-close sweep for the landed features is drafted and waits
  for the release. Several reports are already fixed by the rebuild or by the
  later sanitization and match-pattern hardening but were never cited closed:
  #221 (domain without subdomain) is the `:pagerootdomain:` / `:sourcerootdomain:`
  variables; #220 (control characters in page titles) is covered by filename
  sanitization and has a regression case; the remaining pre-rewrite reports
  (#172, #178 matching, #186 Waterfox detection, #212, #205) need a close or a
  retest ask. Verification is complete; the close/retest drafts live outside the
  repo, and posting them stays an explicit outward action.

## Planned after 4.0: Last used follows a browser Save As (#201)

Deferred, not rejected. It is a feature, and 4.0 is already carrying a version
bump, the issue sweep, and an unpushed branch; it earns a place in the first
release after, not ahead of any of that.

**The ask.** An option so that saving through the browser's own Save As dialog
retargets the **Last used** menu item to that folder. Napoli0n seconded it and
offered an alternative — have Save In open its *own* dialog on a modified click
— and anticipated the constraint below ("within default directory or symlink").

**Why it is not there today.** `setLastUsed` / `recordRecentDestination` have one
caller: `background/menu-click.ts`, inside `handleContextMenuClick`. Last used
only ever learns from a Save In menu click. `trackBrowserDownloads` already
watches ordinary downloads but only feeds History.

**The constraint that shapes it.** The downloads API is asymmetric:
`DownloadItem.filename` is an *absolute* path; `downloads.download({filename})`
takes a path *relative to the Downloads directory* and rejects absolute paths and
`..`; and nothing reports where that directory is — `showDefaultFolder()` returns
`void`. So a dialog target outside Downloads can never become a Save In
destination, in principle and not just today.

**Design.**

- Take the reporter's literal ask, not the alternative. The seam already exists
  and already holds the data: `downloads/notification-events.ts` merges
  `downloadDelta.filename?.current` — the final absolute path — for tracked
  browser downloads. That is roughly ten lines. Napoli0n's variant needs a whole
  new interaction (modifier, click, dialog, remember) for the same outcome, and
  both variants need the derivation below anyway.
- Derive the Downloads root **by subtraction, on every Save In save**: each one
  hands over both halves for free — the relative path requested and the absolute
  path reported. Compare directory portions only, since `uniquify` renames the
  leaf. Re-deriving each time keeps it correct when the user moves their download
  directory. Do not cache it once: a stale root yields a *wrong relative path*,
  and saves then land somewhere the user did not choose. That silent
  misplacement is the only way this feature does real harm, and designing it out
  is free.
- Say so when the target is outside Downloads. Silence there repeats #53 — the
  user picks a folder, nothing happens, nothing explains why.

**Decide before writing code.** It only works when `trackBrowserDownloads` is on,
which is off by default, so the user opts in twice — once to something framed as
history tracking — before Last used moves. Unsolved, the feature reads as broken
to exactly the people who asked for it.

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

# Roadmap

This roadmap tracked the work planned after the Manifest V3 rebuild. The first
three tracks shipped in 4.0.0; the remaining 4.2 and 4.3 candidates were folded
into 4.1 instead of being held for artificial release boundaries. The one
genuinely open decision and the remaining release hygiene follow below. Issue
numbers refer to the GitHub tracker.

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
   last folder. #201 was completed for 4.1 (see below).
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

## Landed for 4.1

- Last used can follow an ordinary browser Save As subfolder (#201). The opt-in is
  independent of browser-download History. Each successful Save In download
  without a Save As prompt re-derives the Downloads root for the current browser
  session; only reusable subfolders beneath that root are accepted. Ordinary
  browser downloads saved directly in Downloads and browser-routed destinations
  do not overwrite Last used, while an unsupported or not-yet-known root is
  explained once.
- Completed History retention is configurable from 0 to 10,000. Active saves
  remain visible even at 0 and are removed only after reaching a terminal state.
  Lowering the limit requires confirmation, cannot offer a misleading Undo, and
  uses terminal-count metadata to avoid full-history reads before pruning is due.
- Click-to-save uses the same Prefer links and page-filter decision as context
  menu saves, closing the remaining #226 behavior gap.
- Hide folder choices removes Last used, Recent locations, and the configured
  destination tree while preserving the routing action and unrelated menu
  actions such as Options, Open Downloads, context information, and Page
  Sources.
- History rows can open **Debug this save**, which reconstructs the compact
  recorded routing inputs and runs them through the current Route debugger.
  This is deliberately a replay, not a persisted old trace: changed rules are
  the point, and no duplicate per-entry trace increases History storage.
- Interactive link saves expose the clicked anchor's `title` and `download`
  attributes as `:linktitle:` / `:linkdownload:` and `linktitle:` /
  `linkdownload:` (#65). `:linktext:` remains backward compatible. Content
  extraction happens only after save intent. Right-click saves request it only
  when configured syntax consumes it, tie it to the exact URL and frame, and
  time out without blocking the download path indefinitely. Click-to-save
  already owns the clicked element and attaches the same bounded attributes
  directly.

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
- Saving outside the Downloads folder (#25) and populating submenus from real
  subfolders (#87): both need to touch the filesystem, and nothing in the
  WebExtension API does. `downloads.download` takes a path relative to the
  Downloads directory and rejects absolute paths and `..`; no API enumerates
  directories; and nothing even reports where Downloads is. Native messaging is
  the only route, and it means shipping and maintaining a separate native binary
  per platform — a different product, which is why the 2017 answer to #25 was
  "not in the near future" and why `docs/integrating/INTEGRATIONS.md` frames the yt-dlp
  hand-off as deliberately avoiding the permission. #87 also has a design
  objection independent of the API: enumerating subfolders "would end up reading
  in an entire drive", as a commenter pointed out. Both were left unrejected for
  years while being exactly this; recorded here so they stop reading as open.
  Note the same wall bounds #201: a Save As target outside Downloads could only
  ever be reused if this changed.
- CSS `@scope` migration: deferred until the minimum Firefox version rises
  (see [UI](../contributing/UI.md)); a v5-era change.

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

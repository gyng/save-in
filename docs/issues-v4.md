# Save In 4 — issue validation

**None of this has been posted to GitHub, and none of it should be until the
release ships.** Every `gh` call behind these notes was read-only (`issue view`
/ `issue list`); no issue was commented on, closed, or relabelled. Save In 4 is
still unreleased (`manifest.json`/`package.json` say 4.0.0), and per the
maintainer the tracker sweep stays an explicit outward action.

These are working notes, not a contract: they record what was verified, what was
not, and where a close would be wrong. Treat a verdict as an input to a reply,
not as the reply.

Prepared 2026-07-17 against branch `v4` at `6d908c58`. Tracker snapshot: 182
issues, 86 open / 96 closed.

Line numbers below are anchored to that commit and **drift** — a concurrent
session moved `shared/constants.ts` by six lines while these notes were being
written. Trust the quoted symbol names and comment text over the `:NNN`.

## Evidence standard

A verdict here requires **the reporter's own body** plus a `file:line` in the
current tree. The failure mode this exists to prevent: the existence of a
feature is not evidence that it fixes a report, and a claim repeated across
code, tests, docs, and CHANGELOG can be self-consistent and still wrong. Two
findings below (#221, #178) were only visible because independent sources
disagreed.

Verdicts are **code-side confirmed** — the mechanism exists and matches the
report. None have been retested in a live browser.

## Verdicts — the pre-drafted closes

These seven had replies drafted before this pass (the drafts live outside the
repo). Every other 4.0.0-cited issue is under
[the 4.0.0 bulk claim](#the-400-bulk-claim--validated) below.

| # | State | Report | Verdict |
|---|---|---|---|
| 221 | OPEN | pagedomain/sourcedomain without subdomain | **Fixed** — high confidence |
| 220 | OPEN | invisible chars in page title | **Fixed** — both symptoms |
| 212 | OPEN | `:filename:` returns `:naivefilename:` | **Fixed** — mechanism confirmed |
| 186 | OPEN, bug | Waterfox detected as Chrome | **Fixed** — high confidence |
| 172 | OPEN, chrome | Chrome 91 `:pagetitle:` takes other tab's title | **Fixed** — high confidence |
| 178 | OPEN | php download, td.php name captured | **Fixed, but the reply must correct the rule** |
| 53 | CLOSED wontfix | NBSP at a path-component edge | **Reason valid; silent-failure half fixed this pass** |

### #221 — pagedomain / sourcedomain variables without subdomain

Reporter wants `tumblr.com` from both `dan.tumblr.com` and
`64.media.tumblr.com`, notes it is not tumblr-specific, and calls `www` equally
superfluous.

`:pagerootdomain:` / `:sourcerootdomain:` (`shared/constants.ts:13-14`) resolve
through `toRootDomain` (`shared/domain.ts:69-77`), wired at
`routing/variable.ts:309-312`. Traced against the reporter's own cases:

- `dan.tumblr.com` → 3 labels, suffix `tumblr.com` not in the multi-label set → `slice(-2)` → `tumblr.com`
- `64.media.tumblr.com` → 4 labels → `tumblr.com`
- `www.example.com` → `example.com` (covers the `www` complaint)

Multi-part suffixes (`co.uk`, `com.au`) are handled by a 60-entry ICANN subset
at `shared/domain.ts:6-67`. Note this **postdates** the original feature: the
introducing commit `ef1bae2c` explicitly documented multi-part TLDs as *"out of
scope without a public-suffix list"*; the set arrived later (`036b06da`,
`64b3fa90`). The draft's hedge — inviting a report if a particular suffix
returns the wrong root — is therefore honest rather than boilerplate, because
this is a curated subset and not the full PSL.

### #220 — invisible characters in the page title

Two distinct symptoms in one report, and both are addressed.

1. *Invisible characters break the save.* The reporter enumerates nine classes.
   `UNSAFE_INVISIBLE_FILENAME_CHARS` (`shared/constants.ts:188-190`) covers
   every one — escapes used deliberately below, since the subject matter is
   invisible by definition:

   | Reported | Covered by |
   |---|---|
   | `\u200B` `\u200C` `\u200D` zero-width | `\u200B-\u200F` |
   | `\uFEFF` zero-width no-break / BOM | `\uFEFF` |
   | `\u00AD` soft hyphen | `\u00AD` |
   | `\u2060` word joiner | `\u2060-\u2064` |
   | `\u200E` `\u200F` LTR/RTL marks | `\u200B-\u200F` |
   | `\u202A`-`\u202E` directional formatting | `\u202A-\u202E` |
   | variation selector (their emoji example) | `\uFE00-\uFE0F`, plus the supplemental block via `\udb40[\udd00-\uddef]` |

Regression coverage deliberately exercises both at once:
`test/routing/variable.test.ts:173` — *"sanitizes invisible controls from
`:pagetitle:` without losing the clicked tab (#220)"*.

### #212 — `:filename:` variable not working

Report: *"The `:filename:` variable seems to be consistently returning
`:naivefilename:` instead"*, Save In 3.7.1 / Firefox 122.

`resolveDispositionFilename` (`downloads/download-disposition.ts:36-60`) is the
fix. On Firefox it HEADs the URL, reads `Content-Disposition`, and assigns the
result to `info.filename` (line 51) — so `:filename:` resolves to the server
name rather than the URL-derived one. Chrome returns early at line 42 because
its `onDeterminingFilename` hook owns the final name instead.

**Caveat.** There is no `#212` reference anywhere in `src/`, `test/`, or any
commit message — the only hit in the repo is `ROADMAP.md:60`. The verdict rests
on the mechanism plus the #178 regression test, not on issue-tagged coverage.
Confidence comes from the body matching the code exactly, which was only
checkable once the tracker was readable.

### #186 — Waterfox detected as Chrome

Detection keys off the **presence** of `runtime.getBrowserInfo`
(`platform/chrome-detector.ts:74-78`), which only Gecko implements. The
reported product name is never read — `browserVersion` touches only
`value.version`. `setCurrentBrowser(FIREFOX)` runs **synchronously** at line 94,
before the async version lookup, so a fork takes the Firefox feature path
immediately rather than after a promise resolves.

Regression: `test/platform/chrome-detector.test.ts:92` — *"treats Gecko forks
(e.g. Waterfox) as FIREFOX regardless of the reported name (#186)"*, asserting
`name: "Waterfox"` → `BROWSERS.FIREFOX`.

### #172 — Chrome 91 `:pagetitle:` taking other tab's page title

`background/menu-click.ts:82` is `const clickTab = tab || currentTab` — the
click's own tab wins; the tracked global is only a fallback when the event
carries no tab. `background/messaging/handlers.ts:422` does the same for the
message path. The fix is browser-agnostic, so the Chrome 91 framing does not
narrow it.

Regression: `test/background/menus/download-listener.cases.ts:291` seeds the
global with another window's tab (`id: 99, "Some Other Tab"`), dispatches a
click carrying `id: 5, "Clicked Tab"`, and asserts `"Clicked Tab"` wins. A
companion test at :309 pins the fallback branch.

### #178 — php generated download, td.php name captured

**Fixed, but a plain "this is fixed" reply would be wrong.**

The mechanism is real and the regression test matches the report's URL shape
exactly: `test/downloads/download-acquisition.test.ts:180` routes
`td.php?token=secret` → `release.torrent` → `_torrents/release.torrent` via
`actualfileext`.

**Both of the reporter's rules would still fail as written**, on every browser:

```
fileext: torrent                      # (1)
mediatype: application/x-bittorrent   # (2)
```

1. `fileext:` reads the **URL**, not the resolved name — `routing/matchers.ts:251`
   draws from `sourceUrl`/`srcUrl`/`linkUrl`/`pageUrl`. `td.php?s=…` has no
   `.torrent` in it, so this never matches regardless of Content-Disposition or
   browser. It is the documented legacy spelling; the clause reference already
   says *"Matches the URL-derived extension (legacy name). Use `urlfileext:` in
   new rules."*
2. `mediatype:` maps to `info.mediaType` (`routing/matchers.ts:311`) — the
   *context-menu* media type (`image`/`video`/`audio`). It can never match a
   MIME string like `application/x-bittorrent`. This rule was already
   ineffective when filed.

The working v4 rules are `actualfileext: torrent` (reads `resolvedFilename`,
`matchers.ts:288`, with a `mimeExtension` fallback), `finalfilename:`, or
`mime:`/`contenttype: application/x-bittorrent` via `resolveMime`. **The reply
must tell them to change the rule**, not just that the underlying bug is fixed —
otherwise they retest with the same non-functional filter and report it still
broken.

Both browsers support the working rules. Firefox resolves the name before
routing (`download-disposition.ts:36-60`); Chrome defers and re-evaluates, since
`actualfileext` **is** in the deferral list (`download-plan.ts:142`).

The Chromium path is covered, contrary to a first pass here that called it a
gap: `test/downloads/download-mv3.test.ts:1055` drives an `actualfileext` rule
through Chrome's `onDeterminingFilename` listener and asserts the suggestion,
and `test/downloads/download-plan.test.ts:502-560` pins Chrome + `actualfileext`
deferral. The "missing test" claim came from a narrow grep for a Chromium case
inside the *acquisition* test file — the same infer-from-absence mistake this
document exists to prevent, made while writing it. No test is needed; adding one
would repeat a matrix across layers.

## Defect found: `#221` is cited for two unrelated subjects

Two disjoint clusters in the tree cite `#221`:

| Cluster | Subject | Sites |
|---|---|---|
| A | filename sanitization / `replacementChar` | `shared/constants.ts:180`, `test/routing/path.test.ts:27`, `test/config/option.test.ts:291`, `test/config/option.test.ts:697` |
| B | root-domain variables | `test/routing/variable.test.ts:189`, `CHANGELOG.md:91`, `ROADMAP.md:57` |

**Cluster B is correct; cluster A is wrong.** Resolved by the introducing
commit `ef1bae2c` ("feat: root-domain variables, Windows filename hardening,
autosave debounce"), the only commit in history mentioning #221. It attaches
`(#221)` explicitly and *only* to the root-domain bullet. Its Windows-filename-
hardening bullet — control characters, trailing dots, reserved device names,
the `replacementChar` fallback — carries **no issue reference at all**. The tag
bled across because the commit bundled three unrelated features.

The issue title settles it independently: *"pagedomain / sourcedomain variables
without subdomain"*. #221 has nothing to do with `replacementChar`.

Consequences:

- **`CHANGELOG.md` fixed.** The entry attributed a fourteen-variable list to
  #221; the report asked for one thing. `#221` now scopes to
  `:pagerootdomain:`/`:sourcerootdomain:` only. *(This is the only file changed
  by this pass.)*
- **Cluster A's four `#221` comments remain wrong** and are unfixed — they are
  source/test comments, and the correct replacement is not obvious (the
  sanitization work appears to have had no issue; `#220` covers the page-title
  half but not `replacementChar` validation). Left alone deliberately rather
  than guessed at.

## Label hygiene: `blocked upstream` is largely stale

14 issues carry it (11 open, 3 closed). Previously identified as wrong: **#90,
#135, #70, #118, #18, #15, #94**. Genuinely blocked: **#21**, **#69**.

New this pass: **#166 ("[Firefox] stopped saving files") is still labelled
`blocked upstream` but was fixed on this branch** — `def6260d` (CRASH is
retryable) plus `a29a4467` (Referer-protected downloads reach the retry). That
makes **8 of 11** open labels stale. **#125** ("Forward slash will open quick
find") remains unassessed and needs a browser retest.

## #53, closed `wontfix` — reason held, silent half now fixed

*"Ascii Character 160 causes issues in certain paths"* (U+00A0, non-breaking
space). The reporter's matrix is precise, and its shape is the whole diagnosis:

| Path | Reported |
|---|---|
| `test<nbsp>test` | works (interior) |
| `test\<nbsp>\test` | works (whole component) |
| `<nbsp>\something` | **fails, saves nothing** |
| `test\<nbsp>` | **fails, saves to `E:\test`** |

Closed with *"Browsers intentionally treat whitespace as invalid directories.
I can't do anything about this"*, citing Mozilla's `DownloadPaths.jsm` and #16.

**That verdict was right and stays right.** Interior whitespace works; only the
edges fail. That asymmetry is the signature of the browser's own path
sanitization. Save In cannot make a whitespace-edged directory exist.

**But the silence was ours, and that part is now fixed.** Before this pass:

- `TRAILING_DOTS_AND_SPACES_REGEX = /[. ]+$/` trimmed trailing dots and **ASCII
  space only** — U+00A0 is not U+0020, so a trailing NBSP survived.
- `BAD_LEADING_CHARACTERS = /^[./\\]/` carried **no whitespace at all**, so a
  *leading* space was never trimmed, ASCII or otherwise — a wider gap than the
  report itself.
- NBSP appears in neither `FORBIDDEN_FILENAME_CHARS` nor
  `UNSAFE_INVISIBLE_FILENAME_CHARS`.

So Save In handed the browser a name it had declared clean, and the browser
altered or rejected it — producing exactly the two reported failures. The
sanitizer already trimmed trailing ASCII space for this very reason; it just
stopped at U+0020.

Fixed in `routing/path.ts`: `TRAILING_DOTS_AND_SPACES_REGEX` widened to
`/[.\s]+$/` (which also handles whitespace interleaved with trailing dots, e.g.
`name<nbsp>.`), plus a new `LEADING_WHITESPACE_REGEX = /^\s+/` applied in
`sanitizeFilename`. A whitespace-only component now falls through the existing
`leadingSafe || "_"` to `_`, so `E:\<nbsp>\something` saves to
`E:\_\something` rather than vanishing.

Ordering is load-bearing and is commented at the call site: the trim runs
**after** `replaceFsBadChars` (so a control character still becomes the
replacement rather than silently disappearing) and **before** the leading-dot
guard (so whitespace cannot hide a dot from that guard's `^` anchor and carry a
hidden-file or traversal name past it). `test/routing/path.test.ts` pins that
case explicitly, alongside the reporter's two failures, his two *working* cases
(interior whitespace must survive), and other Unicode spaces.

The close reason needs no retraction — the browser still owns the underlying
limit. What changed is that Save In no longer produces a silent failure on the
way there.

## The 4.0.0 bulk claim — validated

`ROADMAP.md:47-49` says the 4.0.0 changelog "resolve[s] roughly 28 open
reports". It actually cites **45 issues, 43 of them still open**. The sweep was
undercounted by half before it began. Verdicts below come from reading each
reporter's body against current code; each was required to cite `file:line` and
was barred from inferring "fixed" from a feature's existence.

**Do not close** (cited as landed, but not implemented):

| # | Verdict | Why |
|---|---|---|
| 162 | **NOT-FIXED** | Asked for a toggle between last-used and default dir for click-to-save. `messaging/handlers.ts:456` is `path: last?.path \|\| new Path(".")` — unconditional. No option gates it; `resolveDefaultDestination` has one caller, the Quick Save *menu item* (`menu-click.ts:140`). Complaint reproduces verbatim. |
| 201 | **NOT-FIXED** | Asked that Last used follow a browser Save As dialog. `setLastUsed`/`recordRecentDestination` have exactly one caller — `menu-click.ts:251-252`, inside `handleContextMenuClick`. Browser-download tracking never feeds Last used. What shipped is a static two-way Quick Save switch. |
| 144 | **PARTIAL** | Asked to remove the secondary submenu. `menu-build.ts:244` gives Quick save `parentId: ROOT`, so it is still Save in → Quick save — the same two hops. The keyboard command bypasses the menu but only saves the active tab's page, not the link/image under the cursor. |

All three are cited by `07f09f17` and listed as landed at `ROADMAP.md:35` — a
self-consistent but incorrect claim, and the exact failure mode this document
exists for.

**Close, but the reply must tell them to change something:**

| # | Verdict | Required user action |
|---|---|---|
| 110 | FIXED | `externalDownloadAllowlist` defaults to `""`; their 2019 snippet returns `UNAUTHORIZED` until they add the extension ID. Second ask (open the menu via message) is unmet. |
| 115 | FIXED | Grant is per-menu-item `(tab: close)`, not the global "in general" they asked for. Reply must show the syntax. |
| 164 | FIXED | `saveSourceSidecar` defaults off. |
| 213 | FIXED | **New installs only.** No migration rewrites a stored bare `.`, so the 2024 reporter sees no change on update. Must edit to `. // (alias: Downloads)`. |
| 122 | FIXED | Default is 1; must raise `recentDestinationCount`. |

**Close with a caveat:**

| # | Verdict | Caveat |
|---|---|---|
| 106, 146, 152 | **PARTIAL** | Genuinely fixed on Chrome. #146's reporter said *"I have only used the extension with Firefox"* and #106's thread implies it — on Firefox this exists only behind the off-by-default **experimental** reroute that can lose POST bodies and expiring URLs. |
| 184 | **PARTIAL** | Only the *update* icon got theme detection (`menu-build.ts:359-368`). The **archive** icon in the reporter's screenshot is unchanged and no white asset exists (`addRoot` passes no `icons`). His userChrome.css workaround still required. |
| 218 | **NEEDS-RETEST** | Root cause was never established by the reporter — no diagnostics, no mention of Referer. Both fixes are inert unless `setRefererHeader` is enabled (defaults false). Closing asserts a diagnosis the issue never made. |
| 226 | FIXED / split | Original (alt-click a PDF link) fixed, `content.ts:127-138`, tested. A second commenter reports alt-click ignoring "prefer link over media" — that is real: `preferLinks` is not a content option, so `findSource` cannot consult it. Close on the original only. |
| 193 | FIXED | Redirect-hop Referer extension is bounded to 3. A per-request-signed S3 URL yields a fresh target each attempt and exhausts the budget; the report says "some s3 storage site". Don't promise success. |
| 225, 227 | FIXED **on release** | Correct (MV3, `minimum_chrome_version: 123`), but needs the Web Store publish. Closing on branch state leaves both reporters broken. |
| 102 | FIXED | One-click Undo is the notification button — **Chrome only** (`notificationButtons`). Firefox users must use Options → History → Undo. |

**Clean closes:** #159, #216 (see below), #222, #161, #154, #183, #164, #122.

- **#161** — root cause found and fixed (`shortcut.ts:20-26`: the URL's MIME must
  match the intended extension or the browser rewrites it). Unit-tested; the
  reporter's exact Linux/`.desktop` combination has no e2e.
- **#183** — the disable list gates the content-script surface, not routing. If
  the reporter's Twitter conflict was about *routing rules*, the owner's 2022
  `pageurl: ^(?!.*twitter.com)` workaround is still the answer, not this feature.

### #216 was misattributed — fixed this pass

#216 is one sentence: *"I would like to remind you the almost-finished issue
#159 with two alternative pull requests solving it."* It bumps #159, which asks
to *"store the time, page url, page title, image url and the filename"* for each
saved image — that is History.

The changelog credited #216 to the **Diagnostics panel** and `log.ts` credited
the **debug ring buffer** to `#159/#216`. Neither is what either issue asked for.
The drift is a pun: #159's title says "logging", so the reference followed the
word to the extension's own debug log instead of the feature its body describes.
Corrected in `df57f16a`.

### Routing grammar and templates

**Do not close:** **#211** — asked for an Instagram username prefix. Nothing
ships: `grep -rci instagram src/` is zero. The template existed and was removed
as unreliable in `fa939189`, and `core-matcher-regressions.test.ts:249` now
*asserts it is not offered*. Its only citation was a changelog line advertising
the template — corrected in `016d0a92`. An Instagram post URL carries no
username, so this is a design rejection, not an oversight.

**Partial:** **#191** (no Facebook template exists, and the ask is impossible —
a friend's name lives only in page DOM and `css:` is match-only, not a text
extractor; no community-submission venue shipped either). **#194** (asked for a
*description* of multi-rule ordering; what shipped is the route debugger, a
*tool*. First-match is stated only in a templates-panel hint and developer
docs, not the user-facing clause reference). **#210** (the Twitter/X handle
ships; the display name cannot — DOM-only — and the template needs a
`/status/` permalink, so profile-page saves don't match).

**Close with a corrected rule in the reply:** **#187** (only one `rename:`
clause per rule, and find-groups are not backreferenceable — only matcher
captures `:$1:` expand; a literal-space find also breaks on the ` -> ` split,
so `\x20` is the documented escape). **#189** (this is the #178 shape — their
posted rule uses `filename:`, which is not the final name; they must switch to
`finalfilename:`. Do not point them at a DeviantArt template: it was removed).
**#209** (`rename: ^https?_+ -> ` with an empty replacement is the "omit certain
text" option they could not find; there is still no scheme-free page-URL
variable).

**Clean:** **#137** (`fetch:`, tested with the reporter's exact pbs.twimg.com
URL), **#208** (`:menupath:` — note it is the full chosen *path*, not the leaf
folder name they asked for; separators sanitize to `_` inside a filename).

### Bugs

**#190 — FIXED.** v3's `messaging.js:64-95` seeded `path: last.path` for
`CLICK` context and joined it with the rule's `into:` — the only mechanism
producing the described inheritance. `download-plan.ts:203-210` resets
`CLICK`/`AUTO` to `Path(".")`; `download-plan.test.ts:804` uses the reporter's
literal `Plants/Trees/Baobabs` scenario. Caveat: a later *context-menu* folder
pick still concatenates with `into:` — by design, unchanged.

**#188 — FIXED.** Root cause confirmed in v3: `router.js:20-24`'s tab matcher
ignored `info` and read the global `currentTab`, which is the Add-ons Manager
while the options page is focused — hence "Administrador de Complementos".
`matchers.ts:156-163` now prefers the attached tab. Browser-independent.

**#205 — PARTIAL, and its changelog line was wrong.** Fixed in `016d0a92`: the
entry credited debounced autosave, but v3 already saved text inputs on every
keystroke, so debouncing cannot fix it. The real v3 cause is `menu.js:400`
rewriting the Last used title with a hardcoded `(&a)` on every folder save,
discarding `keyLastUsed` — exactly "the hotkey isn't working until i reinput it
each time". Fixed at `menu-click.ts:258`. **But the report has a second half** —
click-to-save on civitai producing an extensionless <2MB file — which nothing
addresses. Closing answers only one of two symptoms. Reporter is on Edge; no
Edge coverage exists.

**#217 — PARTIAL.** Half (a), conflict → native Save As, is `conflictAction:
"prompt"` and was **dead on Chrome** until `cd80f9e0`: the inverted gate made
the schema rewrite the user's `prompt` back to `uniquify` on every load, so the
exact feature they were told to use did not work. Half (b) — an auto-closing
timer/cancel dialog — **does not exist and cannot**: a WebExtension cannot put a
timer on the browser's native Save As dialog. Needs user action (not a default),
and the reporter never stated a browser; on Firefox they get nothing.

**#89 — FIXED**, with the same `cd80f9e0` gate. Note the downgrade is
in-memory: storage keeps `prompt`, and the options page reads the raw stored
value, so an imported Firefox profile shows a hidden+disabled option until the
user picks another. Cosmetic; downloads work.

### The e2e conflictAction assertions proved nothing

Found while validating #89/#217. `b04d753b` derived the e2e check from the
extension itself — `capabilities: WEB_EXTENSION_CAPABILITIES` and
`OPTION_KEYS.find(...).onLoad("prompt")`. `05df4cc4` replaced the global bridge,
putting those bindings out of reach of a script running outside the bundle, and
the harness **restated** the detection instead. Both suites have since asserted
the harness against itself.

That is why the inverted gate survived a fix aimed straight at it:
`promptConflictAction` still encoded Firefox→"prompt" after `cd80f9e0`, and an
e2e run would not have caught it. Corrected in `5554e142`, with the circularity
named at the call site. A genuine probe must route through
`background/e2e-command.ts` (inside the bundle) and needs a browser run to
verify — not attempted.

## Not yet validated

- The ~28 reports the 4.0.0 CHANGELOG is said to resolve (`ROADMAP.md:47-49`).
  This is a **bulk claim** and the weakest category — the #178 finding shows a
  correct mechanism can still need a rule change in the reply.
- **#205** — real title is *"option hotkey … kept turning off when extension
  settings tab is closed"*, which does not obviously match the existing draft's
  framing (access keys + click-to-save state). Re-read before using that draft.
- **#104** (close as by-design), **#207 / #196 / #143** (retest asks).
- Non-goals whose reasons cite external facts and can age out silently:
  **#148** ("no WebExtension API exists"), **#121** (clipboard). Neither is
  checkable from the repo.
- Every verdict above is code-side only. None retested in a live browser.

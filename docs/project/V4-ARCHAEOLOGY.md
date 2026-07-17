# v4 archaeology

A retrospective on the `v4` branch: how much code was written, how much survived
to the tip, and how much of the *behaviour* survived even where none of the
*code* did. The headline result is that the two diverge sharply — the router
retained ~0 of its lines but nearly all of its semantics.

Measured at the `v4.0.0` tag on 2026-07-18. Regenerate with the commands at the
bottom.

## Branch shape

**9 days · 1,491 commits · +208,286 / −15,377 · a full ManifestV2-JS → MV3-TS
rewrite.**

The span has two phases. Days 07-10 through 07-15 are the rewrite proper — the
from-scratch TypeScript reimplementation. Days 07-16 through 07-18 are
release-hardening: first green CI, the e2e flake fixes, store assets, docs, and
the release.

At the merge base (`master`) the extension was the original MV2 codebase in plain
JavaScript (`src/router.js`, `src/variable.js`, `src/path.js`). `v4` is a rebuild
from the ground up: the entire `src/routing/`, `src/options/`, `src/downloads/`,
and `src/background/` trees are new files.

| Metric | Value |
| --- | --- |
| Commits since master | 1,491 (~166/day over 9 days) |
| Files changed | 795 (+712 new, −63 deleted, 20 modified) |
| Raw diff | +208,286 / −15,377 |
| Source files at tip | 313 `.ts`/`.css` under `src/` |
| Most-churned file | `src/options/style.css` — 211 touches |
| Peak commit hour | 03:00 (130 commits) |

### Cadence (commits/day)

```
07-10  ██          87   (day 1)
07-11  ██          75
07-12  █████      187
07-13  ████       140
07-14  ████       154
07-15  ███████████ 449   ← peak: 30% of the branch in one day
07-16  ███        112
07-17  ███████    262   ← release-hardening begins
07-18  ▏           25   (tag v4.0.0)
```

## Code survival

Roughly **103,500 lines** were written into `src/` over the branch; about
**52,600** survive at the tip (~50%). Attributing each surviving line to the day
it was *last* written (`git blame`):

| Day | Written | Surviving | Rate |
| --- | ---: | ---: | ---: |
| 07-10 | 1,370 | 1,271 | ~93% |
| 07-11 | 9,070 | 586 | ~6% |
| 07-12 | 15,620 | 4,763 | ~30% |
| 07-13 | 10,034 | 4,956 | ~49% |
| 07-14 | 13,562 | 6,703 | ~49% |
| 07-15 | 33,516 | 17,574 | ~52% |
| 07-16 | 12,410 | 9,991 | ~81% |
| 07-17 | 7,948 | 6,432 | ~81% |
| 07-18 | 7 | 7 | 100% |

Blame credits a line to its most recent edit, so early days are understated — a
line written on the 11th and revised on the 15th counts as a 15th survivor.
Adjusting for that, the trend is consistent: the further a day sits from the tip,
the more of its work was later rewritten (the 11th almost entirely). The high
survival of the last three days reflects the release-hardening phase, which
mostly added rather than replaced.

### Oldest surviving lines

Blame found **~355 lines that predate `v4` entirely**, the oldest dated
**2017-04-21** — original Save In code carried through the MV3 rewrite unchanged:

```
2017-12-05:   47 lines
2018-01-28:  125 lines   ← largest ancient block
2019-05-20:   37 lines
2021-06-13:   19 lines
```

Three representative examples, all still in use:

**Browser behaviour note (October 2017)** — `downloads/notification-events.ts`.
New TypeScript surrounds it, but the comment is verbatim, because the Chrome
behaviour it records is unchanged:

```ts
// CHROME
// Chrome does not have the filename in the initial DownloadItem,
// so extract it from the DownloadDelta
```

**Routing date variables (January 2018)** — `routing/variable.ts`, the largest
ancient block. `:year:`, `:month:`, `:day:`, `:hour:` were defined then and are
defined identically now. (Blame ignores whitespace, so a reformat does not reset
authorship — the logic dates to 2018.)

```ts
[SPECIAL_DIRS.YEAR]:   opts => stringSegment(opts.now.getFullYear()),
[SPECIAL_DIRS.MONTH]:  opts => stringSegment(padDateComponent(opts.now.getMonth() + 1)),
[SPECIAL_DIRS.SECOND]: opts => stringSegment(padDateComponent(opts.now.getSeconds())),
```

**Shortcut vocabulary (November 2017)** — `shared/constants.ts`. The set of
shortcut file kinds is unchanged in nine years:

```ts
[SHORTCUT_TYPES.MAC]:           ".url",
[SHORTCUT_TYPES.FREEDESKTOP]:   ".desktop",
[SHORTCUT_TYPES.HTML_REDIRECT]: ".html",
```

## Logic survival — the inverse result

The router is the clearest divergence between code and behaviour. By line count
it is the least-surviving code in the project; by behaviour it is the most
preserved.

- **Code survival: 0 lines.** Different files, different language; `git blame`
  attributes none of the tip's routing code to `master`.
- **Logic survival: near-total.** The matching semantics crossed the rewrite
  essentially unchanged, then were extended.

The `routing/` directory (`rule-matcher.ts`, `matchers.ts`, `rule-parser.ts`,
`variable.ts`, …) is new files reimplementing the old `router.js` /
`variable.js` behaviour:

| Concept | master `router.js` | v4 `routing/*.ts` | Survived? |
| --- | --- | --- | --- |
| Matcher vocabulary | 15 names | same 15 (+ ~9 new) | ✅ 15/15 |
| Rule = typed clauses | `RULE_TYPES` MATCHER/DESTINATION/CAPTURE | same enum (+ `FETCH`) | ✅ |
| All matchers must pass (AND) | `matches.some(m => !m)` | `.filter(...MATCHER).map(...)` | ✅ |
| First matching rule wins | `matchRules` loop | `matchRulesDetailed` | ✅ |
| Capture substitution `:$N:` | `split(...).join(...)` | `.replace(/:\$(\d+):/g, ...)` | ✅ |
| `into:` strips `./`, comma-separated `capture:` | ✅ | ✅ | ✅ |
| Validation taxonomy (`ruleMissingInto`, `ruleExtraInto`, `ruleMissingCapture`, `ruleCaptureMissingMatcher`, …) | ✅ | ✅ same i18n keys | ✅ |
| Blank-line-separated rules, `//` comments | ✅ | ✅ | ✅ |
| Path variable tokens (`SPECIAL_DIRS`) | 20 | ~42 (all 20 kept) | ✅ |

The 15 matcher names carried over verbatim:

```
comment context fileext filename frameurl linktext mediatype menuindex
naivefilename pagedomain pagetitle pageurl selectiontext sourcedomain sourceurl
```

### Behaviour that did not survive

- `window.SI_DEBUG` + `console.log("matched", …)` logging in every matcher —
  replaced by the `route-debugger/` subsystem.
- The `RouterFactory` closure-of-closures style (`regex => info => …`) —
  flattened into typed `matcherFunctions` over candidate/source records.
- Untyped `info[propertyName]` access — replaced by `RoutingInfo` /
  `MatcherClause` / `FetchClause` discriminated types.
- `JSON.stringify(lines)` error dumps — replaced by span-tracked editor positions
  (`valueSpan`).

### New, with no master ancestor

- The `fetch:` clause (`RULE_TYPES.FETCH`) — rewrite the download address before
  saving (#137).
- `capturegroups:` (flatten regex groups) alongside `capture:`.
- Rename-only eligibility (`isRenameOnlyEligibleRule`) and automatic-routing
  eligibility gating (`matchRulesDetailed` + predicate).
- The visual `rule-builder` / `rule-visual-editor` / `rule-templates` editors.
- ~22 new path variables: `:uuid:`, `:sha:`, `:counter:`, `:tld:`, `:mime:`,
  `:pagetitleslug:`, `:isoweek:`, `:redirecturl:`, and more.

## Summary

`v4` is a 9-day branch — a 6-day, ~104k-line rewrite plus 3 days of
release-hardening — in which ~50% of the code did not survive its own branch and
0 lines of the router survived, while the router's behaviour is the most
preserved thing in the project. Least-surviving code, most-surviving logic.

## Reproducing these numbers

`BASE` is the pre-v4 master (the v3.7.3-era tip, commit `4efb1cc2`, before the
rewrite merged); `END` is the `v4.0.0` release tag.

```bash
BASE=4efb1cc2
END=v4.0.0

# Branch shape
git rev-list --count "$BASE".."$END"
git diff --shortstat "$BASE" "$END"
git log "$BASE".."$END" --format='%cd' --date=short | sort | uniq -c

# Surviving lines by authoring day (blame every current src line)
git ls-tree -r "$END" --name-only src | grep -E '\.(ts|css)$' | while read f; do
  git blame -w --line-porcelain "$END" -- "$f" | grep '^committer-time '
done | awk '{print $2}'   # epoch seconds -> bucket by local date

# Matcher vocabulary, then vs now
git show "$BASE":src/router.js        | grep -oE '^    [a-z]+:'
git show "$END":src/routing/matchers.ts  | grep -oE '^  [a-z]+:'
```

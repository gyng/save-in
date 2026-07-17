# v4 archaeology

_A thing can be replaced entirely and remain, stubbornly, itself. Swap every
plank of a ship one at a time and it sails back out under the same name, and
nobody writes in to complain. Version 4 is that ship. The nine-year-old
Manifest V2 machinery was carried out plank by plank, and something in
TypeScript was nailed together in the hole where it had been. Tens of thousands
of lines were written. A great many did not survive the week — the customary
fate of code that sets off into a rewrite without a map, a compass, or any firm
evidence that the rewrite has an end. And yet the router — the small, stubborn
engine that decides where a downloaded file finally comes to rest — thinks
precisely the thoughts it thought in 2017, having noticed none of this._

A retrospective on the `v4` branch, undertaken for no better reason than that
the numbers were sitting there and someone wanted to know: how much code was
written, how much of it was still breathing at the tip, and — the genuinely
interesting part — how much of the *behaviour* outlived the *code* that used to
express it. Everything below was measured at the `v4.0.0` tag on 2026-07-18. The
commands to regenerate it, for the suspicious, are at the bottom.

## The shape of it

**9 days · 1,491 commits · +208,286 / −15,377 · a complete ManifestV2-JS → MV3-TS
rewrite that then, against the odds, shipped.**

Two phases are folded into that span, and it is only polite to keep them apart.
Days 07-10 through 07-15 were the rewrite proper: the from-scratch
reimplementation, carried out at the pace of someone who has not yet discovered
how much is left to do. Days 07-16 through 07-18 were release-hardening — the
first continuous-integration run that ever went green, the search for the tests
that failed only on other people's machines, the store assets, the documentation
reshuffle, and the release itself. Six days to build the thing; three more to
persuade everyone, the CI included, that it was allowed to exist.

At the merge base (`master`) the extension was the original MV2 codebase in plain
JavaScript — `src/router.js`, `src/variable.js`, `src/path.js`, and the rest of
that generation. `v4` is a rebuild from the ground up: the entire `src/routing/`,
`src/options/`, `src/downloads/`, and `src/background/` trees are files that did
not previously exist.

| Metric | Value |
| --- | --- |
| Commits since master | 1,491 (~166/day over 9 days) |
| Files changed | 795 (+712 new, −63 deleted, 20 modified) |
| Raw diff | +208,286 / −15,377 |
| Source files at tip | 313 `.ts`/`.css` under `src/` |
| Most-churned file | `src/options/style.css` — touched 211 times |
| Peak commit hour | 03:00 🦉 (130 commits) |

The single most-edited file was a stylesheet, revised 211 times, which is either
a tribute to the difficulty of making things look correct or a warning about it.
The busiest hour for committing was three in the morning, a figure that declines
to explain itself.

### Cadence

```
07-10  ██          87   (day 1)
07-11  ██          75
07-12  █████      187
07-13  ████       140
07-14  ████       154
07-15  ███████████ 449   ← peak: 30% of the branch in a single day
07-16  ███        112
07-17  ███████    262   ← release-hardening begins
07-18  ▏           25   (tag v4.0.0)
```

## Code survival — half didn't make it

Roughly **103,500 lines** were written into `src/` over the branch. About
**52,600** are still there. The remainder were, in the fullness of a week,
thought better of. Crediting each surviving line to the day it was *last* touched
(`git blame`, which is less of an accusation than it sounds):

| Day | Written | Surviving | Rate |
| --- | ---: | ---: | ---: |
| 07-10 | 1,370 | 1,271 | ~93% |
| 07-11 | 9,070 | 586 | ~6% 💀 |
| 07-12 | 15,620 | 4,763 | ~30% |
| 07-13 | 10,034 | 4,956 | ~49% |
| 07-14 | 13,562 | 6,703 | ~49% |
| 07-15 | 33,516 | 17,574 | ~52% |
| 07-16 | 12,410 | 9,991 | ~81% |
| 07-17 | 7,948 | 6,432 | ~81% |
| 07-18 | 7 | 7 | 100% |

Blame credits a line to its most recent edit, so the early days come off worse
than they deserve: a line written on the 11th and tidied on the 15th is recorded
as a citizen of the 15th, with no memory of where it came from. Allowing for
that, the shape is honest enough. The further a day sits from the tip, the more
thoroughly its work was later reconsidered, and the 11th in particular was very
nearly erased from the record. The unusually high survival of the final three
days is not virtue — it is that hardening rarely turns around and rewrites
itself.

### The oldest survivors 🪦

Not everything is new, and some of it is startlingly old. Blame turned up
**~355 lines that predate `v4` entirely**, the eldest dated **2017-04-21** —
original Save In code that has now outlived nine years, a change of manifest
version, and a rewrite that replaced everything around it without once looking
down:

```
2017-12-05:   47 lines
2018-01-28:  125 lines   ← largest ancient block
2019-05-20:   37 lines
2021-06-13:   19 lines
```

They are not museum pieces. Three, all still bearing weight:

**A fact about a browser, written down in October 2017** —
`downloads/notification-events.ts`. The code around it is new TypeScript behind a
capability check, but the observation itself was copied across untouched, for the
uncomplicated reason that Chrome has never stopped doing this:

```ts
// CHROME
// Chrome does not have the filename in the initial DownloadItem,
// so extract it from the DownloadDelta
```

**The routing date variables, January 2018** — `routing/variable.ts`, the largest
ancient block. `:year:`, `:month:`, `:day:`, `:hour:`, and their relatives were
defined then and are defined identically now. (Blame ignores whitespace, so
reformatting a line does not reset its birthday: the *logic* is genuinely 2018,
merely better dressed.)

```ts
[SPECIAL_DIRS.YEAR]:   opts => stringSegment(opts.now.getFullYear()),
[SPECIAL_DIRS.MONTH]:  opts => stringSegment(padDateComponent(opts.now.getMonth() + 1)),
[SPECIAL_DIRS.SECOND]: opts => stringSegment(padDateComponent(opts.now.getSeconds())),
```

**The shortcut vocabulary, November 2017** — `shared/constants.ts`. The kinds of
shortcut a user may save have not changed in nine years, the world having quietly
reached a consensus on the matter:

```ts
[SHORTCUT_TYPES.MAC]:           ".url",
[SHORTCUT_TYPES.FREEDESKTOP]:   ".desktop",
[SHORTCUT_TYPES.HTML_REDIRECT]: ".html",
```

## Logic survival — the inverse story 🧬

The router is the sharpest paradox on the branch. Measured in lines, it is the
*least*-surviving code in the project. Measured in behaviour, it is the
*most*-surviving thing in it.

- **Code survival: 0 lines.** Different files, a different language; `git blame`
  attributes not one line of the tip's routing to `master`, and is quite firm
  about it.
- **Logic survival: very nearly total.** The matching rules crossed the rewrite
  essentially unchanged and then, having arrived safely, were handed more to do.

The whole `routing/` directory (`rule-matcher.ts`, `matchers.ts`,
`rule-parser.ts`, `variable.ts`, …) is a set of new files dutifully
reimplementing what `router.js` / `variable.js` already did:

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

The 15 matcher names that came across word for word:

```
comment context fileext filename frameurl linktext mediatype menuindex
naivefilename pagedomain pagetitle pageurl selectiontext sourcedomain sourceurl
```

### What genuinely didn't survive

Some things were not worth carrying, and were left where they lay:

- `window.SI_DEBUG` + `console.log("matched", …)` noise scattered through every
  matcher — replaced by the interactive `route-debugger/` subsystem, which at
  least keeps its opinions in one place.
- The `RouterFactory` closure-of-closures style (`regex => info => …`) —
  flattened into typed `matcherFunctions` over candidate/source records.
- Untyped `info[propertyName]` duck-typing — replaced by `RoutingInfo` /
  `MatcherClause` / `FetchClause` discriminated types, which now object in
  advance rather than at runtime.
- `JSON.stringify(lines)` error dumps — replaced by span-tracked editor positions
  (`valueSpan`), so an error can point at the thing it means.

### What is entirely new (no master ancestor)

Things with no ancestor to survive, being new:

- The `fetch:` clause (`RULE_TYPES.FETCH`) — rewrite the download address before
  saving (#137).
- `capturegroups:` (flatten regex groups) alongside the classic `capture:`.
- Rename-only eligibility (`isRenameOnlyEligibleRule`) and automatic-routing
  eligibility gating (`matchRulesDetailed` + predicate).
- The visual `rule-builder` / `rule-visual-editor` / `rule-templates` editors.
- ~22 new path variables: `:uuid:`, `:sha:`, `:counter:`, `:tld:`, `:mime:`,
  `:pagetitleslug:`, `:isoweek:`, `:redirecturl:`, and more.

## The one-liner

If it must be said in a breath: `v4` is a 9-day branch — a 6-day, ~104k-line
rewrite trailed by 3 days of release-hardening — in which **half the code did not
survive its own branch** and **not a single line of the router did**, yet the
router's *behaviour* is the best-preserved thing in the entire project. The
least-surviving code carried the most-surviving idea across. Make of that what
you will.

## Reproducing these numbers

For the suspicious, or the merely curious. `BASE` is the pre-v4 master (the
v3.7.3-era tip, commit `4efb1cc2`, before the rewrite merged); `END` is the
`v4.0.0` release tag.

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

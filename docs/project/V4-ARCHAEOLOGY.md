# v4 archaeology

_Version 4 is the same extension it always was, in the way that a ship is the
same ship after every last plank has been replaced. The nine-year-old
ManifestV2 machinery was lifted out, plank by plank, and rebuilt in TypeScript
for the browsers of the present day. Tens of thousands of lines were written; a
fair number did not last the week, which is the customary fate of code that
wanders into a rewrite without a map. Yet the router — the small, stubborn
engine that decides where a file comes to rest — thinks exactly as it did in
2017._

This is a for-fun retrospective on the `v4` branch: how much code was written,
how much of it survived to the tip, and — more interestingly — how much of the
*behavior* survived even where none of the *code* did. Numbers are measured at
the `v4.0.0` tag on 2026-07-18; regenerate with the commands at the bottom.

## The shape of it

**9 days · 1,491 commits · +208,286 / −15,377 · a full ManifestV2-JS → MV3-TS
rewrite, then shipped.**

Two phases hide inside that span. Days 07-10 through 07-15 are the rewrite
proper — the from-scratch TypeScript reimplementation. Days 07-16 through 07-18
are release-hardening: the first green CI the branch ever had, the e2e flake
hunt, store assets, the docs reorganization, and the release itself. The rewrite
was six days; making it shippable took three more.

At the merge base (`master`), the extension was the original MV2 codebase in
plain JavaScript (`src/router.js`, `src/variable.js`, `src/path.js`, and
friends). `v4` is a ground-up TypeScript rebuild: the entire `src/routing/`,
`src/options/`, `src/downloads/`, and `src/background/` trees are new files.

| Metric | Value |
| --- | --- |
| Commits since master | 1,491 (~166/day over 9 days) |
| Files changed | 795 (+712 new, −63 deleted, 20 modified) |
| Raw diff | +208,286 / −15,377 |
| Source files at tip | 313 `.ts`/`.css` under `src/` |
| Most-churned file | `src/options/style.css` — touched 211 times |
| Peak commit hour | 03:00 🦉 (130 commits) |

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

Roughly **103,500 lines** were written into `src/` over the branch; **~52,600
survive** at the tip. Attributing each surviving line to the day it was *last*
written (via `git blame`):

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

Blame credits a surviving line to its *most recent* edit, so early days are
understated — a line written on the 11th and revised on the 15th counts as a
15th survivor. That caveat aside, the pattern is plain: the further from the
tip, the more of that day's work was later rewritten, and day 11 in particular
was almost entirely superseded. The high survival of the last three days is the
release tail — hardening rarely rewrites itself.

### The oldest survivors 🪦

Not everything is new. Blame turned up **~355 lines that predate `v4`
entirely**, the oldest dated **2017-04-21** — original Save In code that has
outlived nine years and an entire MV3 rewrite:

```
2017-12-05:   47 lines
2018-01-28:  125 lines   ← largest ancient block
2019-05-20:   37 lines
2021-06-13:   19 lines
```

## Logic survival — the inverse story 🧬

The router is the sharpest contrast on the branch. By line count it is the
*least* surviving code in the project; by behavior it is the *most* surviving
logic.

- **Code survival: 0 lines.** Different files, different language — `git blame`
  credits none of the tip's routing code to `master`.
- **Logic survival: near-total.** The matching semantics came through the
  rewrite essentially unchanged, then were extended.

The whole `routing/` directory (`rule-matcher.ts`, `matchers.ts`,
`rule-parser.ts`, `variable.ts`, …) is new files that reimplement the old
`router.js` / `variable.js` behavior:

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

The 15 matcher names that carried over verbatim:

```
comment context fileext filename frameurl linktext mediatype menuindex
naivefilename pagedomain pagetitle pageurl selectiontext sourcedomain sourceurl
```

### What genuinely didn't survive

- `window.SI_DEBUG` + `console.log("matched", …)` noise scattered through every
  matcher — replaced by the interactive `route-debugger/` subsystem.
- The `RouterFactory` closure-of-closures style (`regex => info => …`) —
  flattened into typed `matcherFunctions` over candidate/source records.
- Untyped `info[propertyName]` duck-typing — replaced by `RoutingInfo` /
  `MatcherClause` / `FetchClause` discriminated types.
- `JSON.stringify(lines)` error dumps — replaced by span-tracked editor
  positions (`valueSpan`).

### What is entirely new (no master ancestor)

- The `fetch:` clause (`RULE_TYPES.FETCH`) — rewrite the download address before
  saving (#137).
- `capturegroups:` (flatten regex groups) alongside the classic `capture:`.
- Rename-only eligibility (`isRenameOnlyEligibleRule`) and automatic-routing
  eligibility gating (`matchRulesDetailed` + predicate).
- The visual `rule-builder` / `rule-visual-editor` / `rule-templates` editors.
- ~22 new path variables: `:uuid:`, `:sha:`, `:counter:`, `:tld:`, `:mime:`,
  `:pagetitleslug:`, `:isoweek:`, `:redirecturl:`, and more.

## The one-liner

`v4` is a 9-day branch — a 6-day, ~104k-line rewrite followed by 3 days of
release-hardening — where **half the code didn't survive its own branch** and
**not one line of the router survived** — yet the router's *behavior* is the
most-preserved thing in the whole project. Least-surviving code, most-surviving
logic.

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

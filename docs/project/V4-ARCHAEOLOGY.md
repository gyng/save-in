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
*behavior* survived even where none of the *code* did. Numbers are from the
branch as measured on 2026-07-16; regenerate with the commands at the bottom.

## The shape of it

**6 days · 1,134 commits · +170,084 / −15,299 · a full ManifestV2-JS → MV3-TS
rewrite.**

At the merge base (`master`), the extension was the original MV2 codebase in
plain JavaScript (`src/router.js`, `src/variable.js`, `src/path.js`, and
friends). `v4` is a ground-up TypeScript rebuild: the entire `src/routing/`,
`src/options/`, `src/downloads/`, and `src/background/` trees are new files.

| Metric | Value |
| --- | --- |
| Commits since master | 1,134 (~189/day) |
| Files changed | 716 (+634 new, −63 deleted, 19 modified) |
| Raw diff | +170,084 / −15,299 |
| Source files at tip | 279 `.ts`/`.css` under `src/` |
| Most-churned file | `src/options/style.css` — touched 208 times |
| Peak commit hour | 03:00 🦉 |

### Cadence

```
07-10  ▏  87   (day 1)
07-11  ▏  75
07-12  ██ 187
07-13  █  140
07-14  █  154
07-15  ████████████ 449   ← peak: 39% of the branch in a single day
07-16  ▏  42
```

## Code survival — half didn't make it

Roughly **90,400 lines** were written into `src/` over the branch; **45,366
survive** at the tip. Attributing each surviving line to the day it was *last*
written (via `git blame`):

| Day | Written | Surviving | Rate |
| --- | ---: | ---: | ---: |
| 07-11 | 9,070 | 798 | ~9% 💀 |
| 07-12 | 15,620 | 5,180 | ~33% |
| 07-13 | 10,034 | 5,204 | ~52% |
| 07-14 | 13,562 | 7,030 | ~52% |
| 07-15 | 33,516 | 18,855 | ~56% |
| 07-16 | 7,239 | 6,546 | ~90% |

Blame credits a surviving line to its *most recent* edit, so early days are
understated — a line written on the 11th and revised on the 15th counts as a
15th survivor. That caveat aside, the pattern is plain: the further from the
tip, the more of that day's work was later rewritten, and day 11 in particular
was almost entirely superseded.

### The oldest survivors 🪦

Not everything is new. Blame turned up **~400 lines that predate `v4`
entirely**, the oldest dated **2017-04-21** — original Save In code that has
outlived nine years and an entire MV3 rewrite:

```
2017-12-05:   51 lines
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

`v4` is a 6-day, ~90k-line rewrite where **half the code didn't survive its own
branch** and **not one line of the router survived** — yet the router's
*behavior* is the most-preserved thing in the whole project. Least-surviving
code, most-surviving logic.

## Reproducing these numbers

```bash
# Branch shape
git rev-list --count master..v4
git diff --shortstat master v4
git log master..v4 --format='%cd' --date=short | sort | uniq -c

# Surviving lines by authoring day (blame every current src line)
git ls-tree -r v4 --name-only src | grep -E '\.(ts|css)$' | while read f; do
  git blame -w --line-porcelain v4 -- "$f" | grep '^committer-time '
done | awk '{print $2}'   # epoch seconds -> bucket by local date

# Matcher vocabulary, then vs now
git show master:src/router.js        | grep -oE '^    [a-z]+:'
git show v4:src/routing/matchers.ts  | grep -oE '^  [a-z]+:'
```

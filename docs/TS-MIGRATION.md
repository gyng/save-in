# TypeScript / ESM build record

The source migration is complete. Production code is TypeScript with native
ES-module boundaries, and Rolldown emits readable, non-minified bundles for the
browser execution contexts.

This document records the decisions that remain relevant to maintenance. The
old branch-by-branch migration checklist was removed after every production
module and test had moved to the current build.

## Current build contract

- `src/entries/background.ts` is the production background entry for both the
  Firefox event page and Chrome service worker.
- `src/entries/background.e2e.ts` adds the narrow browser-test command only in
  explicit e2e builds.
- Options, offscreen, content, and reference pages have separate entries.
- Classic page/background contexts use bare scope-hoisted `esm` output. The
  isolated content and reference scripts use `iife` output.
- Store bundles are non-minified and include source maps so reviewers can trace
  emitted code back to TypeScript.
- Original TypeScript is excluded from the executable package and included in
  the separate Mozilla source attachment.

## Type-checking boundaries

Application source is checked independently against Firefox, Chrome, and a
DOM-free Chrome worker environment. Tests have their own host declarations and
typed WebExtension fixtures. Release-critical build scripts are checked under
strict JavaScript settings; browser-control and e2e drivers use dedicated
projects so their host protocols can be tightened without weakening release
tooling.

## Load-bearing constraints

1. Background listeners must be registered synchronously from the entry graph.
2. Source modules must not publish application state through browser globals.
3. Cross-context communication uses validated runtime messages or persisted
   storage contracts.
4. Background modules remain worker-safe; Firefox-only DOM capabilities are
   feature-detected at their use sites.
5. A production package must contain no e2e command or open-shadow test seam.

The executable commands and release gates are maintained in `AGENTS.md` and
`docs/STORE-SUBMISSION.md`. Current dependency-boundary rules are summarized in
`docs/ARCH-CYCLES.md`.

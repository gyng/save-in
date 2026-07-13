# save-in roadmap

This document tracks current work only. `AGENTS.md` documents the current
architecture and contributor constraints; Git history retains completed plans.

## Current priorities

- Keep the shared Firefox event-page and Chrome service-worker implementation
  correct across suspension, restart, private browsing, and stale content
  scripts.
- Preserve compatibility at storage, message, configuration, routing, and
  browser-version boundaries.
- Keep releases reproducible, store-reviewable, and verified against the same
  staged bundle that is uploaded.
- Improve the options and download workflows without increasing permissions or
  weakening feature detection.

## Deferred separate project

A native-messaging yt-dlp companion remains intentionally deferred to a
separate repository. It has a different installation and trust model from the
extension and should not add native-host scaffolding to this package unless
that product decision changes explicitly.

## Completed foundations

The extension now uses strict TypeScript modules, readable non-minified rolldown
bundles, an acyclic import graph, explicit mutable-state owners, one shared
background source graph, production-message browser tests, and separate strict
typecheck projects for application, release-tool, development-tool, and e2e
contexts.

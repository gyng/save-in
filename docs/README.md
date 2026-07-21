# Save In documentation

An index of the docs in this directory, grouped by who needs them. The
[README](../README.md) introduces the extension; [AGENTS.md](../AGENTS.md) is the
contributor guide and states the architecture and conventions that the rest of
these documents assume.

## Using Save In — [`using/`](using/)

- [Destination and source workflows](using/DESTINATION-AND-SOURCE-WORKFLOWS.md) — how
  destinations, Page Sources, History, and source-link shortcuts connect:
  per-destination Save As, recent locations, and batch saves.
- [Automatic source saves](using/AUTOMATIC-SOURCE-SAVES.md) — setting up and bounding
  unattended saving of discovered page sources. Off by default, and narrower
  than ordinary routing on purpose.

## Integrating with Save In — [`integrating/`](integrating/)

- [Integrations](integrating/INTEGRATIONS.md) — the contract for the external Download API,
  config discovery and validation, webhooks, and the experimental WebMCP tools.
  Source-controlled, and authoritative over the wiki on protocol details; the
  wiki holds the user-facing recipes.

## Contributing — [`contributing/`](contributing/)

- [UI system](contributing/UI.md) — the contract for the options, reference, and in-page
  surfaces: cascade-layer order, tokens, interaction and accessibility rules,
  and the checklist new UI must satisfy.
- [Translations](contributing/TRANSLATIONS.md) — the English-canonical catalog workflow and
  the policy for the opt-in generated locales.
- [On-device prompt](contributing/ON-DEVICE-PROMPT.md) — what Gemini Nano measurably does
  with a rule prompt. Read before changing the prompts, schemas, or guardrails:
  what governs this model is measured here, not guessed.
- [Fuzzing](contributing/FUZZING.md) — running and replaying the bounded property suite, and
  the campaign record.
- [Browser E2E harness](contributing/E2E.md) — the persistent control plane,
  lifecycle and retry-safety contract, RSS measurement, CI-constrained stress
  workflow, and artifact triage.
- [Coverage policy](contributing/COVERAGE.md) — full-source 100% thresholds,
  the zero-ignore ceiling, and patterns for unreachable composition seams.

## Reviewing — [`reviewing/`](reviewing/)

- [Security and privacy reviews](reviewing/SECURITY-PRIVACY-REVIEWS.md) — the
  client-extension threat model, severity calibration, and the fix-versus-accept
  analysis a finding needs. Read it before scanning.

## Store listing — [`store/`](store/)

- [Store descriptions](store/descriptions.md) — the canonical AMO and Chrome Web
  Store copy to paste at release.
- [`store/screenshots/`](store/screenshots/) — the 1280×800 product screenshots for
  both stores; [`store/assets/`](store/assets/) — promo tiles, listing icons, and the
  demo photo. Both are regenerated (see the release workflow).

## Releasing — [`release/`](release/)

- [Release workflow](release/workflow.md) — build artifacts, store upload, provenance,
  and the browser-owned checks. On-demand; ordinary development does not need it.
- [Reviewer notes](release/reviewer-notes.md) — what to tell an AMO or Chrome Web
  Store reviewer: what the extension does, why each permission is requested, how
  to exercise the main flows, and the data-collection stance.

## Project history and direction — [`project/`](project/)

- [Roadmap](project/ROADMAP.md) — what landed in 4.0.0, the one open evidence-gated
  decision, and the non-goals with the reason each was rejected: grammar cost, a
  design objection, or a missing WebExtension API. The place to look before
  reopening a recurring request.
- [V4 archaeology](project/V4-ARCHAEOLOGY.md) — a retrospective on the six-day MV3
  rewrite. A snapshot: its numbers are dated and drift with the branch.
- [Issue validation](project/issues-v4.md) — working notes for the unposted 4.0.0
  tracker sweep. Point-in-time and anchored to an older commit, not a contract.

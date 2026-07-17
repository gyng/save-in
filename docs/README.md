# Save In documentation

An index of the docs in this directory, grouped by who needs them. The
[README](../README.md) introduces the extension; [AGENTS.md](../AGENTS.md) is the
contributor guide and states the architecture and conventions that the rest of
these documents assume.

## Using Save In

- [Destination and source workflows](DESTINATION-AND-SOURCE-WORKFLOWS.md) — how
  destinations, Page Sources, History, and source-link shortcuts connect:
  per-destination Save As, recent locations, and batch saves.
- [Automatic source saves](AUTOMATIC-SOURCE-SAVES.md) — setting up and bounding
  unattended saving of discovered page sources. Off by default, and narrower
  than ordinary routing on purpose.

## Integrating with Save In

- [Integrations](INTEGRATIONS.md) — the contract for the external Download API,
  config discovery and validation, webhooks, and the experimental WebMCP tools.
  Source-controlled, and authoritative over the wiki on protocol details; the
  wiki holds the user-facing recipes.

## Contributing

- [UI system](UI.md) — the contract for the options, reference, and in-page
  surfaces: cascade-layer order, tokens, interaction and accessibility rules,
  and the checklist new UI must satisfy.
- [Code organization](CODE-ORGANIZATION.md) — the module boundaries, layering,
  and naming decisions, and why each was made. A completed plan kept as a
  rationale record; source files and `scripts/check-import-cycles.js` cite its
  phase numbers.
- [Translations](TRANSLATIONS.md) — the English-canonical catalog workflow and
  the policy for the opt-in generated locales.
- [On-device prompt](ON-DEVICE-PROMPT.md) — what Gemini Nano measurably does
  with a rule prompt. Read before changing the prompts, schemas, or guardrails:
  what governs this model is measured here, not guessed.
- [Fuzzing](FUZZING.md) — running and replaying the bounded property suite, and
  the campaign record.

## Reviewing

- [Security and privacy reviews](SECURITY-PRIVACY-REVIEWS.md) — the
  client-extension threat model, severity calibration, and the fix-versus-accept
  analysis a finding needs. Read it before scanning.

## Releasing

- [Release workflow](RELEASE.md) — build artifacts, store upload, provenance,
  and the browser-owned checks. On-demand; ordinary development does not need it.
- [Store descriptions](STORE-DESCRIPTIONS.md) — the canonical AMO and Chrome Web
  Store copy to paste at release.

## Project history and direction

- [Roadmap](ROADMAP.md) — what landed in 4.0.0, the one open evidence-gated
  decision, and the non-goals with the reason each was rejected: grammar cost, a
  design objection, or a missing WebExtension API. The place to look before
  reopening a recurring request.
- [V4 archaeology](V4-ARCHAEOLOGY.md) — a retrospective on the six-day MV3
  rewrite. A snapshot: its numbers are dated and drift with the branch.
- [Issue validation](issues-v4.md) — working notes for the unposted 4.0.0
  tracker sweep. Point-in-time and anchored to an older commit, not a contract.

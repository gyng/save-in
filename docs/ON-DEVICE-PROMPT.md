# The on-device rule assistant

The Prompt assistant turns a sentence ("save png into /dongs") into a draft
routing rule, using Chrome's built-in Gemini Nano through the Prompt API. It is
an explicit opt-in, it never reaches the network, and its output is an untrusted
draft: nothing is applied until the user presses Add.

This document records what the model does, measured, because none of it is
visible from the unit tests and re-deriving it costs a 4 GB download and an
afternoon. Read it before changing `buildRulePlanPrompt`, the response schemas,
or the guardrails.

## The one rule: structure is the instruction, prose is decoration

Everything that worked was structural. Everything the prompt merely *said*
failed, measured, three times:

| The prompt said | What actually decided the output |
| --- | --- |
| "never join clauses with commas" | the EBNF's commas — 0/4 |
| "fileExtensions must be exactly: png" | `required: ["folder"]` — it emitted `{"folder":"dongs","filename":""}` and stopped |
| "do not add behavior the user did not request" | nothing — no check enforced it, so a bad rule shipped with Add enabled |

Prefer a schema change to a sentence. A sentence is worth adding only where no
schema can carry the constraint.

## Why the model is asked for facts, not for rule text

The assistant used to ask the model to write the rule. Over 16 attempts it
produced **0 usable drafts**: it understood every request and could not spell the
grammar, imitating the EBNF reference it was shown (`sourcekind:pdf,
sourcekind:png, into: archive/:filename:` — EBNF joins symbols with commas).
Instructing it otherwise never worked; it has no other concrete syntax to copy.

The decisive datum: the JSON response layer never failed once in those 16
attempts — only the free text inside `{"rule": "..."}`. So the model now returns
a `RulePlan` under a response schema and `assembleRule` builds the text. Comma
splicing, unknown clause names, unanchored matchers and absolute destinations
all become impossible rather than repaired.

`assembleRule` returns null rather than dropping a field it cannot express:
every plan field *narrows* the rule, so silently ignoring one would route more
than the request asked for.

## The schema is built per request

`rulePlanConstraint(request)` is not a constant. Asked for "png" with the
category field on offer, the model answered `sourceKind: image` — true, and not
what was asked — leaving `fileExtensions` empty and every file-type request at
**0/5**. It cannot misuse a field it is not offered, so the field is withheld
when the request names a file type.

The same extraction that builds the schema also checks the draft, so the model is
never offered a field the review would then reject it for using. The critique's
`repairedPlan` gets the same per-request schema; sharing the full one re-added
the field the author was denied.

## An approval is an approval

The reviewer answered `accepted: true` and returned a `repairedPlan` naming the
**folder** as the site. Its repair is what it offers when it *declines*, and only
then — adopting the retyping of a rule it just approved can only lose. The same
applies to whitespace: agreement is decided on what the plans assemble to, not on
how the model typed them.

## The gate

Add is enabled only when the deterministic guardrails, the background `VALIDATE`
message, and the review all agree. The guardrails historically only asked whether
the rule did what was asked; they must also ask whether it does **only** that.
Two false accepts were found that way, and both are pinned by tests:

- asked for pdf and png, the model added `sourcekind: ^document$` — a rule that
  can never route a png — and Add was enabled;
- `pagedomain` and `sourcedomain` are both accepted for a named site, though they
  mean materially different things. Still unchecked.

A false accept is the worst failure this feature has. A false reject only annoys.

## Measuring

Nano is **stochastic**: the same prompt gives materially different output run to
run. One sample measures noise. Measure a rate over repeats in a single browser
session, and capture the model's raw output — a rate tells you *whether*, never
*why*. A flat rate once hid a correct fix whose output a second bug was eating.

The sanctioned run is `npm run review`, then `p`. See AGENTS.md for the
provisioned profile and runtime, which are required: without them ChromeML
reaches no device on WSL/WSLg and the model process crashes, while
`availability()` still answers "available".

A throwaway profile also reaches the model, provisioned entirely by
`--enable-features=AIPromptAPI,OptimizationGuideOnDeviceModel` plus that runtime,
which avoids touching the shared profile. Two costs: the download needs a real
user gesture (`create()` throws `NotAllowedError` otherwise — dispatch an input
event first), and the finished profile is ~4 GB, so delete it.

**Caveat.** A throwaway profile pulls a different model component than the
provisioned one (`2025.8.8.1141` vs `2025.8.21.1028`). Confirm any number you
intend to quote against the provisioned profile.

## Where it stands

Measured over 20 samples, 5 per request, on a throwaway profile: **19/20**, every
accepted rule faithful. The one shape it cannot express is anything outside a
plan field — no `css`, `capture`, `fetch`, `rename` templates, arbitrary regex,
or destination variables. A free-form fallback would restore the 0% path; add
plan *fields* instead, since those are checkable.

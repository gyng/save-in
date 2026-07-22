# Coverage policy

The unit and integration suite enforces 100% statements, branches, functions,
and lines across `src/`, with a small, explicit exclusion set carved out for
code whose real contract is a browser-owned effect rather than a return value.
`scripts/check-coverage-policy.js` also fixes the source coverage-ignore
ceiling at zero, so an ignored body cannot make those percentages appear
complete.

The authoritative exclusion list is the `coverage.exclude` array in
`config/vitest/base.mjs`; each entry there is covered by a comment explaining
why it is delegated to e2e instead of unit coverage — most carry their own,
and two ride on the comment for the entry immediately above them. As of this
writing it holds nine entries (two of them globs), falling into four justified
classes:

- Vendored code (`src/vendor/**`): not ours to cover.
- Rolldown bundle entries (`src/entries/**`) and the Chrome offscreen-document
  bootstrap (`src/offscreen/offscreen.ts`): thin composition/listener wiring
  exercised through the real extension lifecycle in the browser e2e suites.
- The test-only e2e control surface (`src/background/e2e-command.ts`):
  imported exclusively by the e2e background entry, not shipped production
  behavior.
- Five options composition roots (`src/options/core/options.ts`,
  `routing-preview-panel.ts`, `menu-preview.ts`, `manual-editor-actions.ts`,
  `browser-capability-ui.ts`) that compose live DOM from many
  `document.querySelector` reads and a background message round trip;
  re-driving that page shape and message contract through unit-level DOM
  assertions would be brittle rather than exercising real behavior, so they
  are covered end to end by the e2e suites instead. Deterministic pieces split
  out alongside them (e.g. `option-field-sync.ts`, `download-refresh.ts`,
  `ui/disclosure-help.ts`) stay in unit coverage.

Adding an entry to that list is a policy decision, not a convenience: it needs
the same class of justification as the existing entries, plus the comment that
records it.

Do not add `v8 ignore` markers to production source. Exercise real error and
fallback behavior through the cheapest durable boundary. When a branch is
provably unreachable, express that invariant in its type or structure instead
of retaining dead defensive code. Composition scaffolds should reuse an
existing or native function rather than manufacture an uncallable placeholder
body.

Browser-owned operations still need an injectable port so tests can verify the
extension's sequencing and response. If the default implementation merely
delegates to a native function, bind that function directly; this leaves no
extension-owned body to exclude. Browser e2e remains responsible for verifying
the browser-owned effect.

Changing the zero ceiling requires an explicit policy decision and an update to
this contract. It must never be done merely to satisfy a coverage threshold.

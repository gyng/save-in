# Test organization

Tests live under the directory that owns the behavior they verify. The main directories mirror
the production source areas; `contracts`, `tooling`, `integration`, `e2e`, `fuzz`, and `support`
cover repository-level concerns that do not belong to one runtime module.

File suffixes define how Vitest treats each file:

- `*.test.ts` is a runnable Vitest isolation and environment boundary.
- `*.cases.ts` registers tests through exactly one importing `*.test.ts` file. Use this to share an
  expensive jsdom environment or module graph within one feature.
- `*.fixture.ts` provides reusable setup and does not register tests.
- `*.contract.test.ts` protects a cross-module, markup, protocol, or compatibility contract.

Put `// @vitest-environment jsdom` on the runnable `*.test.ts` boundary, not its imported case
files. Keep feature-specific fixtures beside their tests; `support` is reserved for global Vitest
and WebExtension host setup.

The unit configuration discovers `test/**/*.test.ts` and excludes `integration`. Fuzz,
integration, and end-to-end tests use their dedicated configurations. Run
`npm run check:test-layout` after moving or adding test files.

## Coverage contract

`npm run test:coverage` holds statements, branches, functions, and lines at 100% for instrumented
application source. The label is intentionally narrower than “all shipped code”: vendored code,
bundle entry modules, the test-only E2E command, the offscreen bootstrap, and the Options
composition root are excluded because their behavior is exercised through staged browser E2E or
through the controllers they compose. The exact scope lives in `config/vitest/base.mjs`.

`npm run check:coverage-policy` prevents threshold drift and keeps an explicit ceiling on justified
V8 ignore directives. A lower ignore count must lower the ceiling in the same change; a new ignore
requires a nearby invariant rationale and an intentional budget review. Keep branch-covering tests
behavioral: assert each meaningful transition rather than only executing it for the counter.

The browser suites live under `e2e`. Each browser entry launches one disposable profile and
imports shared case-registration modules from `e2e/cases`; adding a case module must not add a
second browser launch. Every case gets a storage snapshot and resource scope. Local servers are
registered automatically, and the harness restores storage, tabs, download records, session
rules, notifications, and downloaded files after the case. Only lifecycle cases may explicitly
preserve a transition. Cleanup, restoration, and runtime reset share one browser transaction;
the Options page reloads lazily only when a case first drives it.

Cross-browser setup, cleanup, browser state, and event waits go through
`test/e2e/control-client.mjs`. It uses CDP `Runtime.callFunctionOn` on Chrome and BiDi
`script.callFunction` on Firefox, passing values as structured arguments to a fixed dispatcher in
the Options page. `test/e2e/control-protocol.d.mts` defines the request/result relationship, so
operation names and returned downloads, logs, tabs, rules, history, and capability data remain
strictly checked at their call sites and decoded again when they cross the browser boundary.
Runtime commands then cross the real `runtime.sendMessage` boundary and wake the background
normally. Stored option inputs and normalized runtime option results have separate protocol types,
with compile-only contracts against the production schema. Raw evaluators return `unknown`:
structured JSON uses `evaluateJson` or `parseJson` with a runtime decoder, and reusable scalar
results use the matching scalar decoder. Direct comparison is reserved for DOM-local boolean or
string observations whose comparison itself narrows the value. `npm run check:e2e-harness`
enforces declining ceilings on the remaining raw background evaluations; lower the relevant
ceiling whenever one is migrated.

## E2E performance policy

Keep the suite fast by limiting deterministic work rather than weakening assertions:

- Subscribe to an in-browser event, observer, or storage change before triggering the action.
  Do not add fixed sleeps or repeated runner-side CDP/RDP polling when such a signal exists.
- Use `waitForPageCondition` for DOM, focus, or input-driven transitions that need a raw page
  assertion. It installs one in-page observer and uses one protocol evaluation. Runner polling is
  reserved for navigation/target startup, worker-only state, and filesystem completion, and its
  per-file ceilings may only decline.
- Use the structured control client for serializable setup, state, and browser API operations. Raw
  evaluation is an escape hatch for page-local DOM behavior or a protocol lifecycle that the
  control client cannot express; it must not be used merely to avoid adding a typed operation.
- Reuse the shared harness helpers and per-run browser/server resources. A case starts another
  server, reloads Options, or restarts a browser/background only when that transition is the
  behavior under test; explain the cost in a nearby comment.
- Ordinary cases should normally finish within two seconds. Lifecycle and real-network cases may
  be slower when their user-visible timing is part of the contract.
- Compare repeated per-case measurements when a change adds more than 25%. An increase above 50%
  and at least two seconds requires a fix or a reviewable explanation. Prefer operation counts
  such as protocol evaluations, reloads, and polling iterations over noisy wall-clock results.
- Stable scheduled runs may enforce total budgets of 22 seconds for Chrome and 32 seconds for
  Firefox. On shared PR runners, these totals are advisory; deterministic operation budgets are
  the acceptance signal. Until operation-count reporting is automated, reviewers enforce them
  from the diff and focused timings.
- Change a baseline or ceiling only with measured before/after evidence. Do not raise one, weaken
  assertions, or enable retries merely to make a performance regression pass.

All browser commands use the same immutable per-run staged extension and diagnostics directory:

- `npm run e2e` runs Chrome and Firefox in parallel.
- `npm run e2e:serial` runs both browsers sequentially.
- `npm run e2e:chrome` and `npm run e2e:firefox` select one browser.
- Add `-- -t "name"` to select cases. Set `E2E_RETRY=1` to retry a failed suite in a fresh
  browser (and record the flake), or pass `-- --retry=1` for an explicit in-process case retry.
- Use the corresponding `:headed` command for an interactive run.

## Memory profiling

`npm run test:memory` runs isolated, forced-GC heap comparisons for repeated Page Sources and
resource-timing workloads. It gates retained-shape ratios and writes the complete per-process
samples to `dist/memory-profile.json`; elapsed time and uncollected heap are diagnostic only. The
release-facing `npm run test:all` command includes this retained-shape gate.
`npm run bench:memory` records the same report without enforcing ratio ceilings. `npm run e2e:rss`
keeps separate browser-level History ceilings for retained cold first-use allocation and maximum
warmed drawup, then writes baseline, peak, final, and every RSS sample to a distinct
`memory-history-<browser>-attempt-<number>.json` artifact for each suite attempt.

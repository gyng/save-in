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

The browser suites live under `e2e`. Each browser entry launches one disposable profile and
imports shared case-registration modules from `e2e/cases`; adding a case module must not add a
second browser launch. Every case gets a storage snapshot and resource scope. Local servers are
registered automatically, and the harness restores storage, tabs, download records, session
rules, notifications, and downloaded files after the case. Only lifecycle cases may explicitly
preserve a transition. Cleanup, restoration, and runtime reset share one browser transaction;
the Options page reloads lazily only when a case first drives it.

## E2E performance policy

Keep the suite fast by limiting deterministic work rather than weakening assertions:

- Subscribe to an in-browser event, observer, or storage change before triggering the action.
  Do not add fixed sleeps or repeated runner-side CDP/RDP polling when such a signal exists.
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
- Add `-- -t "name"` to select cases, or set `E2E_RETRY=1` for an explicit diagnostic retry.
- Use the corresponding `:headed` command for an interactive run.

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
preserve a transition.

All browser commands use the same immutable per-run staged extension and diagnostics directory:

- `npm run e2e` runs Chrome and Firefox in parallel.
- `npm run e2e:serial` runs both browsers sequentially.
- `npm run e2e:chrome` and `npm run e2e:firefox` select one browser.
- Add `-- -t "name"` to select cases, or set `E2E_RETRY=1` for an explicit diagnostic retry.
- Use the corresponding `:headed` command for an interactive run.

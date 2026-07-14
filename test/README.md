# Test organization

Tests live under the directory that owns the behavior they verify. The main directories mirror
the production source areas; `contracts`, `tooling`, `integration`, `fuzz`, and `support` cover
repository-level concerns that do not belong to one runtime module.

File suffixes define how Vitest treats each file:

- `*.test.ts` is a runnable Vitest isolation and environment boundary.
- `*.cases.ts` registers tests through exactly one importing `*.test.ts` file. Use this to share an
  expensive jsdom environment or module graph within one feature.
- `*.fixture.ts` provides reusable setup and does not register tests.
- `*.contract.test.ts` protects a cross-module, markup, protocol, or compatibility contract.

Put `// @vitest-environment jsdom` on the runnable `*.test.ts` boundary, not its imported case
files. Keep feature-specific fixtures beside their tests; `support` is reserved for global Vitest
and WebExtension host setup.

The unit configuration discovers `test/**/*.test.ts` and excludes `integration`. Fuzz and
integration tests use their dedicated configurations. Run `npm run check:test-layout` after moving
or adding test files.

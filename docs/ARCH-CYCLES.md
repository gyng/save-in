# Module-boundary record

The original TypeScript migration exposed a ten-module background dependency
cycle. That cycle and its follow-on migration backlog are complete. This file
keeps the resulting architectural constraints without retaining the obsolete
task-by-task implementation diary.

## Current dependency direction

```text
entries/options/content
        ↓
background + downloads + config + routing
        ↓
platform
        ↓
shared + vendor
```

More specific rules enforced by `scripts/check-import-cycles.js`:

- options contexts communicate with the background through messages, never by
  importing background implementations;
- config owns schemas, normalization, and stored option values;
- routing depends on shared contracts and injected ports, not download or
  background implementations;
- downloads do not import background implementations;
- platform and shared modules only point down the runtime stack;
- dynamic imports are forbidden in production source;
- browser-listener and composition-call ownership is explicitly allowlisted.

## State ownership

- `menuState` owns mutable menu data.
- `downloadsState`, `sessionWriteState`, `counterWriteState`, and
  `configWriteState` are explicit data records composed by
  `src/background/state.ts`.
- `backgroundRuntime` owns initialization and the latest routed-download state.
- Persisted MV3 state crosses worker wakeups through storage normalization
  boundaries rather than module globals.

## Execution boundaries

- Background listener registration is synchronous; handlers await readiness.
- Content, options, offscreen, and background contexts share only protocol and
  persistence types.
- Test-only browser control is installed exclusively by the e2e background
  entry and is rejected from production packages by the staging verifier.
- Unit tests use Vitest-native mocks and typed host builders rather than
  publishing source dependencies as globals.

The current module graph is acyclic and checked by `npm run lint`. Historical
planning and feature prioritization remain in `docs/ROADMAP.md`.

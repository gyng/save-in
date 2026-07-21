# Browser E2E harness

The Chrome and Firefox suites exercise the staged, bundled extension in fresh
browser profiles. They are lifecycle tests as much as feature tests: Chrome
runs an MV3 service worker, while Firefox runs a non-persistent event page.
This document is the contract for keeping those suites deterministic, fast,
and safe to retry.

## The dedicated control plane

Serializable browser setup, state inspection, and waits go through
`test/e2e/control.html`. It is an e2e-only extension page: production Options
does not host test APIs, and Options reload tests cannot destroy the suite's
control channel.

Each browser keeps one persistent connection to that page for the suite:

- Chrome caches its CDP target and execution context.
- Firefox caches its WebDriver BiDi browsing context. Its lifecycle is tracked
  as `missing` → `starting` → `ready` → `stale` from BiDi context events.
- Firefox RDP remains the add-on installation and background-console channel.
  Reloading the event page replaces that console actor, so the launcher must
  reconnect and resolve the new actor before another RDP background command.

Control-page readiness means that the page dispatcher is installed. Background
readiness has a separate, explicit generation acknowledgement: option writes
send `OPTIONS_LOADED`, remember its instance ID and generation, and reject a
non-advancing acknowledgement from the same instance. Background lifecycle
inspection also exposes the current and ready generations; after a deliberate
reload, the harness accepts only a new instance whose generations match. E2E
download commands can carry an expected generation when a caller needs the
same guard. These checks prevent initialization work from an old event page or
service worker from overtaking a newer command.

Do not rediscover a target for every operation. In the ordinary case, one
structured control request should mean one protocol evaluation. Recreate the
page only after the persistent target or realm is proven missing or stale.

## Retry safety

Every control request carries a client-scoped request ID and is classified at
the operation boundary:

- **Read** operations may be repeated.
- **Idempotent** mutations may be repeated after recreating the control page.
- **One-shot** mutations may be repeated only when the same realm is still
  alive and therefore still owns the request-ID deduplication record.

A lost one-shot reply is not permission to recreate the page and issue the
mutation again. If the original realm disappears, fail the case; the operation
may already have completed and the new realm has no record with which to
deduplicate it.

Browser death, or a control plane that cannot be recreated, is terminal for
that suite attempt. Abort the remaining cases instead of running them against
a damaged browser. CI records the failed attempt and may start one whole-suite
retry in a fresh browser with `E2E_RETRY=1`. That retry is a final
browser-launch/lifecycle backstop, not a case-level retry and not a way to hide
timing regressions.

## Tabs, page-local work, and waits

Use the structured control client for serializable browser operations such as
creating a tab, selecting it, reading storage, or waiting for a download. For
example, create a Chrome fixture tab through `control.tabs.create`, then await
`control.tabs.wait` before attaching page-local CDP evaluation. A newly created
CDP target can exist before a one-shot `tabs.query` snapshot sees the browser
tab; the structured wait closes that race.

Direct CDP, RDP, or BiDi evaluation is reserved for page-local DOM behavior,
trusted input, and lifecycle diagnostics. Keep waits in the browser and driven
by the event that changes the state: a storage listener, browser event,
`MutationObserver`, or page-local task-queue barrier. Do not replace those with
fixed sleeps or repeated runner-side target polling.

`tabs.wait` acknowledges browser load state, not content-script initialization.
Before dispatching a page-owned gesture or event whose listener depends on
stored options, call `control.tabs.waitContentReady(tabId)`. The e2e content
bundle keeps that single message channel open until its initial storage read is
applied; an already-ready tab answers immediately. The handshake is compiled
out of the production content bundle.

## Browser RSS measurement

The History memory case reports both the complete browser process tree and the
stable process cohort present at the start of each workload.

Late renderer, utility, or GPU processes are valid browser lifecycle churn.
Their RSS remains visible in whole-tree telemetry, but it must not impersonate
retained History state. The steady-state gate therefore uses the baseline
cohort's **retained draw-up**: final RSS minus the lowest sampled RSS. The
maximum whole-tree draw-up is still recorded for diagnosis. Cold-start growth
has its own retained-growth ceiling because initial storage fan-out can reserve
and later release substantially more memory, especially on Firefox.

Do not raise a memory ceiling merely because a late process appeared. First
inspect the artifact's process counts, whole-tree samples, stable-cohort
samples, and final retained values. A real extension leak remains in processes
that were already present when the workload began.

## Running stress campaigns

The normal commands are:

```sh
npm run e2e
npm run e2e:chrome
npm run e2e:firefox
npm run e2e:serial
```

CI uses serial browser suites on a two-vCPU GitHub runner and allows one fresh
whole-suite retry. When hunting flakes locally, unset that retry so the first
failure remains visible. On Linux with systemd, this approximates the CI CPU
and memory envelope:

```sh
systemd-run --user --scope \
  -p CPUQuota=200% -p MemoryMax=7G \
  taskset -c 0,1 \
  env -u E2E_RETRY CI=1 HEADLESS=1 npm run e2e:serial
```

Repeat fresh suites rather than repeating cases in one increasingly polluted
browser. A focused campaign should still launch a fresh browser each round:

```sh
systemd-run --user --scope \
  -p CPUQuota=200% -p MemoryMax=7G \
  taskset -c 0,1 bash -lc '
    set -e
    for round in $(seq 1 10); do
      env -u E2E_RETRY CI=1 HEADLESS=1 \
        npm run e2e:chrome -- --test-name "Page Sources discovers"
    done
  '
```

Use the relevant browser command and test-name substring for the case under
investigation. After a constrained run, inspect the scope's `memory.events`
and `memory.peak` as well as the test artifacts. A failure with zero
`memory.high`, `memory.max`, and OOM events is not evidence of memory pressure.

## Artifacts and performance review

Every run owns a directory under `dist/e2e-artifacts/run-*`. Start with:

- `run.json` for terminal status, attempts, exit codes, and total duration;
- `timings-chrome.json` or `timings-firefox.json` for setup and per-case work;
- `memory-history-*.json` for whole-tree and stable-cohort RSS samples;
- browser logs and `*-failure-*.json` for target, storage, history, and
  background diagnostics.

Review deterministic work before wall time: structured protocol evaluations,
page reloads, polling iterations, and browser/server lifetimes. Compare timing
artifacts with `npm run e2e:compare`; shared CI timings are advisory, while an
enforced regression needs repeated measurements on a stable runner.

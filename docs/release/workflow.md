# Release workflow reference

This is on-demand guidance for release preparation and release-tooling changes.
Ordinary development tasks do not need it.

## Local release artifacts

`npm run build` creates the shared Manifest V3 runtime ZIP in
`web-ext-artifacts` for both stores. `npm run build:source` creates the
reproducible source ZIP required for the AMO submission.

## Store upload

Run the release gates in `AGENTS.md`, then upload the same reviewed runtime ZIP
to AMO and the Chrome Web Store. Attach the source ZIP to the AMO submission.
Use the [store descriptions](../store/descriptions.md) as the canonical English
listing copy and store-facing release note; update its version and review date
for each release.
Keep store data-use answers aligned with `PRIVACY.md`: Save In processes website
content and browsing activity locally for direct saves, explicitly configured
automatic saves, and history; sends neither to the developer; and executes no
remote code.
When WebMCP is available, disclose that a compatible in-browser agent can read
the complete saved configuration and invoke Save In tools only while Options is
open. Save In adds no separate consent prompt; the browser or agent controls
access, confirmation, and its handling of returned data.

Chrome's listing should disclose that Incognito activity is excluded from Save
In history and diagnostics, while Chrome may show an Incognito save in its
regular download manager because the downloads API cannot select an Incognito
context. These terse rationales are the source of truth; the full paste-ready
justifications for the Chrome privacy-practices tab, plus the single-purpose
text, live in [store/permission-justifications.md](../store/permission-justifications.md).
Use these permission rationales:

- `contextMenus`: show Save In commands on pages, and on tabs where the browser
  offers a tab-strip menu (Firefox, and Chrome 150+).
- `declarativeNetRequestWithHostAccess`: attach the containing page as the
  Referer only while Save In fetches requested metadata or content for a
  matching user-selected resource.
- `downloads`: start, name, monitor, retry, and record downloads locally.
- `notifications`: report completion and actionable failures.
- `storage`: store settings, rules, local history, and recovery state.
- `offscreen`: lend the Chrome service worker a document, which has no DOM of
  its own. It creates the temporary Blob URL a fetched download is handed to
  Chrome as, hashes those same bytes for the SHA-256 variables, and runs the
  on-device rule assistant's prompts, because Chrome's Prompt API requires a
  responsible document and refuses to run in a worker. Name all three: a
  justification that omits the model is the one a re-review finds.
- `<all_urls>`: identify and fetch user-selected resources on arbitrary sites.

Firefox additionally declares `data_collection_permissions`. `required` is
`none` — Save In collects nothing to function. The three `optional` entries are
requested only from the user action that enables webhooks, and only for the
fields that user chose, because a webhook is the one feature that sends anything
off the device:

- `browsingActivity`: a webhook payload names the resource URL the save was for,
  and, where the user chose it, the containing page URL.
- `websiteActivity`: a webhook payload reports that a save happened and what
  became of it — the event, the download id, and the folder path it landed in.
- `websiteContent`: requested only for the optional page-title and selected-text
  fields, which are page content the user opted to include.

Before upload, confirm listing metadata, support/privacy links, screenshots,
permission justifications, and data-use answers are current.

## GitHub release provenance

Create a `vX.Y.Z` tag only after `package.json` and `manifest.json` both contain
`X.Y.Z`, and drop the `(unreleased)` marker from that version's CHANGELOG
heading in the same commit — the tag is what makes the version real, so nothing
else records that a written-up version has not shipped yet. A tag push runs
`.github/workflows/release.yml`, which:

1. validates the tag against both manifests;
2. runs coverage, typecheck, lint, and serial Chrome/Firefox e2e;
3. builds reproducible runtime and AMO source ZIPs;
4. signs the Chromium sideload CRX, when `CRX_PRIVATE_KEY` is set;
5. copies them to stable `save-in-X.Y.Z*` names and writes `SHA256SUMS`;
6. creates GitHub provenance attestations; and
7. creates or updates a draft GitHub Release with those assets.

Inspect the draft before publishing it. A rerun may replace assets while the
release remains a draft; the workflow refuses to modify a published release.
Upload the reviewed draft artifacts to the stores manually.

A manual `workflow_dispatch` validates and builds the current package version
but does not attest files or create a draft release. Its artifacts remain
available from the workflow run.

Verify a downloaded runtime asset with:

```sh
gh attestation verify save-in-X.Y.Z.zip -R gyng/save-in
```

Protect `v*` with a GitHub tag ruleset so only maintainers can create or delete
release tags. Release actions are pinned to immutable commits; update those
pins deliberately during workflow maintenance.

## The Chromium sideload key

`scripts/pack-crx.js` prepends a CRX3 signature header to the runtime ZIP, so
the packaged and reviewed bytes stay identical — strip the header and the
remainder is `save-in-X.Y.Z.zip`. It reads the PEM from `CRX_PRIVATE_KEY` into
memory and never writes it to disk, and does nothing when the variable is
absent, so ordinary builds need no key.

**This key is permanent.** A Chromium extension's ID is the hash of its signing
key, and browsers store an extension's settings against its ID. Signing a later
release with a different key therefore does not update the installed extension:
it installs a second one, and the first user's rules, history, and options stay
stranded in an extension nothing will ever open again. There is no migration
and no recovery. Losing the key ends the sideload channel permanently.

The key is not a store credential and grants no authority over the published
extension. It only names the sideload build. Treat it as unrecoverable rather
than as high-value: back it up somewhere durable and offline.

Generate it once, off CI, and keep it out of the working tree:

```sh
openssl genrsa -out ~/save-in-crx.pem 2048   # back this up, then:
gh secret set CRX_PRIVATE_KEY -R gyng/save-in < ~/save-in-crx.pem
```

Print the ID it will produce, which the README documents and users see in
Options:

```sh
CRX_PRIVATE_KEY="$(cat ~/save-in-crx.pem)" node scripts/pack-crx.js 4.0.0
```

Only a tag push signs. `workflow_dispatch` skips the step, so a manual build
cannot mint a signed package. Harden the secret further by moving it to a
GitHub Environment restricted to `v*` tags and adding the `environment:` key to
the release job, which also makes signing an approvable step.

## Browser-owned surface checks

E2E covers the bundled extension, downloads, routing, notifications, options
keyboard/layout behavior, Page Sources discovery and manual saves, toolbar
activation, History cancellation, external-extension authorization, webhook
delivery, private-window isolation, and both background lifecycles. CDP and
Firefox RDP still cannot reliably select browser context-menu items, operate
native Save As windows, or invoke OS notification actions. Before publishing,
manually check current Chrome and Firefox:

1. Save an image and link from the context menu; verify the destination and
   Last used location.
2. Test every Save As condition, accepting and cancelling the native picker.
3. Test success and failure notifications, including opening the related
   browser download.
4. Revoke site access; verify the permission banner and disabled click-to-save.
   Restore access and verify recovery.
5. Check options and Page Sources at normal and narrow widths in System, Dark,
   and Light modes, including focus indicators and a forced theme opposite the
   operating-system preference.
6. Add and enable a guarded automatic-source rule on the review demo page.
   Verify initial and late-discovered matches use its destination, the per-page
   limit stops additional saves, and a broad ordinary rule does not trigger.
7. Create the same destination symlink inside each browser's download folder.
   Verify Firefox reaches the target and Chrome reports a failed download
   without writing outside its download folder.
8. Spot-check the automated private-window contract in Chrome Incognito and
   Firefox Private Browsing: perform a Save In download and an ordinary browser
   download. Verify neither enters Save In history or the debug log, and the
   browser-owned filename remains unchanged.

For a final spot-check, verify Referer behavior in both browsers on a site that
requires it, such as a pixiv media download, and open options-page dialogs that
e2e cannot exercise reliably. In both browsers, confirm protected metadata/hash
variables resolve, the file completes, and the temporary session rule is removed.

## Browser run telemetry

Every CI browser run uploads compact `timings-chrome.json` and
`timings-firefox.json` reports. They include setup phases and individual case
durations for the advisory regression thresholds in `AGENTS.md`; shared PR
runners do not enforce wall-clock limits. Pull-request CI compares each case
with the corresponding current- and minimum-browser artifact from the latest
successful master run and emits annotations above the 25% advisory threshold.
CI runs the suites once with the
host's current browsers and once with the declared minimum Chrome 123 and
Firefox 140 releases. Those exact archives are SHA-256 verified before
execution. The same artifact includes each browser's `*-environment.json`, and
timing reports embed the browser version. Comparisons skip a browser when its
version changed instead of presenting cross-version noise as a test regression.
Compare two downloaded run directories with:

```sh
npm run e2e:compare -- --baseline path/to/baseline --current path/to/current
```

The command reports increases above 25%. Add `--enforce` only on a stable,
repeatable runner; it fails increases above 50% that also add at least two
seconds. Timing reports aggregate every module for a browser, normalize module
paths across machines, and identify cases by browser, module, and test name.
Each artifact's `run.json` records terminal status, total duration, browser
suite exit codes, interruption signals, and staging or cleanup failure details;
an artifact with only startup metadata is an interrupted legacy run.

After every case, the harness aborts worker-local transfers, drains pending
state writes, clears browser downloads, tabs, notifications, DNR rules,
offscreen documents, and session storage, restores the local-storage baseline,
then verifies that no unexpected state survived. Cleanup failures capture the
same browser diagnostics as assertion failures before the suite exits.
Profile cleanup is scoped to the exact current run ID. A later run must not
infer ownership from PID liveness because sandbox PID namespaces can hide a
concurrent browser that is still using its profile. Run IDs include a random
nonce in addition to the PID and start time, and the same ID owns the staged
extension, browser profiles, artifact directory, and active marker. This keeps
concurrent runs isolated even when separate PID namespaces expose the same PID.
Shared build locks are bounded 30-minute leases, debug-port reservations use a
60-second pre-bind grace period, and active run ownership expires after 24
hours. A later run can therefore recover resources left by a hard-killed run
without using namespace-local PID liveness or touching an ordinary concurrent
run.

## Failed browser runs

CI uploads `dist/e2e-artifacts` when a browser suite fails. It contains browser
logs and JSON snapshots of targets, storage, history, debug logs, and the
options DOM. Chrome also attempts a screenshot of the current page.

## Chrome Web Store screenshots

Generate listing screenshots from the real bundled extension with:

```sh
npm run screenshots:store
```

The command launches isolated headless Chrome, seeds the review configuration,
and writes five 1280×800 PNGs to `docs/store/screenshots/` in listing order:

- `01-right-click-save.png`: the Save In context menu over a demo-page image,
  showing the right-click save gesture;
- `02-page-sources.png`: Page Sources docked open on the in-repo demo page;
- `03-downloads-menu.png`: configured directories with the live context-menu
  preview;
- `04-routing-rules.png`: routing and renaming rules; and
- `05-browser-downloads.png`: tracking and routing ordinary browser downloads
  with a match-pattern filter.

It losslessly recompresses each PNG and validates its dimensions. To use another
destination:

```sh
npm run screenshots:store -- --output-dir <path>
```

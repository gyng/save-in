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
Use the [store descriptions](STORE-DESCRIPTIONS.md) as the canonical English
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
context. Use these permission rationales:

- `contextMenus`: show Save In commands on pages and tabs.
- `declarativeNetRequestWithHostAccess`: attach the containing page as the
  Referer only while Save In fetches requested metadata or content for a
  matching user-selected resource.
- `downloads`: start, name, monitor, retry, and record downloads locally.
- `notifications`: report completion and actionable failures.
- `storage`: store settings, rules, local history, and recovery state.
- `offscreen`: create temporary Blob URLs for Chrome downloads.
- `<all_urls>`: identify and fetch user-selected resources on arbitrary sites.

Before upload, confirm listing metadata, support/privacy links, screenshots,
permission justifications, and data-use answers are current.

## GitHub release provenance

Create a `vX.Y.Z` tag only after `package.json` and `manifest.json` both contain
`X.Y.Z`. A tag push runs `.github/workflows/release.yml`, which:

1. validates the tag against both manifests;
2. runs coverage, typecheck, lint, and serial Chrome/Firefox e2e;
3. builds reproducible runtime and AMO source ZIPs;
4. copies them to stable `save-in-X.Y.Z*.zip` names and writes `SHA256SUMS`;
5. creates GitHub provenance attestations; and
6. creates or updates a draft GitHub Release with those assets.

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

## Browser-owned surface checks

E2E covers the bundled extension, downloads, routing, notifications, options
keyboard/layout behavior, Page Sources, and Chrome service-worker restarts.
CDP and Firefox RDP cannot reliably operate browser context menus, native Save
As windows, or OS notification actions. Before publishing, manually check
current Chrome and Firefox:

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
8. In Chrome Incognito and Firefox Private Browsing, perform a Save In download
   and an ordinary browser download. Verify neither enters Save In history or
   the debug log, and ordinary-download routing does not rename the private
   browser download.

For a final spot-check, verify Referer behavior in both browsers on a site that
requires it, such as a pixiv media download, and open options-page dialogs that
e2e cannot exercise reliably. In both browsers, confirm protected metadata/hash
variables resolve, the file completes, and the temporary session rule is removed.

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
and writes five 1280×800 PNGs to `docs/store-screenshots/` in listing order:

- `01-downloads-menu.png`: configured directories with the live context-menu
  preview;
- `02-routing-rules.png`: routing and renaming rules;
- `03-page-sources.png`: Page Sources on the in-repo demo page;
- `04-history.png`: searchable history with representative routed downloads;
  and
- `05-rule-debugger.png`: the route debugger explaining a matching rule and
  final filename.

It losslessly recompresses each PNG and validates its dimensions. To use another
destination:

```sh
npm run screenshots:store -- --output-dir <path>
```

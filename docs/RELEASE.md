# Release workflow reference

This is on-demand guidance for release preparation and release-tooling changes.
Ordinary development tasks do not need it. Store form answers and required
uploads remain in `docs/STORE-SUBMISSION.md`.

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
6. In Chrome Incognito and Firefox Private Browsing, perform a Save In download
   and an ordinary browser download. Verify neither enters Save In history or
   the debug log, and ordinary-download routing does not rename the private
   browser download.

For a final spot-check, also verify Firefox Referer behavior on a site that
requires it, such as a pixiv media download, and open options-page dialogs that
e2e cannot exercise reliably.

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
and writes four 1280×800 PNGs to `docs/store-screenshots/`:

- configured directories with the live context-menu preview;
- routing and renaming rules;
- Page Sources on the in-repo demo page; and
- searchable history with representative routed downloads.

It losslessly recompresses each PNG and validates its dimensions. To use another
destination:

```sh
npm run screenshots:store -- --output-dir <path>
```

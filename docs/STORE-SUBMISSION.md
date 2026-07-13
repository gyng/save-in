# Store submission notes

Save In uses one Manifest V3 package for Firefox and Chrome. It requires Node
24 and the dependencies pinned by `package-lock.json`, with no Docker image or
additional system dependency. Build it with:

```sh
npm ci
npm test
npm run lint
npm run typecheck
npm run e2e
npm run build
```

The runtime ZIP is written to `web-ext-artifacts/`. Upload that same ZIP
manually to AMO and the Chrome Web Store. Both browsers use
`incognito: spanning`.

## Mozilla source submission

Run `npm run build:source` and upload the resulting `*-source.zip` as the AMO
source-code attachment. It contains the TypeScript source, lockfile, build
configuration, scripts, types, tests, and the generated `version.json` used by
the submitted runtime package. A reviewer can reproduce the runtime package
from the extracted source archive with:

```sh
npm ci
npm run build
```

Rolldown transpiles and scope-hoists the TypeScript into readable,
non-minified JavaScript. No obfuscation or remote executable code is used.

## Reviewer implementation notes

- Firefox uses `background.scripts: ["background.js"]`; Chrome uses
  `background.service_worker: "background.sw.js"`. Each browser ignores the
  other background declaration.
- `offscreen` is Chrome-only. It creates an extension offscreen document so a
  service worker can convert a fetched Blob to a temporary object URL.
- Firefox can attach a Referer to a user-requested download through its native
  downloads API. Chrome does not expose an equivalent supported mechanism; no
  request-interception permission is requested.
- Extension-side Fetch and HEAD requests include applicable website cookies and
  browser-managed authentication by default for user-requested saves, matching
  normal authenticated downloads. Users can turn this off to make those
  extension requests anonymous.
- No cookie API permission is requested. Unless the user disables authenticated
  extension requests, the browser attaches applicable credentials; Save In never
  reads cookie values. Extension Fetch cannot select a Firefox Container or
  private cookie store.
- `<all_urls>` is required because the extension saves resources selected by
  the user from arbitrary websites, optionally reads content metadata, and can
  run its click-to-save content listener on those pages.
- Page Sources is a user-opened, DOM-only drawer implemented by that content
  script. It reads media attributes, computed CSS backgrounds, and the page's
  Resource Timing buffer for best-effort HLS/DASH manifest discovery. It does
  not intercept browsing traffic and does not request `webRequest`. Copying a
  `yt-dlp` command only writes text to the clipboard; Save In never executes it.
- The extension makes no analytics or developer-server requests. Resource
  fetches go only to URLs involved in a user-requested save.
- Chrome Incognito and Firefox Private Browsing activity is excluded from local
  history, restart-recovery storage, and the extension debug log. Private saves
  use memory-only transient state.
- Chrome's downloads API cannot select an Incognito context. A Save In download
  requested from Chrome Incognito may therefore appear in Chrome's regular
  download manager even though Save In does not retain it in extension history.
  Firefox associates the download with its Private Browsing session.
- The external extension API accepts validated save requests from other
  installed extensions. It does not expose user configuration mutation to
  external callers and does not execute received code.

## Chrome Web Store privacy fields

Use this single-purpose statement:

> Save user-selected web resources into configurable download subdirectories,
> with local routing, renaming, status, retry, and download history features.

Declare handling of website content and web browsing activity. Explain that it
is processed and stored locally only for user-requested saving and history, and
is not transmitted to the developer. Select **No** for remote code. Use the
public repository copy of `PRIVACY.md` as the privacy-policy URL.

The Chrome listing and privacy answers must also disclose:

> Save In excludes Incognito activity from its own history and diagnostic log.
> Because Chrome's extension downloads API has no Incognito selector, a
> Save In download requested from an Incognito tab may appear in Chrome's
> regular download manager.

Permission justifications:

- `contextMenus`: provides the primary Save In command on pages and tabs.
- `downloads`: starts downloads, determines filenames, monitors completion,
  and supports retry and local history actions.
- `notifications`: reports completed downloads and actionable failures.
- `storage`: stores settings, routing rules, local history, and MV3 restart
  state.
- `offscreen`: provides Chrome's service worker with temporary Blob URL
  conversion for downloads.
- `<all_urls>`: identifies and fetches resources explicitly selected by the
  user on arbitrary websites, including resources requiring the user's
  existing session.

Before submitting, verify that the listing has an accurate description,
category, icon, screenshots, support link, privacy-policy link, and the same
data-use answers as `PRIVACY.md`.

The listing and in-product Advanced downloading copy must disclose that
extension requests include applicable site credentials by default and that
users can turn this off.

## GitHub release provenance

Push a `vX.Y.Z` tag only after `package.json` and `manifest.json` both contain
`X.Y.Z`. The release workflow:

1. validates the tag against both manifests;
2. runs unit tests, typecheck, lint, and the serial Chrome and Firefox e2e
   suites;
3. derives `SOURCE_COMMIT` and `SOURCE_DATE` from the tagged commit;
4. builds the runtime and AMO source ZIPs;
5. copies them to stable `save-in-X.Y.Z*.zip` names and writes `SHA256SUMS`;
6. creates GitHub provenance attestations for the runtime and source files; and
7. creates a draft GitHub Release with those assets.

Inspect the draft and publish it manually. A rerun may replace assets while the
release remains a draft, but the workflow refuses to modify an already
published release. Store uploads remain manual and use the files from the
reviewed draft. Consumers can verify an asset with:

```sh
gh attestation verify save-in-X.Y.Z.zip -R gyng/save-in
```

Configure a GitHub tag ruleset for `v*` so only maintainers can create or
delete release tags. The workflow checks that the tag exists and matches both
manifests; repository rules protect who may create or move it. Release actions
are pinned to immutable commits and should be updated deliberately during
normal workflow maintenance.

## Browser-owned surface checks

The parallel E2E suites cover the bundled extension, downloads, routing,
notifications, options-page keyboard/layout invariants, Page Sources, and
Chrome service-worker restarts. CDP and Firefox RDP cannot reliably inspect or
select browser-owned context menus, OS Save As windows, or operating-system
notification actions. Before publishing a store build, manually check these
surfaces in current Chrome and Firefox:

1. Right-click an image and a link, choose a configured Save In destination,
   and confirm the expected directory and Last used location behavior.
2. Enable each Save As prompt condition and confirm both accepting and
   cancelling the native picker leave the extension responsive.
3. Enable success and failure notifications, select a download notification,
   and confirm the browser reveals the corresponding download.
4. Revoke Save In's site access, confirm the options permission banner appears
   and click-to-save is unavailable, then grant access and confirm both recover.
5. Check the options page and Page Sources dock/popout at normal and narrow
   widths in light and dark system themes, including keyboard focus indicators.
6. In both a Chrome Incognito window and a Firefox Private Browsing window,
   perform a Save In download and an ordinary browser download, then confirm
   neither appears in Save In history or the debug log after returning to a
   normal window. Confirm ordinary-download routing does not alter the private
   download filename.

CI uploads `dist/e2e-artifacts` when a browser suite fails. The bundle contains
browser logs plus JSON snapshots of targets, storage, history, debug logs, and
the options DOM; Chrome also attempts a current-page screenshot.

## Chrome Web Store screenshots

Generate listing-ready screenshots from the real bundled extension with:

```sh
npm run screenshots:store
```

The command stages the E2E bundle, launches an isolated headless Chrome, seeds
the same representative configuration used by `npm run review`, and updates four
canonical 1280x800 PNGs in `docs/store-screenshots/`:

- configured directories with the live context-menu preview;
- pattern-based routing and renaming rules;
- Page Sources open on a realistic editorial page built around the in-repo demo photo;
- searchable download history with representative routed results.

Each PNG is recompressed losslessly, then its dimensions are validated before
the command succeeds. Pass a different destination when preparing an upload with
`npm run screenshots:store -- --output-dir <path>`.

## Chrome tab-strip context menus

Chrome 150 introduces the `"tab"` context, but Save In does not enable it on
Chrome yet. The extension supports Chrome 123+, the API has no portable
feature-test property, and the Chrome 150 rollout has a known crash when an
extension registers multiple tab-context items. Save In registers five such
items on Firefox. Keep the capability Firefox-only until Chromium fixes the
crash and a safe version/capability gate is available; then add Chrome e2e
coverage before enabling it.

# Store submission notes

Save In ships one Manifest V3 package for Firefox and Chrome. Building requires
Node 24 and the dependencies pinned in `package-lock.json`; no Docker image or
other system dependency is needed.

```sh
npm ci
npm test
npm run lint
npm run typecheck
npm run e2e
npm run build
```

Upload the runtime ZIP from `web-ext-artifacts/` to both AMO and the Chrome Web
Store. The shared manifest uses `incognito: spanning`.

## Mozilla source submission

Run `npm run build:source` and attach the resulting `*-source.zip` in AMO. It
contains the TypeScript source, lockfile, build files, scripts, types, and tests.
To reproduce the runtime ZIP after extraction:

```sh
npm ci
npm run build
```

Rolldown produces readable, non-minified JavaScript. There is no obfuscation or
remote executable code. Runtime and source ZIPs use sorted entries and fixed
timestamps, making identical source builds byte-for-byte reproducible.

## Reviewer implementation notes

- Firefox uses `background.scripts: ["background.js"]`; Chrome uses
  `background.service_worker: "background.sw.js"`. Each ignores the other key.
- Chrome alone uses an offscreen document to convert fetched Blobs into
  temporary object URLs for its service worker.
- Firefox can set a Referer through its downloads API. Chrome has no supported
  equivalent; Save In requests no interception permission.
- For non-private, user-requested saves, extension Fetch and HEAD requests use
  applicable browser-managed cookies and authentication by default. Users can
  make them anonymous. Save In has no cookie permission and never reads cookie
  values. Extension Fetch cannot select a Firefox Container or private cookie
  store, so private requests are always anonymous and some authenticated saves
  may fail.
- `<all_urls>` lets users save from arbitrary sites, read optional content
  metadata, and use click-to-save.
- Page Sources is a user-opened, DOM-only drawer. It reads media attributes,
  computed backgrounds, and Resource Timing entries for best-effort HLS/DASH
  discovery. It neither intercepts traffic nor requests `webRequest`.
  Advanced → Appearance can follow the system theme or force light/dark colors
  for both the options page and drawer without changing the host page.
- Save In sends no analytics or developer-server requests. It fetches only URLs
  involved in user-requested saves.
- Private/Incognito activity is excluded from Save In history, recovery state,
  and debug logs; transient state stays in memory. Chrome's downloads API cannot
  select Incognito, so a private-tab download may appear in Chrome's regular
  download manager. Firefox keeps it in the Private Browsing session.
- The external API accepts validated save requests only from extension IDs the
  user allows. It cannot change configuration or execute received code.
  Rejected non-private callers appear in a bounded local list containing caller
  ID, request kind, count, and time—not the URL.

## Chrome Web Store privacy fields

Single-purpose statement:

> Save user-selected web resources into configurable download subdirectories,
> with local routing, renaming, status, retry, and download history features.

Declare website content and browsing activity. State that Save In processes and
stores them locally only for user-requested saves and history, and never sends
them to the developer. Select **No** for remote code. Use the public repository
copy of `PRIVACY.md` as the privacy-policy URL.

Incognito disclosure:

> Save In excludes Incognito activity from its own history and diagnostic log.
> Because Chrome's extension downloads API has no Incognito selector, a Save In
> download requested from an Incognito tab may appear in Chrome's regular
> download manager.

Permission justifications:

- `contextMenus`: show Save In commands on pages and tabs.
- `downloads`: start, name, monitor, retry, and record downloads locally.
- `notifications`: report completed downloads and actionable failures.
- `storage`: store settings, rules, local history, and MV3 recovery state.
- `offscreen`: create temporary Blob URLs for Chrome service-worker downloads.
- `<all_urls>`: identify and fetch user-selected resources on arbitrary sites,
  including resources that use the user's existing session.

Before submission, verify the description, category, icon, screenshots, support
and privacy links, and that data-use answers match `PRIVACY.md`. The listing and
Advanced downloading copy must say that extension requests use applicable site
credentials by default and can be made anonymous.

## GitHub release provenance

Tag `vX.Y.Z` only when `package.json` and `manifest.json` both contain `X.Y.Z`.
The release workflow verifies the tag, runs tests/typecheck/lint/serial e2e,
builds reproducible runtime and source ZIPs, writes `SHA256SUMS`, creates GitHub
attestations, and opens a draft release with stable filenames.

Inspect and publish the draft manually. Reruns may replace draft assets but not
published assets. Upload the reviewed draft files to the stores. Verify an asset
with:

```sh
gh attestation verify save-in-X.Y.Z.zip -R gyng/save-in
```

Protect `v*` tags with a maintainer-only GitHub ruleset. Release actions are
pinned to immutable commits and should be updated deliberately.

## Browser-owned surface checks

E2E covers the bundled extension, downloads, routing, notifications, options
layout/keyboard behavior, Page Sources, and Chrome worker restarts. CDP and RDP
cannot reliably operate browser context menus, native Save As windows, or OS
notification actions. Before publishing, manually check current Chrome and
Firefox:

1. Save an image and link from the context menu; verify destination and Last
   used location.
2. Test every Save As condition, accepting and cancelling the picker.
3. Test success/failure notifications and opening the related download.
4. Revoke site access, verify the permission banner and disabled click-to-save,
   then restore access and verify recovery.
5. Check options and Page Sources at normal/narrow widths in System, Dark, and
   Light modes, including focus indicators and a forced theme opposite the OS.
6. In Chrome Incognito and Firefox Private Browsing, perform Save In and ordinary
   downloads. Verify Save In retains no history/debug entry and does not reroute
   the ordinary private download.

Failed browser suites upload `dist/e2e-artifacts` with logs and JSON snapshots;
Chrome also attempts a screenshot.

## Chrome Web Store screenshots

```sh
npm run screenshots:store
```

This builds four 1280×800 PNGs in `docs/store-screenshots/`: configured
directories/menu preview, routing rules, Page Sources on the demo page, and
searchable download history. The command losslessly recompresses and validates
each image. Override the destination with:

```sh
npm run screenshots:store -- --output-dir <path>
```

## Chrome tab-strip context menus

Chrome 150 adds the `"tab"` context, but Save In keeps it Firefox-only for now.
The extension supports Chrome 123+, the API lacks a portable feature test, and
Chrome 150 can crash when an extension registers multiple tab-context items.
Enable it on Chrome only after Chromium fixes the crash and a safe gate plus e2e
coverage exists.

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
manually to AMO and the Chrome Web Store.

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
- `declarativeNetRequestWithHostAccess` installs a temporary session rule only
  when the Referer option is used. The rule modifies the Referer header for the
  selected download; it does not block requests.
- `<all_urls>` is required because the extension saves resources selected by
  the user from arbitrary websites, optionally reads content metadata, and can
  run its click-to-save content listener on those pages.
- The extension makes no analytics or developer-server requests. Resource
  fetches go only to URLs involved in a user-requested save.
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

Permission justifications:

- `contextMenus`: provides the primary Save In command on pages and tabs.
- `downloads`: starts downloads, determines filenames, monitors completion,
  and supports retry and local history actions.
- `notifications`: reports completed downloads and actionable failures.
- `storage`: stores settings, routing rules, local history, and MV3 restart
  state.
- `declarativeNetRequestWithHostAccess`: sets only the Referer header for a
  user-requested download when that option is enabled.
- `offscreen`: provides Chrome's service worker with temporary Blob URL
  conversion for downloads.
- `<all_urls>`: identifies and fetches resources explicitly selected by the
  user on arbitrary websites, including resources requiring the user's
  existing session.

Before submitting, verify that the listing has an accurate description,
category, icon, screenshots, support link, privacy-policy link, and the same
data-use answers as `PRIVACY.md`.

## GitHub release provenance

Push a `vX.Y.Z` tag only after `package.json` and `manifest.json` both contain
`X.Y.Z`. The release workflow:

1. validates the tag against both manifests;
2. runs unit tests, typecheck, lint, and the serial Chrome and Firefox e2e
   suites;
3. derives `SOURCE_COMMIT` and `SOURCE_DATE` from the tagged commit;
4. builds the runtime and AMO source ZIPs;
5. copies them to stable `save-in-X.Y.Z*.zip` names and writes `SHA256SUMS`;
6. creates GitHub provenance attestations for the release files; and
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

## Chrome tab-strip context menus

Chrome 150 introduces the `"tab"` context, but Save In does not enable it on
Chrome yet. The extension supports Chrome 123+, the API has no portable
feature-test property, and the Chrome 150 rollout has a known crash when an
extension registers multiple tab-context items. Save In registers five such
items on Firefox. Keep the capability Firefox-only until Chromium fixes the
crash and a safe version/capability gate is available; then add Chrome e2e
coverage before enabling it.

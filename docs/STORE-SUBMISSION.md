# Store submission notes

## Build and upload

Save In ships one Manifest V3 package for Firefox and Chrome. Use Node 24 and
the dependencies pinned in `package-lock.json`:

```sh
npm ci
npm test
npm run lint
npm run typecheck
npm run e2e
npm run build
```

Upload the runtime ZIP from `web-ext-artifacts/` to both stores. The shared
manifest uses `incognito: spanning`.

For AMO, run `npm run build:source` and attach the resulting `*-source.zip`.
Reviewers can reproduce the runtime ZIP with `npm ci && npm run build`.
Rolldown emits readable, non-minified JavaScript; there is no obfuscation or
remote executable code. Runtime and source ZIPs are byte-for-byte reproducible.

## Reviewer notes

- Firefox uses `background.scripts`; Chrome uses `background.service_worker`.
  Each ignores the other key. Chrome also uses an offscreen document for
  temporary Blob URLs.
- Firefox can set a Referer through its downloads API. Chrome has no supported
  equivalent; Save In requests no interception permission.
- Non-private, user-requested Fetch and HEAD requests use applicable site
  credentials by default. Users can make them anonymous. Save In has no cookie
  permission and never reads cookies. Private requests are always anonymous;
  extension Fetch cannot select a Firefox Container or private cookie store.
- `<all_urls>` is needed to save user-selected resources from arbitrary sites,
  read optional metadata, and provide click-to-save and Page Sources. Page
  Sources reads the DOM and Resource Timing entries; it neither intercepts
  traffic nor requests `webRequest`.
- Save In sends no analytics or developer-server requests. It fetches only URLs
  involved in user-requested saves.
- Private activity is excluded from Save In history, recovery state, and debug
  logs. Chrome cannot select an Incognito download context, so a private-tab
  download may appear in Chrome's regular download manager. Firefox keeps it in
  Private Browsing.
- The external API accepts validated saves only from user-approved extension
  IDs. It cannot change configuration or execute code. Rejected non-private
  callers are listed locally without their requested URL.

## Chrome Web Store answers

Single-purpose statement:

> Save user-selected web resources into configurable download subdirectories,
> with local routing, renaming, status, retry, and download history features.

Declare website content and browsing activity. State that both are processed
and stored locally only for user-requested saves and history, and are never sent
to the developer. Select **No** for remote code. Use the public repository copy
of `PRIVACY.md` as the privacy-policy URL.

Incognito disclosure:

> Save In excludes Incognito activity from its own history and diagnostic log.
> Because Chrome's extension downloads API has no Incognito selector, a Save In
> download requested from an Incognito tab may appear in Chrome's regular
> download manager.

Permission justifications:

- `contextMenus`: show Save In commands on pages and tabs.
- `downloads`: start, name, monitor, retry, and record downloads locally.
- `notifications`: report completion and actionable failures.
- `storage`: store settings, rules, local history, and recovery state.
- `offscreen`: create temporary Blob URLs for Chrome downloads.
- `<all_urls>`: identify and fetch user-selected resources on arbitrary sites,
  including resources using the user's session.

## Before upload

- Match the version in `package.json`, `manifest.json`, and the `vX.Y.Z` tag.
- Use the reviewed draft release artifacts; verify checksums and attestations.
- Confirm listing metadata, support/privacy links, and data-use answers match
  `PRIVACY.md`.
- Disclose that extension requests use site credentials by default and can be
  made anonymous.
- Run `npm run screenshots:store` and review the four generated 1280×800 images.
- Manually check context-menu saves, Save As accept/cancel, notifications, site
  access recovery, and private browsing in current Chrome and Firefox.

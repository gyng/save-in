# Store descriptions

Canonical English store copy for Save In. Copy these fields into AMO and the
Chrome Web Store during release preparation, then update the version and review
date below. Keep the short description aligned with `extensionDescription` in
`_locales/en/messages.json`.

- Version: 4.0.0
- Last reviewed: 2026-07-14
- Listing name: Save In

## Short description

Use this for the manifest description and each store's summary field.

```text
Saves images, videos, audio, links, selected text, and pages to folders inside your default download folder.
```

## Firefox description

```text
Save In adds configurable context-menu destinations for images, videos, audio, links, selected text, and pages. Choose organized folders without repeatedly navigating the Save As dialog.

Features

- Build a hierarchical destination menu with aliases, separators, submenus, and a last-used location.
- Route and rename downloads with rules based on the page, source URL, filename, media type, date, counters, and other variables.
- Start from searchable rule templates, add common matchers with Quick add, insert variables and clauses with autocomplete, and test unsaved rules in the route debugger.
- Preview the destination menu and final routed filename while editing.
- Use click-to-save for quick downloads and Page Sources to find media exposed by the current page.
- Save links or pages as .url, .desktop, or HTML redirect shortcuts.
- Search and filter local download history, with JSON and spreadsheet-safe CSV/TSV export.
- Optionally record matching ordinary Firefox downloads in Save In history.
- Connect other extensions through an explicitly approved, versioned integration API.
- Optionally send selected save data to a user-configured HTTPS webhook after a Save In download starts.

Save In can use the page URL as the Referer for matching downloads when you enable that option. Firefox attaches it directly to the browser download. Experimental routing of ordinary Firefox downloads works by cancelling a matching HTTP(S) download and starting a replacement. That replacement can lose POST bodies, temporary URLs, custom request context, or authentication, so enable it only for compatible downloads.

Browser security limits extensions to folders inside the configured default download directory. Open Save In's Options after installation to configure destinations, and make sure the destination folders exist. A filesystem symlink can point a destination to another location.

Privacy and permissions

Save In uses site access only to identify and fetch resources that you choose to save. Settings, history, recovery state, and diagnostics remain on your device and are not sent to the developer. Save In contains no telemetry, advertising, remote code, or developer-operated service. Private Browsing activity is excluded from Save In history, diagnostics, and webhooks. Optional webhooks go directly to the HTTPS endpoint chosen by the user; the options page states and previews the selected data before the feature is enabled.

Requires Firefox 121 or later.
```

## Chrome description

```text
Save In adds configurable context-menu destinations for images, videos, audio, links, selected text, and pages. Choose organized folders without repeatedly navigating the Save As dialog.

Features

- Build a hierarchical destination menu with aliases, separators, submenus, and a last-used location.
- Route and rename downloads with rules based on the page, source URL, filename, media type, date, counters, and other variables.
- Start from searchable rule templates, add common matchers with Quick add, insert variables and clauses with autocomplete, and test unsaved rules in the route debugger.
- Preview the destination menu and final routed filename while editing.
- Use click-to-save for quick downloads and Page Sources to find media exposed by the current page.
- Save links or pages as .url, .desktop, or HTML redirect shortcuts.
- Search and filter local download history, with JSON and spreadsheet-safe CSV/TSV export.
- Optionally record or route matching ordinary Chrome downloads before they are saved.
- Connect other extensions through an explicitly approved, versioned integration API.
- Optionally send selected save data to a user-configured HTTPS webhook after a Save In download starts.

Chrome does not allow extensions to set a Referer directly on their own downloads. When the optional Referer filter matches, Save In instead applies the page URL only to its protected metadata and file fetches, holds that file in memory, and passes the resulting file to Chrome. MIME, final-URL, and SHA-256 variables remain available for these downloads. Chrome also cannot assign an extension-started download to its Incognito download context. A download requested through Save In from Incognito may therefore appear in the regular Chrome download manager, although Save In still excludes private activity from its own history and diagnostics.

Browser security limits extensions to folders inside the configured default download directory. Open Save In's Options after installation to configure destinations, and make sure the destination folders exist. Current Chrome versions reject downloads through symlinked destinations, so Chrome cannot use a symlink to escape that directory.

Privacy and permissions

Save In uses site access only to identify and fetch resources that you choose to save. Settings, history, recovery state, and diagnostics remain on your device and are not sent to the developer. Save In contains no telemetry, advertising, remote code, or developer-operated service. Optional webhooks go directly to the HTTPS endpoint chosen by the user; the options page states and previews the selected data before the feature is enabled. Incognito activity is never sent to webhooks.

Requires Chrome 123 or later.
```

## Version 4 release notes

Use this as the store-facing release note. `CHANGELOG.md` remains the complete
release history.

```text
Version 4 is Save In's largest update. You no longer need to write every configuration from scratch: build destination menus visually, start routing rules from searchable templates or Quick add, use autocomplete for variables and clauses, preview results, and test unsaved rules against real download details in the route debugger. This release also adds Page Sources, more routing variables, improved click-to-save, searchable local history, safer external integrations, and more reliable downloads across browser restarts. The extension now uses Manifest V3 and requires Firefox 121+ or Chrome 123+. Existing settings and routing rules remain supported.
```

## Firefox reviewer note: user-configured webhooks

```text
Webhooks are disabled by default and have no developer-operated endpoint. A user
must enter a direct HTTPS URL, choose any optional page fields, and affirmatively
enable the feature. The same panel states the always-sent fields and shows the
resulting JSON payload. A request is sent only as a consequence of a Save In save
command after Firefox accepts the download. Ordinary browser downloads and
external-extension requests do not trigger delivery. Private Browsing activity
never triggers delivery.

The purpose-limited payload always contains the selected resource URL, the
"save" event, and an ISO 8601 timestamp. Page URL, page title, and selected text
are separate user choices. Requests omit credentials and referrers, reject
redirects, are never retried, and response bodies are never read. Save In never
receives this data. Firefox 140+ optional data permissions are requested from the
enabling user action and are checked again before delivery; older supported
Firefox versions use the labelled in-product opt-in.
```

## Maintenance

Before each upload:

1. Compare both descriptions with `manifest.json`, `PRIVACY.md`, and the current
   browser-specific behavior documented in `AGENTS.md`.
2. Update the version, review date, minimum browser versions, feature list, and
   release note.
3. Confirm the listing links, screenshots, permission explanations, and
   data-use declarations using `docs/RELEASE.md`.
4. Paste the descriptions into the stores as plain text and check their rendered
   formatting before submission.

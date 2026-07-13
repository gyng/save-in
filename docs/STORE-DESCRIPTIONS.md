# Store descriptions

Canonical English store copy for Save In. Copy these fields into AMO and the
Chrome Web Store during release preparation, then update the version and review
date below. Keep the short description aligned with `extensionDescription` in
`_locales/en/messages.json`.

- Version: 4.0.0
- Last reviewed: 2026-07-13
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
- Preview menus and rules while editing them.
- Use click-to-save for quick downloads and Page Sources to find media exposed by the current page.
- Save links or pages as .url, .desktop, or HTML redirect shortcuts.
- Search and filter local download history, with JSON and spreadsheet-safe CSV/TSV export.
- Optionally record matching ordinary Firefox downloads in Save In history.
- Connect other extensions through an explicitly approved, versioned integration API.

Firefox can set a Referer header for Save In downloads when you enable that option. Experimental routing of ordinary Firefox downloads works by cancelling a matching HTTP(S) download and starting a replacement. That replacement can lose POST bodies, temporary URLs, custom request context, or authentication, so enable it only for compatible downloads.

Browser security limits extensions to folders inside the configured default download directory. Open Save In's Options after installation to configure destinations, and make sure the destination folders exist. A filesystem symlink can point a destination to another location.

Privacy and permissions

Save In uses site access only to identify and fetch resources that you choose to save. Settings, history, recovery state, and diagnostics remain on your device and are not sent to the developer. Save In contains no telemetry, advertising, remote code, or developer-operated service. Private Browsing activity is excluded from Save In history and diagnostics.

Requires Firefox 121 or later.
```

## Chrome description

```text
Save In adds configurable context-menu destinations for images, videos, audio, links, selected text, and pages. Choose organized folders without repeatedly navigating the Save As dialog.

Features

- Build a hierarchical destination menu with aliases, separators, submenus, and a last-used location.
- Route and rename downloads with rules based on the page, source URL, filename, media type, date, counters, and other variables.
- Preview menus and rules while editing them.
- Use click-to-save for quick downloads and Page Sources to find media exposed by the current page.
- Save links or pages as .url, .desktop, or HTML redirect shortcuts.
- Search and filter local download history, with JSON and spreadsheet-safe CSV/TSV export.
- Optionally record or route matching ordinary Chrome downloads before they are saved.
- Connect other extensions through an explicitly approved, versioned integration API.

Chrome does not allow extensions to set a Referer header for their own downloads, so that Firefox feature is unavailable. Chrome also cannot assign an extension-started download to its Incognito download context. A download requested through Save In from Incognito may therefore appear in the regular Chrome download manager, although Save In still excludes private activity from its own history and diagnostics.

Browser security limits extensions to folders inside the configured default download directory. Open Save In's Options after installation to configure destinations, and make sure the destination folders exist. A filesystem symlink can point a destination to another location.

Privacy and permissions

Save In uses site access only to identify and fetch resources that you choose to save. Settings, history, recovery state, and diagnostics remain on your device and are not sent to the developer. Save In contains no telemetry, advertising, remote code, or developer-operated service.

Requires Chrome 123 or later.
```

## Version 4 release notes

Use this as the store-facing release note. `CHANGELOG.md` remains the complete
release history.

```text
Version 4 is Save In's largest update. It adds a redesigned Options page, visual destination and rule editing, previews, search, Page Sources, more routing variables, improved click-to-save, searchable local history, safer external integrations, and more reliable downloads across browser restarts. The extension now uses Manifest V3 and requires Firefox 121+ or Chrome 123+. Existing settings and routing rules remain supported.
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

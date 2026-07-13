# Save In Privacy Policy

Last updated: July 13, 2026

Save In processes the information needed to save and organize files at the
user's request. It does not send data to the developer, use analytics or
telemetry, serve advertising, sell data, or use a developer-operated server.

## Information handled

When the user invokes Save In, the extension may handle the selected resource
URL, the current page URL and title, link or media metadata, selected text, and
the intended download filename and directory. It uses this information only to
fetch the selected resource, apply the user's routing and renaming rules, and
start and monitor the download.

The extension stores its settings and routing rules in browser extension
storage. Its local download history stores up to 10,000 entries containing the
resource and page URLs, destination path, download status, size when known, and
the type of save action. The user can clear this history from the options page.
Activity from Chrome Incognito windows and Firefox Private Browsing windows is
not added to local history, session recovery state, or the extension debug log.
Temporary state needed to perform a private-window save is kept in memory only.

## Network requests

Save In makes requests only as needed for its user-facing features, including
retrieving a resource selected by the user, reading its content type or
suggested filename, and performing a download. These requests go to the
resource servers selected by the user and may use the user's existing browser
session for that server. Direct browser downloads use the browser's normal
cookie handling. Extension-side Fetch and HEAD requests include applicable
website cookies and browser-managed authentication only when the user enables
that option. Save In does not transmit this information to the developer or to
an analytics, advertising, or data-broker service.

## Sharing and retention

Save In does not share user data with the developer or third parties. Settings
and history remain in browser-managed extension storage until the user changes
or clears them, or uninstalls the extension. Temporary download state is
discarded by the browser or removed after it is no longer needed.

## Permissions

Save In requests access to websites because its purpose is to save resources
from websites chosen by the user. It uses browser download, context-menu,
notification, storage, and Chrome offscreen APIs
only to provide the saving, routing, status, and retry features described in
the extension and store listings. On Firefox, users can optionally grant the
cookies permission so a direct download uses the originating Container's
cookie store. Save In passes only the opaque store identifier to Firefox's
downloads API; it does not read, store, or expose cookie values.

## Changes and contact

Material changes to this policy will be published with the corresponding
extension update. Questions can be filed at
https://github.com/gyng/save-in/issues.

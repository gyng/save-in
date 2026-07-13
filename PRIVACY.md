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

The shared Chrome and Firefox package uses the browsers' supported
`incognito: spanning` mode. Chrome does not let an extension select an
Incognito download context when calling its downloads API. A download that Save
In starts from a Chrome Incognito tab may therefore appear in Chrome's regular
download manager and remain visible after the Incognito window closes. Save In
does not copy that browser-owned record into its own history or debug log.
Firefox supports associating the download with its Private Browsing session.

## Network requests

Save In makes requests only as needed for its user-facing features, including
retrieving a resource selected by the user, reading its content type or
suggested filename, and performing a download. These requests go to the
resource servers selected by the user and any destinations to which those
servers redirect. Direct browser downloads use the browser's normal cookie
handling. Extension-side Fetch and HEAD requests include applicable website
cookies and browser-managed authentication by default, including credentials
applicable to redirect destinations; the user can turn this off in Advanced
downloading. Extension-side requests made for private-window saves are always
anonymous because a spanning background cannot select a private cookie store.
Authenticated resources that require extension-side fetching may therefore fail
from a private window. Firefox direct downloads instead use the private session
through the browser's native download API.
Save In does not transmit this information to the developer or to an analytics,
advertising, or data-broker service.

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
the extension and store listings. Save In does not request cookie access or
read, store, or expose cookie values. For authenticated extension requests, the
browser itself attaches applicable credentials unless the user turns that
option off.

## Changes and contact

Material changes to this policy will be published with the corresponding
extension update. Questions can be filed at
https://github.com/gyng/save-in/issues.

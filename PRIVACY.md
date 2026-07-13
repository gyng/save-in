# Save In Privacy Policy

Last updated: July 13, 2026

Save In does not collect or receive user data on developer-operated servers. It
has no analytics, telemetry, advertising, data sales, or developer-operated
service. Data stays in the browser except for requests needed to save a resource
chosen by the user.

## Local data

Save In processes resource and page URLs, page titles, selected text, media or
link metadata, and destination paths to perform saves. Settings, routing rules,
and up to 10,000 download-history entries are kept in browser-managed extension
storage. The user can clear this data or remove it by uninstalling Save In.

Private or Incognito activity is not added to Save In history, recovery storage,
or its debug log. Temporary private-save state is held in memory only.

## Network requests

At the user's request, Save In contacts the selected resource server and any
redirect destinations to inspect or download that resource. Direct downloads use
the browser's normal credential handling. Non-private extension Fetch and HEAD
requests include applicable site cookies and browser-managed authentication by
default; this can be disabled under Advanced downloading. Save In does not read
or store cookie values, and private-window extension requests are anonymous.

External extensions can request a save only after the user allows their extension
ID. Rejected non-private requests leave a bounded local summary without the
requested URL; private rejections are not stored.

## Sharing and retention

Save In sends no user data to the developer, analytics providers, advertisers,
data brokers, or other unrelated parties. Necessary requests go only to the
resource hosts selected by the user and their redirect destinations. Local data
remains until the user clears it or uninstalls Save In; temporary transfer state
is removed when no longer needed.

Chrome cannot place an extension-started download into a separate Incognito
download context. Such a download may therefore appear in Chrome's regular
download manager, although Save In does not retain it in its own history or log.

## Permissions

Website access and the download, context-menu, notification, storage, and Chrome
offscreen permissions are used only for the saving, routing, status, history, and
retry features described in the extension and store listing.

Save In's use of information received from Chrome APIs complies with the Chrome
Web Store User Data Policy, including its Limited Use requirements.

## Contact

Questions can be filed at https://github.com/gyng/save-in/issues.

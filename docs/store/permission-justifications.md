# Store submission: single purpose and permission justifications

Copy-paste text for the Chrome Web Store listing (single purpose) and its
privacy-practices tab (per-permission justifications). Kept as the canonical
record so the listing, the code, and [PRIVACY.md](../../PRIVACY.md) tell one
story if a reviewer cross-checks. When a permission is added, removed, or its
use changes, update the matching entry here and the terse rationale list in
[docs/release/workflow.md](../release/workflow.md).

The set below matches `manifest.json` exactly: `permissions` are `contextMenus`,
`declarativeNetRequestWithHostAccess`, `downloads`, `notifications`, `storage`,
`offscreen`; `host_permissions` is `<all_urls>`. A listing that requests a
permission with no justification here — or justifies one it does not request —
is the common review snag; keep this file and the manifest in step.

## Single purpose

> Save In saves images, links, media, selected text, and web pages into
> user-chosen download subfolders, using pattern-based rules to route each save
> to the right folder and rename it.

Keep the field itself to that one sentence — Chrome wants the single purpose
"narrow and easy to understand." Use this only if a reviewer questions whether
the peripheral features fit a single purpose:

> Every feature serves that one purpose — organizing saved downloads. Routing
> rules and the on-device rule assistant decide the folder and filename; Page
> Sources finds saveable media on a page to save the same way; history, undo,
> and retries manage those saves; and webhooks and the integration API let other
> tools trigger a save. None of it does anything outside saving-and-organizing
> downloads.

## Permission justifications

### `contextMenus`

> Save In's entire user interface for saving is a right-click context menu. This
> permission adds the "Save In → folder" commands to the page context menu (for
> images, links, media, selected text, and pages) and, where the browser
> supports it, to the tab-strip menu. It is the extension's primary interaction
> surface and is used for nothing else.

### `declarativeNetRequestWithHostAccess`

> Save In uses a temporary, tightly scoped declarativeNetRequest session rule to
> attach the originating page as the Referer header on its own HEAD/GET requests
> — and only while fetching metadata or content for a specific resource the user
> chose to save (for example, an anti-hotlink image or a download that needs its
> final filename, MIME type, or SHA-256 hash resolved).
>
> The rule covers only the exact extension-initiated request URL (plus up to
> three exact redirect hops it follows), is removed as soon as that operation
> finishes, and never applies to the user's ordinary page browsing. The
> extension does not request webRequest or webRequestBlocking, and does not
> modify, block, or observe general network traffic.

### `downloads`

> Save In's core function is downloading the resource the user selected into a
> chosen folder. This permission is used to start the download, set its filename
> and destination folder from the user's routing rules, monitor its progress to
> report completion or failure, retry failed transfers, and record it in the
> extension's local history. All of this is local; nothing is sent to the
> developer.

### `notifications`

> Save In shows a brief notification when a save completes or fails, so the user
> knows the outcome of an action they triggered. On Chrome, a completion
> notification can offer a one-click Undo button. Notifications are only shown in
> response to the user's own save actions.

### `storage`

> Save In stores the user's own configuration and state locally: settings, folder
> paths, routing and renaming rules, download history, and the recovery state
> that lets an interrupted download resume after the MV3 service worker restarts.
> A separate private **Last used** destination is kept only in browser session
> storage so it survives background sleeps, then removed when the final private
> window closes. An off-by-default setting can include private saves in the
> normal local activity stores; its disclosure explains that those records can
> outlive private browsing. Webhooks and browser credentials remain disabled in
> private windows. Chrome also keeps a bare, non-identifying pending count during
> a private download handoff to prevent a service-worker restart from treating
> it as an ordinary browser download; it is balanced normally or expires after
> ten seconds. All data stays on the device; none is transmitted to the developer
> or any third party.

### `offscreen`

> A Chrome MV3 service worker has no DOM, so Save In opens a short-lived offscreen
> document to perform three tasks that require a document context:
>
> (1) creating the temporary Blob object URL that a fetched download is handed to
> the downloads API as;
> (2) computing SHA-256 hashes of those same bytes for the :sha256: filename
> variables; and
> (3) running the optional, off-by-default on-device rule assistant, because
> Chrome's built-in Prompt API requires a responsible document and refuses to run
> inside a worker.
>
> The offscreen document is created only when one of these is needed and is
> closed afterward. It performs no background or persistent activity.

## Host permission justification

### `<all_urls>`

> Save In is a right-click "save to a chosen folder" tool, so its core feature —
> the context menu for saving images, links, media, selected text, and pages —
> must be available on whatever site the user is browsing, which cannot be known
> in advance.
>
> When the user selects something to save, the extension reads the clicked
> element and, from its own extension context, fetches that exact resource to
> resolve its final filename, MIME type, or content (for anti-hotlink downloads,
> hashing, and Page Sources discovery).
>
> Access is exercised only in response to a user action on the page they chose;
> the extension does not read, collect, or transmit page content in the
> background, sends nothing to the developer, and runs no remote code. A narrower
> host list is not possible because the sites a user saves from are arbitrary and
> user-driven.

## Data use

Keep the store's data-use answers aligned with [PRIVACY.md](../../PRIVACY.md): no
data sold or transferred to third parties, no use unrelated to the single
purpose, all processing local, and no remote code. Save In processes website
content and browsing activity locally for direct saves, explicitly configured
automatic saves, and history; it sends none of it to the developer.

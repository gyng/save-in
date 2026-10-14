# Routing actions

Routing rules are evaluated from top to bottom. The first matching rule owns the
request. A normal rule ends with `into:`; an exclusion rule ends with
`exclude: true` and stops processing without starting a download.

```text
sourceurl: /(?:avatar|tracking)\.gif(?:[?#]|$)
exclude: true

fileext/i: ^(?:jpe?g|png)$
into: images/:filename:
```

An exclusion must have at least one matcher. It cannot contain `into:`,
`capture:`, `capturegroups:`, `fetch:`, `rename:`, or `after:`. Put narrow
exclusions before broader destinations. For an ordinary browser download that
has already started, exclusion leaves the browser's download unchanged; it does
not cancel it. Chrome learns a Save In download's `finalfilename:` only during
the browser handoff; if that late value matches an exclusion, Save In cancels
its own transfer and records it as excluded. A private exclusion notification
reports only that an item was excluded; it does not identify the item or its
address.

Automatic Page Sources can use guarded exclusions. The exclusion needs the same
explicit `context: ^auto$`, page matcher, and source matcher as an automatic
destination rule. The content script resolves it locally, so excluded sources
do not send a background command or consume the page's automatic-save limit.

Destination rules can add one post-save action:

```text
pageurl: ^https://example\.com/
fileext: pdf
after: close-tab
into: documents/:filename:
```

`after: close-tab` closes the source tab only after the browser accepts the download.
It does nothing when planning, fetching, or `downloads.download()` fails. A
folder menu item's `(after: close-tab)` or `(after: return-tab)` setting — the
legacy `(tab: close)` and `(tab: return)` spellings stay accepted — is more
specific and wins over the routing action; the routing action in turn wins over the
global **Close each tab after saving it** setting. Save In resolves that order
once, so overlapping close settings never issue duplicate tab operations.

The source must be unambiguous. A save sent by Save In's page content script
may close that sending tab, and an integration using `target: "activeTab"` may
close the tab it explicitly selected. An explicit-URL request from an extension
page or external integration does not close the caller's ambient tab. If the
source tab navigates while the save is starting, Save In leaves the new page
open.

Automatic rules cannot use `after: close-tab`: unattended source discovery must not
close a page. Ordinary browser-download routing also ignores post-save tab
actions because it has no source tab to act on.

## Page details for browser downloads

An ordinary browser download does not say which tab started it, so by default
`pagetitle:`, `pageurl:`, `pagedomain:`, `pagerootdomain:`, and the matching
variables are empty for it and never match. `referrerurl:` and
`referrerdomain:` still read the address the browser reports as the download's
referrer.

Turn on **Use page details from the open tab** under **Browser downloads** to
give routed browser downloads page details. Save In uses the title and address
of an open tab only when all of these hold:

- the download has a referrer, and it is a deeper page than a site root such as
  `https://example.com/`, which a referrer policy may have shortened from
  another page;
- exactly one open tab shows that address (a `#fragment` on the tab is
  ignored);
- that tab is not in a private browsing window, and the download is not private.

Otherwise the download has no page details, exactly as with the setting off.
Turning it on can change where existing rules send browser downloads: a page
rule placed above your browser-download rules can now match them. The setting
is off by default for that reason. Page details are read only for routing; they
are not stored in History.

```text
context: ^browser$
pagedomain: ^gallery\.example$
into: gallery/:pagetitle:/:filename:
```

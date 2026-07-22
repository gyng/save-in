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
`capture:`, `capturegroups:`, `fetch:`, `rename:`, or `tab:`. Put narrow
exclusions before broader destinations. For an ordinary browser download that
has already started, exclusion leaves the browser's download unchanged; it does
not cancel it.

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
folder menu item's `(tab: close)` or `(tab: return)` setting is more specific
and wins over the routing action; the routing action in turn wins over the
global **Close each tab after saving it** setting. Save In resolves that order
once, so overlapping close settings never issue duplicate tab operations.

Automatic rules cannot use `after: close-tab`: unattended source discovery must not
close a page. Ordinary browser-download routing also ignores post-save tab
actions because it has no source tab to act on.

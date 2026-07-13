# Save In Privacy Policy

Last updated: July 14, 2026

## What information does Save In collect?

Save In collects or receives no user data on developer-operated servers. It has
no analytics, telemetry, advertising, data sales, or developer-operated service.

On the user's device, it processes resource and page URLs, titles, selected text,
media or link metadata, and destination paths. Browser storage holds settings,
routing rules, and up to 10,000 download-history entries. The developer cannot
access this data. Private activity is not stored; temporary private-save state
remains in memory.

## How does Save In use the information?

Save In uses this information only for user-requested saving, routing, renaming,
status, history, and retries.

On the user's command, Save In contacts the selected resource server and its
redirects to inspect or download the resource. Direct downloads use the browser's
normal credentials. Non-private extension Fetch and HEAD requests include
applicable site credentials by default; this can be disabled under Advanced
downloading. Save In never reads or stores cookie values, and private extension
requests are anonymous.

The optional Referer feature is off by default and limited to user-configured
URL patterns. Firefox attaches the containing page URL directly to the selected
download. Chrome installs a temporary exact session rule only while Save In
fetches requested metadata or the selected resource, removes that rule after
each protected operation, and saves the resulting local Blob. The rule does not
apply to ordinary page traffic.

External extensions can request a save only after the user allows their ID.
Extension permissions support only the features described above.

Webhooks are off by default. If the user supplies an HTTPS endpoint and enables
the feature, Save In sends one JSON request after a non-private download starts
from a direct Save In save command. Automated external-extension requests and
ordinary browser downloads are excluded. Every request contains the selected
resource URL, a save event, and a timestamp. The user can separately include the
containing page URL, page title, and selected text. The options page shows the
resulting payload before the feature is enabled.

Webhook requests go directly from the browser to the endpoint selected by the
user. They contain no cookies or browser credentials, do not follow endpoint
redirects, are not retried, and never include private-window activity. Save In
does not read response bodies or expose endpoint URLs in its diagnostic log.

Chrome may show an Incognito save in its regular download manager; Save In does
not retain it in its own history or log. Firefox keeps the download in its
Private Browsing session.

## What information does Save In share?

Save In sends no user data to the developer, analytics providers, advertisers,
data brokers, or other unrelated parties. Necessary download requests go only
to hosts selected by the user and their redirects. Optional webhook requests go
only to the exact HTTPS endpoint configured by the user.

Local data remains until the user clears it or uninstalls Save In; temporary
transfer state is removed when no longer needed.

Save In's use of information received from Chrome APIs complies with the Chrome
Web Store User Data Policy, including its Limited Use requirements. Save In also
complies with Mozilla's Add-on Policies for Firefox.

## Contact

Questions can be filed at https://github.com/gyng/save-in/issues.

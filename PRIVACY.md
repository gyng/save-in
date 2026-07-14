# Save In Privacy Policy

Last updated: July 15, 2026

## What information does Save In collect?

Save In collects or receives no user data on developer-operated servers. It has
no analytics, telemetry, advertising, data sales, or developer-operated service.

On the user's device, it processes resource and page URLs, titles, selected text,
media or link metadata, and destination paths. Browser storage holds settings,
routing rules, and up to 10,000 download-history entries. The developer cannot
access this data. Private activity is not stored; temporary private-save state
remains in memory.

## How does Save In use the information?

Save In uses this information only for user-requested or explicitly configured
automatic saving, routing, renaming, status, history, and retries.

On the user's command, or when an enabled site-scoped automatic rule matches a
newly discovered page source, Save In contacts the resource server and its
redirects to inspect or download the resource. Direct downloads use the browser's
normal credentials. Non-private extension Fetch and HEAD requests include
applicable site credentials by default; this can be disabled under Advanced
downloading. Save In never reads or stores cookie values, and private extension
requests are anonymous.

The optional Referer feature is off by default and limited to user-configured
URL patterns. Both browsers install a temporary exact session rule only while
Save In fetches requested metadata or content and remove it after each protected
operation. Firefox normally attaches the page URL directly to the final browser
download; Chrome saves the protected content as a local Blob. Content already
fetched for hashing is reused on both browsers. The rule does not apply to
ordinary page traffic.

External extensions can request a save only after the user allows their ID.
Extension permissions support only the features described above.

When the options page is open in a browser that provides WebMCP, compatible
in-browser agents can use Save In tools to read its schema, routing vocabulary,
and complete saved configuration, including destinations, routing rules,
approved extension IDs, and webhook details. They can also validate or apply
configuration changes and start downloads. Save In adds no separate consent
prompt; the browser or agent controls tool access and confirmation. Close the
options page to make the tools unavailable. Data received by an agent is
subject to that agent's and browser's data-handling policies.

Webhooks are off by default. If the user supplies an HTTPS endpoint and enables
the feature, Save In sends one JSON request after a non-private download starts
from a direct Save In save command. Automatic Page Sources saves,
external-extension requests, and ordinary browser downloads are excluded. Every
request contains the selected resource URL, a save event, and a timestamp. The
user can separately include the containing page URL, page title, and selected
text. The options page shows the resulting payload before the feature is
enabled.

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
to hosts selected directly by the user or matched by their enabled automatic
rules, and to those hosts' redirects. Optional webhook requests go only to the
exact HTTPS endpoint configured by the user.

When the options page is open and WebMCP is available, configuration and tool
results can also be shared with a compatible in-browser agent as described
above. Save In does not send that information to an agent on its own.

Local data remains until the user clears it or uninstalls Save In; temporary
transfer state is removed when no longer needed.

Save In's use of information received from Chrome APIs complies with the Chrome
Web Store User Data Policy, including its Limited Use requirements. Save In also
complies with Mozilla's Add-on Policies for Firefox.

## Contact

Questions can be filed at https://github.com/gyng/save-in/issues.

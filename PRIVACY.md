# Save In Privacy Policy

Last updated: July 21, 2026

## What information does Save In collect?

Save In collects or receives no user data on developer-operated servers. It has
no analytics, telemetry, advertising, data sales, or developer-operated service.

On the user's device, it processes resource and page URLs, titles, selected text,
media or link metadata, and destination paths. Browser storage holds settings,
routing rules, and up to 10,000 download-history entries. The developer cannot
access this data. By default, private activity is excluded from durable storage,
History, and diagnostic logs. The private **Last used** destination is kept
separately in browser session storage so it survives a background sleep, then
removed when the final private window closes or the browser exits. Other
temporary private-save state remains in memory.

**Remember private browsing activity** is a separate option and defaults to
off. When enabled, private saves can enter Save In's normal local Last used,
Recent locations, History, counter, diagnostic, and restart-recovery state.
Those records follow each data type's normal retention and can remain visible
after private browsing closes. Turning the option off stops new private records
but does not remove records already kept. It does not enable webhooks,
credentialed private requests, or external access to private tabs.

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

Webhooks are off by default. If the user supplies at least one endpoint and
enables the feature, Save In reports non-private downloads that came from a
direct Save In save command. Automatic Page Sources saves, external-extension
requests, and ordinary browser downloads are excluded. Endpoints are one per
line, up to ten, and each is sent to independently. HTTPS is required unless the
user separately allows http:// endpoints, which is off by default.

Which events report is a separate choice per event: when a download starts (off
by default), when it completes (on by default), and when it fails (off by
default). The options page's Test button also sends one test request on demand.

Every request carries a schema version, the event name, and a timestamp. All
except the test request also carry the browser's download id and the selected
resource URL. A start request carries the containing page URL, page title, and
selected text only where the user chose each. A completion request carries the
folder path the file was saved to, and no page information. A failure request
carries a failure reason. The options page previews each event before the
feature is enabled.

Webhook requests go directly from the browser to the endpoints selected by the
user. They contain no cookies or browser credentials, do not follow endpoint
redirects, are not retried, and never include private-window activity. Save In
does not read response bodies or expose endpoint URLs in its diagnostic log.

The rule assistant is off by default and is available only in Chrome, which is
the only supported browser that offers a built-in on-device model. Turning it on
can ask Chrome to download that model; Chrome performs and stores that download,
and Save In neither hosts nor bundles model weights. Requests are then answered
on the device: no prompt text, rule, or page content leaves the machine, and
Save In operates no inference service.

Chrome may show an Incognito save in its regular download manager. Save In does
not retain it in its own history or log unless **Remember private browsing
activity** is enabled. Firefox keeps the download in its Private Browsing
session.

## What information does Save In share?

Save In sends no user data to the developer, analytics providers, advertisers,
data brokers, or other unrelated parties. Necessary download requests go only
to hosts selected directly by the user or matched by their enabled automatic
rules, and to those hosts' redirects. Optional webhook requests go only to the
exact endpoints configured by the user. The optional rule assistant sends
nothing: Chrome downloads its model once, and every request after that is
answered on the device.

When the options page is open and WebMCP is available, configuration and tool
results can also be shared with a compatible in-browser agent as described
above. Save In does not send that information to an agent on its own.

Durable local data remains until the user clears it or uninstalls Save In.
Temporary transfer and diagnostic state follows browser-session or operation
lifetime. With private activity retention off, the separate private **Last
used** destination is removed when private browsing ends.

Save In's use of information received from Chrome APIs complies with the Chrome
Web Store User Data Policy, including its Limited Use requirements. Save In also
complies with Mozilla's Add-on Policies for Firefox.

## Contact

Questions can be filed at https://github.com/gyng/save-in/issues.

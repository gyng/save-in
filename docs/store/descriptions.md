# Store descriptions

Canonical English store copy for Save In. Copy these fields into AMO and the
Chrome Web Store during release preparation, then update the version and review
date below.

The manifest description and the store summary are deliberately different
fields. The manifest description names what the extension does for someone who
already has it installed and is reading their extensions list, and it is
translated into every catalog. The store summary is read by someone who does not
have it yet and is scanning search results, so it leads with the action and the
outcome. Keep the manifest one aligned with `extensionDescription` in
`_locales/en/messages.json`; the summary answers to the stores alone.

- Version: 4.0.0
- Last reviewed: 2026-07-17
- Listing name: Save In

## Manifest description

Mirrors `extensionDescription` in `_locales/en/messages.json`. Change both
together, and retranslate the generated catalogs when it changes.

```text
Saves images, videos, audio, links, selected text, and pages to folders inside your default download folder.
```

## Store summary

Use this for each store's summary field. Chrome caps it at 132 characters and
AMO at 250, so it is written to the shorter limit. It names the gesture people
search for and the thing only this extension does, rather than listing what it
saves — the first line of the description below already does that.

```text
Right-click to save images, video, audio, links and pages into organized folders, with rules to sort and rename them automatically.
```

## Firefox description

```text
Right-click anything worth keeping and file it exactly where it belongs — no Save As dialog, no downloads folder to dig through later.

Save In adds configurable context-menu destinations for images, videos, audio, links, selected text, and pages, and can sort and rename them automatically with rules you write once. Rebuilt from the first character to the last for Manifest V3, and still filing your downloads with the same stubborn logic it has used since 2017.

Features

- Build a hierarchical destination menu with aliases, separators, submenus, and a last-used location.
- Route and rename downloads with rules based on the page, source URL, filename, media type, date, counters, and other variables.
- Start from searchable rule templates, add common matchers with Quick add, insert variables and clauses with autocomplete, and test unsaved rules in the route debugger.
- Preview the destination menu and final routed filename while editing.
- Use click-to-save for quick downloads and Page Sources to find media exposed by the current page.
- Optionally save newly discovered Page Sources automatically with site-scoped routing rules, private-window controls, and a per-page limit.
- Save links or pages as .webloc or HTML redirect shortcuts.
- Search and filter local download history, with JSON and spreadsheet-safe CSV/TSV export.
- Optionally record matching ordinary Firefox downloads in Save In history.
- Connect other extensions through an explicitly approved, versioned integration API.
- Optionally report a save to webhook endpoints you configure, when it starts, completes, or fails.

Save In can use the page URL as the Referer for matching downloads when you enable that option. Firefox protects exact metadata and content requests so MIME, final-URL, and SHA-256 variables remain available, while retaining its native browser download whenever the content was not already fetched for hashing. Experimental routing of ordinary Firefox downloads works by cancelling a matching HTTP(S) download and starting a replacement. That replacement can lose POST bodies, temporary URLs, custom request context, or authentication, so enable it only for compatible downloads.

Browser security limits extensions to folders inside the configured default download directory. Open Save In's Options after installation to configure destinations, and make sure the destination folders exist. A filesystem symlink can point a destination to another location.

Privacy and permissions

Save In uses site access only to identify and fetch resources that you choose directly or configure site-scoped rules to save automatically. Settings, history, recovery state, and diagnostics remain on your device and are not sent to the developer. Save In contains no telemetry, advertising, remote code, or developer-operated service. Private Browsing activity is excluded from Save In history, diagnostics, and webhooks. Optional webhooks go directly from your browser to the endpoints you configure — HTTPS unless you separately allow http:// for a network you trust — and automatic saves do not trigger them. The options page states the always-sent fields and previews every event before the feature is enabled; a completed save reports the folder path it landed in.

Requires Firefox 140 or later.
```

## Chrome description

```text
Right-click anything worth keeping and file it exactly where it belongs — no Save As dialog, no downloads folder to dig through later.

Save In adds configurable context-menu destinations for images, videos, audio, links, selected text, and pages, and can sort and rename them automatically with rules you write once. Rebuilt from the first character to the last for Manifest V3, and still filing your downloads with the same stubborn logic it has used since 2017.

Features

- Build a hierarchical destination menu with aliases, separators, submenus, and a last-used location.
- Route and rename downloads with rules based on the page, source URL, filename, media type, date, counters, and other variables.
- Start from searchable rule templates, add common matchers with Quick add, insert variables and clauses with autocomplete, and test unsaved rules in the route debugger.
- Preview the destination menu and final routed filename while editing.
- Use click-to-save for quick downloads and Page Sources to find media exposed by the current page.
- Optionally save newly discovered Page Sources automatically with site-scoped routing rules, private-window controls, and a per-page limit.
- Save links or pages as .url, .webloc, .desktop, or HTML redirect shortcuts.
- Search and filter local download history, with JSON and spreadsheet-safe CSV/TSV export.
- Optionally record or route matching ordinary Chrome downloads before they are saved.
- Connect other extensions through an explicitly approved, versioned integration API.
- Optionally let compatible in-browser agents inspect or update settings and start routed downloads through experimental WebMCP tools while Options is open.
- Optionally draft routing rules from a plain-language request with Chrome's on-device model, which runs on your device and sends nothing anywhere.
- Optionally report a save to webhook endpoints you configure, when it starts, completes, or fails.

Chrome does not allow extensions to set a Referer directly on their own downloads. When the optional Referer filter matches, Save In instead applies the page URL only to its protected metadata and file fetches, holds that file in memory, and passes the resulting file to Chrome. MIME, final-URL, and SHA-256 variables remain available for these downloads. Chrome also cannot assign an extension-started download to its Incognito download context. A download requested through Save In from Incognito may therefore appear in the regular Chrome download manager, although Save In still excludes private activity from its own history and diagnostics.

Browser security limits extensions to folders inside the configured default download directory. Open Save In's Options after installation to configure destinations, and make sure the destination folders exist. Current Chrome versions reject downloads through symlinked destinations, so Chrome cannot use a symlink to escape that directory.

Privacy and permissions

Save In uses site access only to identify and fetch resources that you choose directly or configure site-scoped rules to save automatically. Settings, history, recovery state, and diagnostics remain on your device and are not sent to the developer. Save In contains no telemetry, advertising, remote code, or developer-operated service. Optional webhooks go directly from your browser to the endpoints you configure — HTTPS unless you separately allow http:// for a network you trust — and automatic saves do not trigger them. The options page states the always-sent fields and previews every event before the feature is enabled; a completed save reports the folder path it landed in. Incognito activity is never sent to webhooks. The optional rule assistant uses Chrome's own on-device model: turning it on can ask Chrome to download that model, after which requests are answered on your device and no prompt text leaves it. In a browser that provides WebMCP, a compatible in-browser agent can read the complete saved configuration and invoke Save In tools only while Options is open. Save In adds no separate consent prompt; the browser or agent controls access and confirmation.

Requires Chrome 123 or later.
```

## Version 4 release notes

Use this as the store-facing release note. `CHANGELOG.md` remains the complete
release history.

```text
Version 4 is Save In's largest update. You no longer need to write every configuration from scratch: build destination menus visually, start routing rules from searchable templates or Quick add, use autocomplete for variables and clauses, preview results, and test unsaved rules against real download details in the route debugger. This release also adds Page Sources with guarded automatic saving, more routing variables, improved click-to-save, searchable local history, safer external integrations, and more reliable downloads across browser restarts. The extension now uses Manifest V3 and requires Firefox 140+ or Chrome 123+. Existing settings and routing rules remain supported, and valid settings from the earlier automation editor migrate into unified routing rules.
```

## Reviewer notes

Two sets, because the two stores are reviewing different behaviour from one
package. WebMCP and the rule assistant are Chrome-only: both feature-detect an
API Firefox does not have (`document.modelContext`, `LanguageModel`), so on
Firefox they never register and never run. Do not paste them into AMO — a
reviewer asked to assess a feature that cannot execute is being sent to look for
something that is not there. Conversely, only Firefox has the optional
data-collection permissions, so only its webhook note mentions them.

### Firefox: user-configured webhooks

```text
Webhooks are disabled by default and have no developer-operated endpoint. A user
must enter at least one endpoint, choose which save events report, choose any
optional page fields, and affirmatively enable the feature. The same panel states
the always-sent fields and previews the resulting JSON for every event it would
send.

Endpoints are one per line, up to ten, and each is delivered to independently.
HTTPS is required unless the user also enables the separate "Allow http://
endpoints" setting, which is off by default and exists for an endpoint on a
network the user already trusts.

Delivery follows a save the user asked for. Three events are chosen separately:
"save" when a download starts (off by default), "complete" when it finishes (on
by default), and "failed" when it does not (off by default). The panel's Test
button additionally sends one "test" payload on demand, so an endpoint can be
confirmed before anything else is enabled. Automatic Page Sources saves, ordinary
browser downloads, and external-extension requests do not trigger delivery.
Private Browsing activity never triggers delivery.

Every payload carries a schema version, the event name, and an ISO 8601
timestamp. All except "test" also carry the browser's download id and the
selected resource URL. "save" carries the containing page URL, page title, and
selected text only where the user chose each. "complete" carries the resolved
download path, which is why a receiver waits for it rather than acting on "save";
the outcome events carry no page context at all. "failed" carries a failure
reason. "test" carries nothing further.

Requests omit credentials and referrers, reject redirects, are never retried, and
response bodies are never read. Save In never receives this data, and endpoint
URLs are not written to its diagnostic log. Firefox 140+ optional data
permissions are requested from the enabling user action and are checked again
before delivery.
```

### Chrome: user-configured webhooks

```text
Webhooks are disabled by default and have no developer-operated endpoint. A user
must enter at least one endpoint, choose which save events report, choose any
optional page fields, and affirmatively enable the feature. The same panel states
the always-sent fields and previews the resulting JSON for every event it would
send.

Endpoints are one per line, up to ten, and each is delivered to independently.
HTTPS is required unless the user also enables the separate "Allow http://
endpoints" setting, which is off by default and exists for an endpoint on a
network the user already trusts.

Delivery follows a save the user asked for. Three events are chosen separately:
"save" when a download starts (off by default), "complete" when it finishes (on
by default), and "failed" when it does not (off by default). The panel's Test
button additionally sends one "test" payload on demand, so an endpoint can be
confirmed before anything else is enabled. Automatic Page Sources saves, ordinary
browser downloads, and external-extension requests do not trigger delivery.
Incognito activity never triggers delivery.

Every payload carries a schema version, the event name, and an ISO 8601
timestamp. All except "test" also carry the browser's download id and the
selected resource URL. "save" carries the containing page URL, page title, and
selected text only where the user chose each. "complete" carries the resolved
download path, which is why a receiver waits for it rather than acting on "save";
the outcome events carry no page context at all. "failed" carries a failure
reason. "test" carries nothing further.

Requests omit credentials and referrers, reject redirects, are never retried, and
response bodies are never read. Save In never receives this data, and endpoint
URLs are not written to its diagnostic log.
```

### Chrome: agent access through WebMCP

```text
Agent access is disabled by default and is labelled Experimental in Options. It
registers Save In's tools on Chrome's WebMCP origin trial
(document.modelContext) so an in-browser agent can call the same operations the
options page already performs: read the schema, routing vocabulary, and saved
configuration, validate or apply configuration, and start a routed download.

Two limits are deliberate and enforced in code. The tools exist only while the
options page is open — closing it unregisters them. And an agent cannot turn
agent access on or off: that switch is refused to the tools, so only the user can
grant or revoke it.

This is full access to Save In's own configuration by design, including approved
extension IDs and webhook endpoints, and that is disclosed in the listing and
PRIVACY.md rather than narrowed after the fact. Save In adds no separate consent
prompt; the browser and the agent own access and confirmation, and data an agent
receives is subject to their policies. Where document.modelContext is absent the
integration registers nothing.
```

### Chrome: on-device rule assistant

```text
The rule assistant is disabled by default, is labelled Experimental in Options,
and exists only to help write Save In's own routing rules. It uses Chrome's
built-in Prompt API (on-device Gemini Nano). There is no developer-operated
service and no API key.

Enabling it can ask Chrome to download the model, which Chrome performs and
caches; Save In neither hosts nor bundles model weights, and ships no remote
code. Inference then runs on the device: no network request follows, and no
prompt content leaves the machine. The assistant is Chrome-only — every entry
point feature-detects the API, so on a browser without it the panel stays
unavailable and rule authoring is unchanged.

What is sent to the model is the user's own request text plus the rule
vocabulary. The model is never asked to write routing syntax: it answers a
response schema describing what the user asked for, Save In assembles the rule
text itself, and nothing reaches the rules editor until deterministic guardrails,
the extension's own validation, and the user's review all agree.
```

## Maintenance

Before each upload:

1. Check the store summary against each store's limit before pasting: Chrome
   truncates at 132 characters and AMO at 250, and the summary is written to the
   shorter one.
1. Compare both descriptions with `manifest.json`, `PRIVACY.md`, and the current
   browser-specific behavior documented in `AGENTS.md`.
2. Update the version, review date, minimum browser versions, feature list, and
   release note.
3. Confirm the listing links, screenshots, permission explanations, and
   data-use declarations using `docs/release/workflow.md`.
4. Paste the descriptions into the stores as plain text and check their rendered
   formatting before submission.

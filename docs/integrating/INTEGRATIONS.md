# Save In integrations

This document is the source-controlled contract for the shipped external
Download API, the external request to open the in-page destination picker,
externally available read-only configuration discovery and validation messages, same-extension configuration tools, and experimental
WebMCP tools. The
[Integrations wiki](https://github.com/gyng/save-in/wiki/Integrations) is the
user-facing guide and recipe collection; if its protocol details differ, this
document is authoritative.

For the in-product setup workflow, safety controls, matching semantics, and
legacy-setting migration, see [Automatic source saves](../using/AUTOMATIC-SOURCE-SAVES.md).

External Download API v1, including its externally exposed read-only discovery
and validation messages, remains backward compatible within the declared
version. Callers should negotiate capabilities with `PING` and ignore unknown
response fields. The same-extension `GET_CONFIG` and `APPLY_CONFIG` messages
are internal and may gain fields as the options schema evolves. WebMCP is
experimental and may change with the browser API.

Copy-and-paste recipes are available for [Foxy Gestures](https://github.com/gyng/save-in/wiki/Integrations#foxy-gestures), [Gesturefy](https://github.com/gyng/save-in/wiki/Integrations#gesturefy), and [Tridactyl](https://github.com/gyng/save-in/wiki/Integrations#tridactyl). Extension authors should use the separate [extension integration guide](https://github.com/gyng/save-in/wiki/Extension-integration-guide).

## Extension IDs

Extension IDs are platform-specific.

- Chrome Web Store: `jpblofcpgfjikaapfedldfeilmpgkedf`
- Firefox: `{72d92df5-2aa0-4b06-b807-aa21767545cd}`

The options page shows the ID for the installed build. External callers must use the ID for their current browser.

## External Download API v1

Only other extensions can call `runtime.sendMessage(extensionId, …)`; ordinary web pages and userscripts do not automatically gain cross-extension messaging privileges.

Before an extension can start a download, paste its exact runtime ID under **Advanced → External integrations → Approved extensions** and select **Allow**. This is the calling extension's ID, not Save In's destination ID; an integration can display its own `runtime.id` to help the user configure it. Approved IDs are shown as removable rows, with the legacy line editor available under **Advanced: edit IDs as text** for bulk changes. The allowlist is empty by default. `PING`, `GET_SCHEMA`, `GET_KEYWORDS`, `GET_GRAMMARS`, and `VALIDATE` remain available for discovery, but `DOWNLOAD` returns `UNAUTHORIZED` until the caller is explicitly allowed. A caller can check for the `sender_allowlist` capability to detect this policy.

Discover capabilities first:

```js
const response = await browser.runtime.sendMessage(SAVE_IN_ID, { type: "PING" });
// { type: "PONG", body: { version: 1, capabilities: [...] } }
```

Start a routed download:

```js
const response = await browser.runtime.sendMessage(SAVE_IN_ID, {
  type: "DOWNLOAD",
  body: {
    version: 1,
    url: "https://example.com/photo.jpg",
    comment: "gesture",
    info: {
      pageUrl: "https://example.com/gallery",
      srcUrl: "https://example.com/photo.jpg",
      linkText: "Open photo",
      linkTitle: "View full-size photo",
      linkDownload: "original-photo.jpg",
      selectionText: "optional",
      suggestedFilename: "photo.jpg",
      mime: "image/jpeg",
      mediaType: "image",
      sourceKind: "image",
    },
  },
});
```

An extension with a static cross-add-on command can ask Save In to resolve the active tab instead of supplying a URL:

```js
const response = await browser.runtime.sendMessage(SAVE_IN_ID, {
  type: "DOWNLOAD",
  body: { version: 1, target: "activeTab", comment: "my-extension" },
});
```

An explicit `url` takes precedence if both fields are present. For `target: "activeTab"`, Save In prefers the originating tab when the message came from a tab; otherwise it queries the active tab in the last-focused browser window. A private active tab is never resolved: the request fails with the same `BAD_REQUEST` as a missing active tab, so the response reveals neither the private URL nor that a private window has focus. Check for the `active_tab` capability returned by `PING` before using this target.

Accepted URL schemes are `http`, `https`, `ftp`, `data`, and `blob`. A `blob` URL is accepted only from a message sent by a tab, or as the page of a resolved `activeTab`; a background-context caller's `blob` URL fails with `INVALID_URL`. An explicit-URL request sent without a tab is never attributed to a private tab, even when one was last focused. The `url` echoed in the response is the WHATWG-canonical form of the requested URL, which may differ from the caller's spelling — correlate requests yourself rather than string-comparing the echo. A successful response acknowledges a well-formed request from an authorized caller, not a completed — or even started — save: routing may still exclude the item or skip it as unmatched, and download failures surface asynchronously in History/notifications.

`linkText`, `linkTitle`, and `linkDownload` are independent optional routing
inputs. The latter two correspond to an HTML anchor's `title` and `download`
attributes; Save In does not reinterpret `linkText` as either attribute.

Download errors are `UNAUTHORIZED`, `BAD_REQUEST`, or `INVALID_URL`; unknown external message types return `UNKNOWN_TYPE`. `OPEN_PICKER` adds `UNAVAILABLE`, described [below](#opening-the-destination-picker). Treat `UNAUTHORIZED` as a request for user configuration, not as a transient error to retry repeatedly.

For a non-private `UNAUTHORIZED` request with a browser-authenticated caller ID, Save In shows a native notification. Clicking it opens Options. **Advanced → External integrations → Pending approval** lists up to 20 rejected caller IDs with their attempt count, request kind, and last-seen time; selecting **Approve** appends that exact ID to the approved list and clears the rejection. Save In does not retain the rejected URL. Private-window rejections are neither recorded nor notified.

The browser may deliver external messages from any installed extension, but Save In checks `sender.id` against the user's allowlist before resolving an active tab or starting a download. Allow only extensions you trust with those capabilities.

There is no `externally_connectable` declaration, so web pages cannot call Save In directly. A userscript needs a narrowly scoped companion extension or another explicit relay; do not expose a general page-to-extension forwarding bridge.

## Opening the destination picker

`OPEN_PICKER` asks Save In to show its in-page destination picker instead of
saving at once: a small list of the user's Save menu folders, drawn over the
page, from which the user picks where the item goes. It suits a gesture or
keyboard extension whose user wants to choose a folder each time. Nothing is
saved until the user picks; pressing Esc or clicking elsewhere cancels. Check
for the `open_picker` capability returned by `PING` before using it.

The picker is opt-in at every entry point. It does not replace the browser
context menu, and Save In never opens it unless the user binds its command,
turns on the click-to-save setting, or allows an extension that sends this
message.

```js
// For what the pointer is over in the tab, or else the page:
const response = await browser.runtime.sendMessage(SAVE_IN_ID, {
  type: "OPEN_PICKER",
  body: { version: 1 },
});

// For a named address:
await browser.runtime.sendMessage(SAVE_IN_ID, {
  type: "OPEN_PICKER",
  body: { version: 1, url: "https://example.com/photo.jpg", kind: "image" },
});
// { type: "OPEN_PICKER", body: { status: "OK", version: 1 } }
```

- `url` is optional. Without it, Save In asks the page what the pointer is
  over: an image, video, audio element, or link in the top frame. Anything
  else opens the picker for the page itself.
- `kind` describes a supplied `url`: `image`, `video`, `audio`, or `link`
  (the default). It decides whether the save is treated as media or as a link,
  exactly as the context menu distinguishes them, so routing rules that match
  on media type see the same value. A `link` is refused with `BAD_REQUEST`
  while the user has link saving turned off.
- The picker opens in the tab the message came from, or in the active tab of
  the last-focused window when the sender has no tab, as a background-context
  caller does not.
- `OPEN_PICKER` needs the same approval as `DOWNLOAD`: an extension that is not
  on the allowlist receives `UNAUTHORIZED` and appears under **Pending
  approval**.
- It never opens in a private tab for an external caller, whether that tab is
  the active one or the one the message came from. Both fail with the same
  `BAD_REQUEST` as a missing tab, so the response reveals neither a private
  address nor that a private window has focus.
- URL rules match `DOWNLOAD`: `http`, `https`, `ftp`, `data`, and `blob`, with
  `blob` accepted only from a message sent by a tab. An address longer than
  2,097,152 characters fails with `INVALID_URL`.

A successful response means the picker is on screen, not that anything was
saved. Errors are `UNAUTHORIZED`, `BAD_REQUEST` (no usable tab, nothing in the
tab can be saved, or a link while link saving is off), `INVALID_URL`, and
`UNAVAILABLE`. `UNAVAILABLE` means the resolved tab cannot show the picker: a
browser-internal or otherwise restricted page, a site matched under **Disable
Save In on sites**, a tab loaded before Save In was last updated, or a menu
with no destinations to offer.

Choosing a destination saves exactly as choosing that item from the context
menu would: the same routing rules, per-destination Save As, Last used and
recent-location updates, and History. Because it is a menu save and not a
`DOWNLOAD`, no `comment` or other caller-supplied routing input is attached,
and the save's `context:` is the media, link, or page context rather than
`click`.

### Gesturefy recipe

Gesturefy's **Send message to other add-on** command sends a fixed message
from Gesturefy's background, so it cannot name the element a gesture started
on. Save In resolves the element under the pointer instead.

1. In Save In, open **Advanced → External integrations → Approved
   extensions** and allow Gesturefy's ID,
   `{506e023c-7f2b-40a3-8066-bc5deb40aebe}`.
2. In Gesturefy, add a gesture with the command **Send message to other
   add-on**.
3. Set **Add-on ID** to `{72d92df5-2aa0-4b06-b807-aa21767545cd}`.
4. Set **Message** to:

   ```json
   { "type": "OPEN_PICKER", "body": { "version": 1 } }
   ```

5. Turn on **Parse message**, so Gesturefy sends the message as an object
   rather than as text.
6. Draw the gesture so that it ends over the image or link to save. The
   picker opens for whatever the pointer is over when the gesture ends, and
   for the page if that is neither media nor a link.

To save without choosing a folder, keep using the existing
`{ "type": "DOWNLOAD", "body": { "target": "activeTab" } }` recipe.

## Config messages

- `GET_SCHEMA` returns option names, types, defaults, and descriptions.
- `GET_KEYWORDS` returns path variables, routing matchers and actions, automatic-routing matchers and context, and supported source kinds.
- `GET_GRAMMARS` returns the EBNF, semantic constraints, option name, and examples for the directory and unified routing languages.
- `VALIDATE` dry-runs `paths` and/or `filenamePatterns`. It returns structured errors, a menu preview, and optional sample traces without saving.
- `GET_CONFIG` returns the current saved values in apply-ready form. It is same-extension only and unavailable through `onMessageExternal`.
- `APPLY_CONFIG` validates and persists a partial configuration. It is same-extension only and unavailable through `onMessageExternal`.

Unknown options and type mismatches are rejected. Omitted options remain unchanged. Use the default from `GET_SCHEMA` to restore one setting.

Routing validation is fail-closed per rule: a malformed line, unsupported clause, invalid capture reference, absolute or parent destination, or invalid URL template makes that entire rule inert without consuming a later match. `disabled: true` prevents a valid rule from running but does not bypass validation. Empty regex matchers remain compatible match-all conditions but produce `ruleEmptyMatcher`; write `.*` when match-all is intentional. Leading or trailing regex whitespace produces `ruleSuspiciousWhitespace`, and potentially expensive regex structure produces `ruleUnsafeRegex`; these three diagnostics are warnings for local configuration.

A rule has one terminal outcome. A saving rule ends with `into:`. An exclusion
rule ends with `exclude: true`, must contain a matcher, and stops processing
without starting a Save In download. Exclusions may not carry destination,
capture, fetch, rename, or tab-action clauses. For an ordinary browser download
that has already started, exclusion leaves it unchanged rather than cancelling
it. A saving rule may include `after: close-tab`; interactive saves close their source
tab only after the browser accepts the download. Automatic rules reject that
action, and ordinary browser-download routing ignores it because it has no
source tab to act on. A `target: "activeTab"` request explicitly owns that tab
for the action; an explicit-URL request does not close a caller or ambient tab.
`VALIDATE` traces expose `selectedOutcome`,
`selectedTabAction`, and each rule's `outcome`; these fields are additive.

External validation is isolated from Save In's browser state: a trace uses only the sample fields supplied by the caller and never falls back to the active tab. Requests are bounded to 32,768 characters for each editable grammar, 4,096 characters per ordinary sample field, and 8,192 characters per sample URL. Bursts above 20 validation requests per 10 seconds per sender return `RATE_LIMITED`.

External validation runs a deliberately narrower regular-expression grammar than the routing engine itself, because an external trace executes caller-supplied patterns against caller-supplied samples on the background event loop. A rule whose matcher or `rename:` find pattern falls outside that grammar is reported in `ruleErrors` with the offending pattern in `error`, and is inert for that trace — the same treatment any other invalid rule receives. The rest of the request still validates. Such a rule is not rejected by the options page, so a pattern Save In declines to trace here may still be one the engine runs; check it in the route debugger.

Automatic source rules live in `filenamePatterns` and use the same routing AST, matcher vocabulary, validation, and debugger as ordinary routing. They are identified by a `context` clause matching `AUTO` and must include both a page constraint and a source constraint. To validate and trace one against representative input:

For an inline `data:` candidate, Save In uses `download` as the neutral sample filename and skips rules whose output uses payload-derived URL variables or captures `sourceurl:`, `fileext:`, or `urlfileext:`. Validation traces apply the same eligibility rule as execution.

```js
const response = await browser.runtime.sendMessage(SAVE_IN_ID, {
  type: "VALIDATE",
  body: {
    filenamePatterns:
      "context: ^auto$\npagedomain: ^example\\.com$\nsourcekind: ^image$\ninto: Images",
    automaticCandidate: {
      pageUrl: "https://example.com/gallery",
      sourceUrl: "https://cdn.example.com/photo.jpg",
      sourceKind: "image",
    },
  },
});
// body.ruleErrors is [] and body.automaticTrace.selectedRule is 1.
```

An automatic save carries the tab it came from, so a candidate may name that page with `currentTab: { title }`. Rules naming `pagetitle:` or `:pagetitleslug:` trace as an empty title without it.

A rule may also carry one `fetch:` clause: a literal `http://` or `https://` URL template that Save In downloads from instead of the matched source once the rule wins, while `into:` keeps setting the destination. `VALIDATE` reports violations in `ruleErrors[].message`: `ruleExtraFetch` (a rule has more than one `fetch:` clause), `ruleFetchNotHttp` (the template is not a usable literal http(s) URL), and `ruleFetchUnsupportedVariable` (the template references a variable that would fetch the URL being replaced, such as `:mime:` or `:sha256:`). If expansion does not produce a usable HTTP(S) URL, the selected save fails rather than downloading the original source under the rewritten route. Rules carrying `fetch:` are skipped by ordinary-browser-download routing, which can only rename a download, not redirect it to a different URL; the first matching rule without `fetch:` applies there instead.

A rule may also carry one `rename:` clause written as `find -> replacement`, split on the first raw ` -> ` sequence. `find` is a regular expression in the matcher dialect (flags follow the clause name, for example `rename/gi:`), and `replacement` is literal text in which routing variables and capture references expand; an empty replacement deletes matches. The transform edits the final filename component after the name fully resolves — including any `fetch:` rewrite — and before length limits; the directory part is never parsed, and separators a replacement introduces are sanitized as ordinary filename characters. A pattern that needs a literal ` -> ` writes it with regex escapes (for example `\x20->`) so the raw clause text never contains the separator. `VALIDATE` reports `ruleRenameMissingSeparator` (no ` -> ` separator), `ruleExtraRename` (more than one `rename:` clause), `ruleInvalidRegex` (the find pattern or flags do not compile), `ruleUnknownDestinationVariable` (an unknown variable in the replacement), and `ruleMissingCapture` (a capture reference without a usable capture clause). Unlike `fetch:`, ordinary `rename:` rules stay eligible for ordinary-browser-download routing when their output can resolve without reading file content. Rules whose `into:` destination or `rename:` replacement uses `:sha256:` or `:sha256full:` are skipped for downloads already in flight: hashing would require Save In to fetch and buffer the browser-owned download a second time. Hash variables remain available to downloads started through Save In's normal pipeline.

An exclusion rule uses `exclude: true` instead of `into:` and must contain at
least one matcher. It cannot contain `capture:`, `capturegroups:`, `fetch:`,
`rename:`, `after:`, or `into:`. A matching exclusion is terminal: Save In does
not start the requested save and does not evaluate later rules. In ordinary
browser-download routing it leaves the browser-owned download unchanged while
still preventing later Save In routing rules from adopting it. Automatic
exclusions retain the normal explicit context, page, and source requirements
and do not consume the per-page save limit.

A save rule may carry `after: close-tab`. Once that rule wins and the browser accepts
the Save In download, the extension closes the source tab. The action does not
run for a skipped or failed save, and an explicit per-menu-item tab action takes
precedence. Automatic rules reject `after: close-tab`; ordinary browser downloads do
not expose a source tab for this action.

An external explicit-URL `DOWNLOAD` request never executes `after: close-tab`:
allowing another extension grants it download access, not authority over the
caller's ambient tab. A `target: "activeTab"` request is the exception — the
saved tab is the caller's own sender tab or, for a background-context caller,
the user's active tab resolved when the request arrives, and a matching
`after: close-tab` rule may close it. The close still verifies the tab's URL
is the one that was saved before acting.

Check for the `vocabulary`, `grammar`, and `automatic_routing_validation` capabilities before using these additive API v1 features. Older callers can ignore the new capability and response fields.

`autoDownloadRules` remains accepted as a legacy configuration field. The
extension migrates valid stored legacy rules into `filenamePatterns`; new tools
and generated configurations should write unified routing rules directly.

## WebMCP

WebMCP is an experimental browser API currently distributed through a Chrome
origin trial. Its API and availability may change; see the
[Chrome WebMCP documentation](https://developer.chrome.com/docs/ai/webmcp).
When a compatible in-browser WebMCP context is available, the open options page
registers seven tools:

| Tool | Mutation | Purpose |
| --- | --- | --- |
| `save_in_get_schema` | No | Read option names, types, defaults, and descriptions |
| `save_in_get_config` | No | Read current saved values in apply-ready form |
| `save_in_list_vocabulary` | No | Read variables, matchers, and source kinds |
| `save_in_get_grammars` | No | Read the two supported config grammars |
| `save_in_validate_config` | No | Dry-run paths/rules and optional sample matches |
| `save_in_apply_config` | Yes | Validate and apply a partial configuration |
| `save_in_download` | Yes | Start one routed download |

Recommended agent flow:

1. `save_in_get_schema`
2. `save_in_get_config`
3. `save_in_list_vocabulary`
4. `save_in_get_grammars`
5. `save_in_validate_config`
6. Correct every reported error
7. `save_in_apply_config`

Tools exist only while the options page is open and the browser provides WebMCP. Inputs may contain untrusted page data; tool annotations distinguish read-only and mutating operations.
`save_in_get_config` returns the complete saved configuration, including text settings such as destinations, routing rules, approved extension IDs, and webhook details. It does not add a Save In-specific consent step. Mutating tools remain marked with `readOnlyHint: false` so the agent or browser can apply its normal confirmation policy.
`save_in_apply_config` applies every valid key and reports invalid keys separately, so a mixed request can partially succeed. Read the returned `applied` and `rejected` lists before continuing.

## Webhooks

Webhooks are an optional, user-configured notification for Save In downloads.
They are disabled by default. Only non-private downloads started by a direct
Save In command are eligible. Ordinary browser downloads, automatic Page Sources
saves, external Download API requests, private-window activity, failed
preparations, and rejected downloads never send one. Webhook failure never
changes the download result, and Save In does not retry delivery.

Each eligible download can send a start event and one outcome event, each
separately enabled in Options:

- `save` (off by default) once the browser accepts the download.
- `complete` (on by default) when it finishes, with the saved `path`.
- `failed` (off by default) when it fails for good, with the browser's error
  as `reason`. A download the user cancels sends nothing. A network or server
  failure that Save In retries through a background fetch sends no `failed`
  event; the retry's own outcome is reported instead.

Every event about one download carries the same `id`, including the outcome of
a retried download, so a receiver can match them up.

The endpoint must be a direct HTTPS URL without embedded username/password
credentials or a fragment; an explicit, off-by-default option also accepts plain
`http://` endpoints. Save In sends a `POST` with `Content-Type:
application/json`, omits cookies and browser credentials, supplies no referrer,
and rejects redirects. It checks only the HTTP status and never reads the
response body.

Save payload version 1 always contains:

```json
{
  "version": 1,
  "event": "save",
  "timestamp": "2026-07-14T10:00:00.000Z",
  "id": 42,
  "url": "https://cdn.example.com/image.jpg"
}
```

The user can separately add `pageUrl`, `pageTitle`, and `selectionText` to the
save event in Options. The `complete` and `failed` events carry `version`,
`event`, `timestamp`, `id`, and `url`, plus `path` or `reason`. For a save whose
own URL is an inline `data:` or `blob:` payload, every event's `url` is the
containing page's URL instead. No other local paths, cookies, persistent
identifiers, diagnostics, or other browser state are added. **Send test** uses
the same transport but sends only `version`, `event: "test"`, and `timestamp`.

## Downloader hand-offs

Save In deliberately does not adopt downloads initiated by another extension. A cooperating downloader can call the Download API before starting its own workflow. For HLS/DASH sources, Page Sources can copy the media URL for use with `yt-dlp` as a local hand-off without adding native-messaging permissions or constructing executable shell text.

The [extension integration guide](https://github.com/gyng/save-in/wiki/Extension-integration-guide) covers capability negotiation, metadata, batches, ownership, and direct-media limitations.

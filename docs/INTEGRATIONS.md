# Save In integrations

This document is the source-controlled contract for the shipped external
Download API, externally available read-only configuration discovery and
validation messages, same-extension configuration tools, and experimental
WebMCP tools. The
[Integrations wiki](https://github.com/gyng/save-in/wiki/Integrations) is the
user-facing guide and recipe collection; if its protocol details differ, this
document is authoritative.

For the in-product setup workflow, safety controls, matching semantics, and
legacy-setting migration, see [Automatic source saves](AUTOMATIC-SOURCE-SAVES.md).

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

An explicit `url` takes precedence if both fields are present. For `target: "activeTab"`, Save In prefers the originating tab when the message came from a tab; otherwise it queries the active tab in the last-focused browser window. Check for the `active_tab` capability returned by `PING` before using this target.

Accepted URL schemes are `http`, `https`, `ftp`, `data`, and `blob`. A successful response means the save was accepted, not completed. Completion appears asynchronously in History/notifications.

Download errors are `UNAUTHORIZED`, `BAD_REQUEST`, or `INVALID_URL`; unknown external message types return `UNKNOWN_TYPE`. Treat `UNAUTHORIZED` as a request for user configuration, not as a transient error to retry repeatedly.

For a non-private `UNAUTHORIZED` request with a browser-authenticated caller ID, Save In shows a native notification. Clicking it opens Options. **Advanced → External integrations → Pending approval** lists up to 20 rejected caller IDs with their attempt count, request kind, and last-seen time; selecting **Approve** appends that exact ID to the approved list and clears the rejection. Save In does not retain the rejected URL. Private-window rejections are neither recorded nor notified.

The browser may deliver external messages from any installed extension, but Save In checks `sender.id` against the user's allowlist before resolving an active tab or starting a download. Allow only extensions you trust with those capabilities.

There is no `externally_connectable` declaration, so web pages cannot call Save In directly. A userscript needs a narrowly scoped companion extension or another explicit relay; do not expose a general page-to-extension forwarding bridge.

## Config messages

- `GET_SCHEMA` returns option names, types, defaults, and descriptions.
- `GET_KEYWORDS` returns path variables, routing matchers, automatic-routing matchers and context, and supported source kinds.
- `GET_GRAMMARS` returns the EBNF, semantic constraints, option name, and examples for the directory and unified routing languages.
- `VALIDATE` dry-runs `paths` and/or `filenamePatterns`. It returns structured errors, a menu preview, and optional sample traces without saving.
- `APPLY_CONFIG` validates and persists a partial configuration. It is same-extension only and unavailable through `onMessageExternal`.

Unknown options and type mismatches are rejected. Omitted options remain unchanged. Use the default from `GET_SCHEMA` to restore one setting.

External validation is isolated from Save In's browser state: a trace uses only the sample fields supplied by the caller and never falls back to the active tab. Requests are bounded to 32,768 characters for each editable grammar, 4,096 characters per ordinary sample field, and 8,192 characters per sample URL. Unsafe nested-repetition regular expressions return `BAD_REQUEST`; bursts above 20 validation requests per 10 seconds per sender return `RATE_LIMITED`.

Automatic source rules live in `filenamePatterns` and use the same routing AST, matcher vocabulary, validation, and debugger as ordinary routing. They are identified by a `context` clause matching `AUTO` and must include both a page constraint and a source constraint. To validate and trace one against representative input:

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
They are disabled by default. A webhook is sent once after the browser accepts a
non-private download started by a direct Save In command. Ordinary browser
downloads, automatic Page Sources saves, external Download API requests,
private-window activity, failed preparations, and rejected downloads do not
trigger one. Webhook failure never changes the download result, and Save In
does not retry delivery.

The endpoint must be a direct HTTPS URL without embedded username/password
credentials or a fragment. Save In sends a `POST` with `Content-Type:
application/json`, omits cookies and browser credentials, supplies no referrer,
and rejects redirects. It checks only the HTTP status and never reads the
response body.

Save payload version 1 always contains:

```json
{
  "version": 1,
  "event": "save",
  "timestamp": "2026-07-14T10:00:00.000Z",
  "url": "https://cdn.example.com/image.jpg"
}
```

The user can separately add `pageUrl`, `pageTitle`, and `selectionText` in
Options. Local destination paths, cookies, persistent identifiers, diagnostics,
and other browser state are never added. **Send test** uses the same transport
but sends only `version`, `event: "test"`, and `timestamp`.

## Downloader hand-offs

Save In deliberately does not adopt downloads initiated by another extension. A cooperating downloader can call the Download API before starting its own workflow. For HLS/DASH sources, Page Sources can copy the media URL for use with `yt-dlp` as a local hand-off without adding native-messaging permissions or constructing executable shell text.

The [extension integration guide](https://github.com/gyng/save-in/wiki/Extension-integration-guide) covers capability negotiation, metadata, batches, ownership, and direct-media limitations.

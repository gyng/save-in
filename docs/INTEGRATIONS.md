# Save In integrations

This document describes the shipped external Download API, internal configuration messages, and experimental WebMCP tools. The user-facing version is the [Integrations wiki](https://github.com/gyng/save-in/wiki/Integrations).

Copy-and-paste recipes are available for [Foxy Gestures](https://github.com/gyng/save-in/wiki/Integrations#foxy-gestures), [Gesturefy](https://github.com/gyng/save-in/wiki/Integrations#gesturefy), and [Tridactyl](https://github.com/gyng/save-in/wiki/Integrations#tridactyl). Extension authors should use the separate [extension integration guide](https://github.com/gyng/save-in/wiki/Extension-integration-guide).

## Extension IDs

Extension IDs are platform-specific.

- Chrome Web Store: `jpblofcpgfjikaapfedldfeilmpgkedf`
- Firefox: `{72d92df5-2aa0-4b06-b807-aa21767545cd}`

The options page shows the ID for the installed build. External callers must use the ID for their current browser.

## External Download API v1

Only other extensions can call `runtime.sendMessage(extensionId, …)`; ordinary web pages and userscripts do not automatically gain cross-extension messaging privileges.

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

The external listener accepts requests from any installed extension. It validates message shape and URL scheme but does not allowlist senders. Installing extensions is the trust boundary.

There is no `externally_connectable` declaration, so web pages cannot call Save In directly. A userscript needs a narrowly scoped companion extension or another explicit relay; do not expose a general page-to-extension forwarding bridge.

## Config messages

- `GET_SCHEMA` returns option names, types, defaults, and descriptions.
- `VALIDATE` dry-runs `paths` and/or `filenamePatterns` and returns structured errors and a menu preview.
- `GET_KEYWORDS` returns the registered variables and matcher clauses.
- `APPLY_CONFIG` validates and persists a partial configuration. It is same-extension only and unavailable through `onMessageExternal`.

Unknown options and type mismatches are rejected. Omitted options remain unchanged. Use the default from `GET_SCHEMA` to restore one setting.

## WebMCP

When a compatible in-browser WebMCP context is available, the open options page registers five tools:

| Tool | Mutation | Purpose |
| --- | --- | --- |
| `save_in_get_schema` | No | Read option schema and current values |
| `save_in_list_vocabulary` | No | Read variables and matchers |
| `save_in_validate_config` | No | Dry-run paths/rules and optional sample data |
| `save_in_apply_config` | Yes | Validate and apply a partial configuration |
| `save_in_download` | Yes | Start one routed download |

Recommended agent flow:

1. `save_in_get_schema`
2. `save_in_list_vocabulary`
3. `save_in_validate_config`
4. Correct every reported error
5. `save_in_apply_config`

Tools exist only while the options page is open and the browser provides WebMCP. Inputs may contain untrusted page data; tool annotations distinguish read-only and mutating operations.

## Downloader hand-offs

Save In deliberately does not adopt downloads initiated by another extension. A cooperating downloader can call the Download API before starting its own workflow. For HLS/DASH sources, Page Sources can copy a `yt-dlp` command as a local hand-off without adding native-messaging permissions.

The [extension integration guide](https://github.com/gyng/save-in/wiki/Extension-integration-guide) covers capability negotiation, metadata, batches, ownership, and direct-media limitations.

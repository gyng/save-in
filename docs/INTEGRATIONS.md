# save-in — integrations

How other tools drive save-in today, and what the options page could add to
make integrations (including AI-assisted configuration) easier. Status: the
"Today" sections describe shipped behaviour; "Proposed" sections are design
notes, not commitments.

---

## 1. The external download API — v1 (supported)

save-in listens on `browser.runtime.onMessageExternal`, so any other extension
can ask it to save a URL. This is how [Foxy
Gestures](https://github.com/gyng/save-in/wiki/Integrations) drives
it. As of v4.0.0 this is a **versioned, supported contract** (issue #110), not
an unofficial hook — see `src/messaging.js`.

### Discover the version first — `PING`

```js
const ID = "{72d92df5-2aa0-4b06-b807-aa21767545cd}"; // manifest.json gecko id
const pong = await browser.runtime.sendMessage(ID, { type: "PING" });
// pong === { type: "PONG", body: { version: 1, capabilities: [
//   "download", "ping", "routing", "comment", "info" ] } }
```

Negotiate against `body.version` / `body.capabilities` before sending a
`DOWNLOAD`. A `PING` to an old build (which doesn't know the type) rejects or
returns undefined — treat that as "version 0, DOWNLOAD-only".

### Save a URL — `DOWNLOAD`

```js
const res = await browser.runtime.sendMessage(ID, {
  type: "DOWNLOAD",
  body: {
    url: "https://example.com/pic.jpg", // required: what to save
    version: 1,                          // optional: pin the API version
    comment: "foo",                      // optional: matched by comment: rules
    info: {
      pageUrl: "https://example.com/",   // optional: :pageurl:, pagedomain rules
      srcUrl: "https://example.com/pic.jpg", // optional: :sourceurl:
      selectionText: "…",                // optional: :selectiontext:
    },
  },
});
```

**Response contract:**

```js
// success
{ type: "DOWNLOAD", body: { status: "OK", version: 1, url: "…" } }
// failure (typed)
{ type: "DOWNLOAD", body: { status: "ERROR", error: "INVALID_URL", message: "…", version: 1 } }
```

`error` is one of `BAD_REQUEST` (malformed message, e.g. missing `url`),
`INVALID_URL` (not an `http(s)`/`ftp`/`data`/`blob` URL), or `UNKNOWN_TYPE` (message
type the running version doesn't handle). `status: "OK"` is unchanged from
earlier builds, so pre-existing callers keep working; `version`/`url` are
additive.

The download then flows through the **same pipeline as a context-menu save** —
routing rules, `:variables:`, the Referer feature, the auto-retry fallback,
history, and notifications all apply. `context` is set to `CLICK`. **What it
inherits from the last save**: only the last used *directory* plus
`comment`/`menuIndex` (so routing still matches) — never the prior download's
filename or route.

**Constraints worth knowing for integrators:**

- The extension id above is stable; get it from `manifest.json`
  (`browser_specific_settings.gecko.id` on Firefox; the Web Store id on Chrome).
- There is no `externally_connectable` block, so **web pages cannot message
  save-in directly** — only other extensions can. Greasemonkey, Tampermonkey,
  and Violentmonkey scripts do not automatically gain cross-extension
  `runtime.sendMessage` access from their manager. A userscript therefore needs
  a small companion WebExtension (or another extension with an explicit relay
  API) to forward the request.
- The MV3 service worker may be asleep; `sendMessage` wakes it. No prewarm is
  needed for external messages (unlike the content-script click path).
- **Trust model:** `onMessageExternal` accepts from **any** installed
  extension, and a `DOWNLOAD` triggers a save. save-in validates the URL scheme
  (`http`/`https`/`ftp`/`data`/`blob` only, so a caller can't make it fetch
  `javascript:`/`file:`) but does not otherwise allowlist senders. Treat the
  ability to install an extension as the trust boundary.
- The `OK` response acknowledges that the save was **accepted and started**, not
  that the file landed — the pipeline is async. Watch the History tab (or a
  future `DOWNLOADED` push) for completion.

### Foxy Gestures and other extensions

Foxy Gestures can place the `DOWNLOAD` message above in a user script command.
For any other WebExtension, add Save In's extension ID to its configuration,
send `PING` once per browser session, then send `DOWNLOAD` when the gesture,
toolbar action, or context-menu command fires. Firefox uses the stable Gecko ID
shown above; Chrome callers should use the installed Web Store ID shown in Save
In's **More options → External integrations** section.

### Userscript relay shape

If a page userscript is essential, keep the privileged part in a tiny companion
WebExtension. The content script accepts a narrowly validated page event, sends
`DOWNLOAD` to Save In from its extension context, and returns only the typed
result. Allowlist origins and require `https:` URLs; do not expose an unrestricted
page-to-extension forwarding bridge. The userscript itself cannot call Save In
directly in a standard Firefox or Chrome installation.

## 2. Import / export (today)

More Options → **Export Settings** / **Import Settings** round-trips the whole
options object as JSON. This is the supported way to move a configuration
between machines or profiles, and the basis for programmatic configuration
(see §4).

---

## 3. Proposed: make the options page integration-friendly

Small, additive changes that would turn the two implicit surfaces above into a
documented, discoverable API — without a build step or new permissions.

1. ~~**Version the external API + add a capability ping.**~~ **Done (v1).**
   `{ type: "PING" }` → `{ type: "PONG", body: { version, capabilities } }`,
   and `DOWNLOAD` now returns `{ status: "OK", version, url }` or a typed
   `{ status: "ERROR", error, message, version }` (see §1).
2. ~~**A "Connected apps / API" section in the options page.**~~ **Done.**
   More Options → **Developer / External API** shows the live extension id, the
   negotiated version + capabilities, copy-paste `PING`/`DOWNLOAD` snippets with
   the id filled in, and a link to this doc.
3. **`externally_connectable` (opt-in, Chrome).** If we want *web pages* (not
   just extensions) to trigger saves, add an `externally_connectable.matches`
   list. Keep it empty/absent by default — it widens the attack surface — but
   document how a user could add their own origins.
4. **A capabilities registry for downloader hand-offs.** The
   VideoDownloadHelper / yt-dlp story (see `docs/ROADMAP.md`) is really "let an
   external companion accept a URL + our routing decision." The same versioned
   API + a `RESOLVE_PATH` message (return the computed save path for a given
   `info` without downloading) would let a companion app place files exactly
   where save-in's rules say.

---

## 4. AI-assisted configuration (v1)

The options are a **structured schema** (`OptionsManagement.OPTION_KEYS`) with
types and defaults, and the `paths`/`filenamePatterns` grammars are pure and
return structured errors — so an agent can generate a candidate, validate it,
and apply it. Three messages make that a supported flow (all on the versioned
API; `schema`/`validate` are in the `PING` capabilities):

1. **`GET_SCHEMA`** (read-only, external + internal) → `{ version, options: [{
   name, type, default, description }] }`. The agent reads this to know what it
   may set.
2. **`VALIDATE`** (read-only, external + internal) — `{ paths?,
   filenamePatterns? }` → `{ pathErrors, ruleErrors, menuPreview }`, run through
   `buildTree` / `parseRulesCollecting` functions without saving. The
   generate→validate→fix loop lives here.
3. **`APPLY_CONFIG`** (**internal only**) — `{ config: { name: value } }`,
   validated against the schema (unknown keys and type mismatches rejected;
   `onSave` normalises the stored form; load-time `onLoad` validators still
   coerce cross-browser-invalid values). Closes #89. It is deliberately **not**
   reachable from `onMessageExternal` — rewriting a user's config is not
   something an arbitrary extension may do; it's for the options page, WebMCP
   (below), and same-extension automation.

### WebMCP — experimental in-browser AI tools

In a [WebMCP](https://developer.chrome.com/docs/ai/webmcp)-capable Chrome, the
options page registers five tools through `document.modelContext`. For local
development, enable `chrome://flags/#enable-webmcp-testing`, relaunch Chrome,
open Save In's options page, and keep that tab open. The diagnostics section
reports `Active — 5 tools registered` when registration succeeds. The adapter
also retains the deprecated `navigator.modelContext` fallback for older origin
trial builds and no-ops in browsers without either surface.

| Tool | Purpose | Input |
| --- | --- | --- |
| `save_in_get_schema` | Read all configurable options, types, defaults, and descriptions | `{}` |
| `save_in_list_vocabulary` | Read path/filename variables and routing matchers | `{}` |
| `save_in_validate_config` | Dry-run paths and rules; optionally return a per-rule trace | `{ paths?, filenamePatterns?, info? }` |
| `save_in_apply_config` | Validate and store a partial configuration | `{ config: { optionName: value } }` |
| `save_in_download` | Run a URL through normal routing and renaming | `{ url, pageUrl?, comment? }` |

The recommended agent flow is schema → vocabulary → validate → apply. For
example, *"file JPEGs under `gallery/:sourcedomain:`"* can be validated with:

```json
{
  "filenamePatterns": "fileext: jpg\ninto: gallery/:sourcedomain:/:filename:",
  "info": {
    "srcUrl": "https://example.test/photo.jpg",
    "filename": "photo.jpg",
    "pageUrl": "https://example.test/gallery"
  }
}
```

Use `srcUrl` for `fileext` traces; use the `urlfileext` matcher when only `url`
is available. Always inspect `pathErrors` and `ruleErrors` before applying.
`APPLY_CONFIG` is partial: omitted keys are unchanged, not deleted. To restore
an option, apply the default returned by `save_in_get_schema`.

When debugging manually with `document.modelContext.executeTool`, pass the
arguments as a JSON string. Chrome may return structured tool results as a JSON
string as well, so callers should accept either a decoded value or JSON text.

The API remains experimental and subject to change. Today the tools exist only
while the options page is open; exposing `save_in_download` on arbitrary pages
would require a main-/isolated-world message bridge.

**Guardrails that already exist and should be kept:**

- Every routing rule is validated (invalid regex → whole rule dropped, not
  match-everything; `into:` must end in a filename).
- Path validation rejects `..`, absolute paths, and OS-reserved names.
- Import never widens permissions — options can't grant host access.

**What an agent still can't (and shouldn't) do:** create the symlink needed to
save outside the downloads directory (OS-level), or install a native companion
for yt-dlp. Those stay manual by design.

---

## 5. Related: editor ergonomics (syntax highlighting, cursor intellisense)

Not integrations per se, but the same grammars power them. Notes on
feasibility are in the options-page editor code:

- **Syntax highlighting in the textareas** — a `<textarea>` can't render
  colored spans. The standard trick is an overlay: a `<pre>` mirror positioned
  exactly behind a transparent-text textarea, re-tokenised on input, kept in
  sync on scroll. Doable with no dependencies (we already have
  `tokenizeLines` / `parsePath` to tokenise), ~a day of careful
  scroll/resize/caret-alignment work. The risk is alignment drift across fonts
  and wrapping.
- **Cursor-anchored autocomplete** — _done._ `autocomplete.js` now positions
  its dropdown at the caret via the mirror-div technique (`caretCoordinates`:
  clone the field's text up to the caret into a hidden div, read the marker
  span's offset, add the field's on-screen rect, undo the field's scroll). It
  clamps to the viewport and flips above the caret near the bottom edge, and
  works for both the textareas and the single-line quick-add input. The same
  mirror element can serve the highlight overlay below.

Both are pure front-end, no new permissions, and gated behind the same
grammars the routing/preview already use — so they'd stay in sync with the
language automatically.

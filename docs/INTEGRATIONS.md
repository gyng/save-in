# save-in — integrations

How other tools drive save-in today, and what the options page could add to
make integrations (including AI-assisted configuration) easier. Status: the
"Today" sections describe shipped behaviour; "Proposed" sections are design
notes, not commitments.

---

## 1. The external download API — v1 (supported)

save-in listens on `browser.runtime.onMessageExternal`, so any other extension
can ask it to save a URL. This is how [Foxy
Gestures](https://github.com/gyng/save-in/wiki/Use-with-Foxy-Gestures) drives
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
`INVALID_URL` (not an `http(s)`/`ftp`/`data` URL), or `UNKNOWN_TYPE` (message
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
  save-in directly** — only other extensions can. A userscript needs a host
  extension (Tampermonkey/Violentmonkey count) to relay the message.
- The MV3 service worker may be asleep; `sendMessage` wakes it. No prewarm is
  needed for external messages (unlike the content-script click path).
- **Trust model:** `onMessageExternal` accepts from **any** installed
  extension, and a `DOWNLOAD` triggers a save. save-in validates the URL scheme
  (`http`/`https`/`ftp`/`data` only, so a caller can't make it fetch
  `javascript:`/`file:`) but does not otherwise allowlist senders. Treat the
  ability to install an extension as the trust boundary.
- The `OK` response acknowledges that the save was **accepted and started**, not
  that the file landed — the pipeline is async. Watch the History tab (or a
  future `DOWNLOADED` push) for completion.

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

## 4. Proposed: AI-assisted configuration

The options are already a **structured schema** (`OptionsManagement.OPTION_KEYS`
in `src/option.js`) with types and defaults, and the whole config imports/exports
as JSON. That makes save-in unusually amenable to being configured by an AI
agent. What's missing is a safe, documented apply path.

**Why it's a good fit:**

- Options are declarative key/value pairs, not imperative UI state.
- The two hard parts — the `paths` menu syntax and the `filenamePatterns`
  routing rules — are pure, testable grammars (`Menus.buildTree`,
  `Router.parseRules`) that already return structured errors. An agent can
  generate a candidate, and the extension can validate it *before* applying.
- Import/export means "apply a whole config" already works end to end.

**Proposed surface (no new grammar, reuses what exists):**

1. **`VALIDATE` message** — takes `{ paths?, filenamePatterns? }`, runs them
   through `buildTree` / `parseRules`, returns `{ pathErrors, ruleErrors,
   menuPreview }`. An agent (or the options page itself) can check a draft
   without saving. This is literally the `PREVIEW_MENUS` + `CHECK_ROUTES`
   plumbing generalised.
2. **`APPLY_CONFIG` message** — takes a partial options object, validates it
   against the schema (unknown keys rejected, types coerced via the existing
   `onLoad` validators), and applies it. Same guardrails as Import Settings,
   but scriptable and partial.
3. **A schema descriptor** — expose `OPTION_KEYS` (name, type, default, and a
   one-line human description) via a `GET_SCHEMA` message. An agent reads this
   to know what it's allowed to set and how each field behaves. We already send
   `OPTIONS_SCHEMA` internally; this is that, documented and stable.
4. **Options-page affordance** — a "Paste config" box (JSON or a natural-ish
   rule list) that runs `VALIDATE` live and shows the menu preview + errors
   before the user clicks Apply. This is the human-in-the-loop version of the
   agent flow and reuses the preview panes we just built.

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
  `Router.tokenizeLines` / `Menus.parsePath` to tokenise), ~a day of careful
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

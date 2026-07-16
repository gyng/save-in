# Automatic source saves

Save In can automatically save newly discovered page sources through the same
**Routing rules** used for interactive saves. The feature is disabled by
default. Automatic rules live in `filenamePatterns`, appear in **Text** and
**Visual** modes under **Routing rules**, and are marked **Automatic source** in
Visual mode.

## Set up an automatic rule

1. Open **Options → Page Sources → Automatically save page sources**.
2. Choose the safety controls, but leave **Save matches automatically** off
   while preparing the rule.
3. Select **Open routing rules** and switch to **Visual** if needed.
4. Select **Add automation rule**. Save In inserts a disabled starter rule.
5. Replace the example page and source conditions, choose the destination,
   enable the rule, and select **Apply**.
6. Return to Page Sources and enable **Save matches automatically**.

As a shortcut, open a source row's actions and select **Create automatic
rule**. Save In opens a disabled draft in the shared rule editor, scoped to the
page root domain, source root domain, and source kind. Review its destination,
enable it, and select **Apply** before turning on automatic saves.

For example, this rule saves JPEG, PNG, and WebP images discovered on one site:

```text
context: ^auto$
pagedomain: ^gallery\.example\.com$
sourcekind: ^image$
sourceurl/i: \.(?:jpe?g|png|webp)(?:[?#].*)?$
into: automatic/:pagedomain:/
```

The `into:` value uses the normal routing path and variable syntax. A trailing
slash preserves the resolved source filename. Rules can instead rename the file
with variables such as `:filename:`, `:pagedomain:`, or date components.

An automatic rule may also carry a `fetch:` clause. When the rule matches, Save
In downloads from the expanded template instead of the discovered source URL —
for example, to save the original-resolution asset behind a preview the page
linked to — while `into:` still chooses the destination and filename. The
rewrite applies to unattended saves the same way it applies to interactive
ones; see [Integrations](INTEGRATIONS.md#config-messages) for the clause's
syntax and error identifiers.

## Matching rules

Automatic discovery supplies the synthetic routing context `AUTO`. The
`context:` matcher normalizes contexts to lowercase, so the canonical opt-in is:

```text
context: ^auto$
```

Use `context: auto` with page and source conditions to match automatic
downloads. The first matching rule sets the save location.

Save In deliberately ignores ordinary routing rules during automatic discovery,
including broad rules such as `context: .*`. An automatic rule must explicitly
mention `auto` in its context pattern and must contain both:

- a page condition: `pageurl:`, `pagedomain:`, or `pagerootdomain:`; and
- a source condition: `sourceurl:`, `sourcedomain:`, `sourcerootdomain:`,
  `sourcekind:`, `mediatype:`, `fileext:`, or `urlfileext:`.

Invalid automatic rules are rejected by the normal routing validator. Among
valid automatic rules, the first complete match owns the destination. Ordinary
and automatic rules may be interleaved in the same editor without ordinary
rules becoming eligible for unattended saves.

`sourcekind:` uses the shared Page Sources vocabulary: `image`, `video`,
`audio`, `stream`, `document`, and `link`. The automatic page scanner always
queues previewable HTTP(S) image, video, and audio elements. Three further
content options each open one additional discovery channel, all off by
default so pre-4.1 rules keep matching embedded media only until a channel is
turned on:

- **Include media that pages link to** adopts anchors (`<a href>`) the shared
  collector classifies as previewable media — `image`, `video`, or `audio` by
  URL extension. A media anchor flows through with that kind, so a linked
  `.jpg` is queued as `sourcekind: image`.
- **Include linked documents and streams** adopts anchors classified `stream`
  (`.m3u8`/`.mpd`) or `document` (`.pdf`). It turns on anchor discovery on its
  own, so linked documents and streams are adopted whether or not media links
  are also enabled. Plain `link` anchors are never adopted by either option.
- **Include CSS background images** adopts URLs found in computed CSS
  background images; candidates arrive as `sourcekind: image`.
- **Look for streaming-video playlists (HLS/DASH; best effort)** adopts
  HLS/DASH manifest URLs discovered in resource timing; candidates arrive as
  `sourcekind: stream`. Saving one of these matches downloads the manifest
  (playlist) file itself — Save In does not fetch or assemble the segmented
  media the manifest describes.
- **Include inline data: images and media** adopts self-contained `data:`
  URLs — for example an inline `<img src="data:…">` — up to 2 MB each; larger
  ones are skipped and noted in the debug log. A `data:` source is adopted
  through whatever channel discovered it: an inline image is embedded media and
  needs no other channel, while a `data:` anchor still needs its own anchor
  channel to be on. Because a `data:` URL has no path, `fileext:` and
  `urlfileext:` are empty; Save In reads the mediatype from the URL header, so
  `mediatype:`, `mime:`, and `:mimeext:` naming work (a URL with no parseable
  mediatype is treated as `application/octet-stream`). `blob:` URLs are never
  adopted: they cannot be resolved outside the page that created them.

Each channel is gated independently by its own option and by where a
candidate actually came from, not only by its `sourcekind`. A `.m3u8`
discovered as a page anchor is gated by **Include linked documents and
streams**; the same URL discovered as a resource-timing hint is gated by
**Look for streaming-video playlists**. Turning on one of these options never
adopts a kind through a channel it does not gate — for example, enabling only
the playlist option does not adopt a linked `.m3u8` anchor. **Include inline
data: images and media** is a protocol gate layered on top of these channels,
not a fifth channel: it admits `data:` URLs through whichever channel found
them, and its 2 MB cap is enforced both before the source leaves the page and
again in the background.

## Safety controls

- **Save matches automatically** is the master switch and defaults to off.
- **Include sources added after the page loads** keeps watching dynamic pages.
- **Allow in private windows** is a separate opt-in and defaults to off.
- **Include media that pages link to**, **Include linked documents and
  streams**, **Include CSS background images**, **Look for streaming-video
  playlists**, and **Include inline data: images and media** are grouped under
  **Automatic scan coverage**. Each is a separate opt-in and defaults to off;
  when all are off, only HTTP(S) media embedded on the page is adopted.
  **Include inline data: images and media** admits `data:` URLs up to 2 MB
  each; `blob:` URLs are never adopted.
- **Maximum saves per page visit** defaults to 20 and accepts 1–500. Reloading
  the page starts a new visit.
- A source URL is queued once per page visit, and only after a guarded automatic
  rule matches it.

Chrome cannot assign an extension-started download to its Incognito download
context, so an allowed private automatic save may appear in Chrome's regular
download manager. Save In still excludes private activity from its own history,
restart state, debug log, and webhooks.

Automatic source matching itself does not use Declarative Net Request and does
not add another permission. The optional Referer feature may independently use
a temporary, exact `declarativeNetRequestWithHostAccess` rule while Save In
fetches protected metadata or content in either browser.

## Existing settings

Profiles created by the earlier dedicated automation editor stored rules in
`autoDownloadRules`. On load, Save In converts valid legacy rules into
`filenamePatterns`, adds `context: ^auto$`, preserves rule order and enabled
state, and clears the legacy field only after preparing the unified form.
Existing routing rules remain unchanged. Malformed legacy text is retained
instead of being silently discarded.

Exported configurations continue to accept the legacy field for backward
compatibility, but new configurations should put all automatic rules in
`filenamePatterns`.

## Troubleshooting

- If nothing saves, confirm the master switch and the rule's **Enabled** toggle
  are both on, then select **Apply** in the routing editor.
- If the rule is rejected, add an explicit page condition and source condition.
- If initial sources save but later ones do not, enable live discovery.
- If saving stops after several matches, check the per-page maximum and reload
  the page to begin a new visit.
- If a resource never appears, confirm the page exposes a previewable HTTP(S)
  source, or an inline `data:` source under 2 MB with **Include inline data:
  images and media** enabled. `blob:` and page-script-only resources are never
  adopted.

The machine-facing validation and vocabulary contract is documented in
[Integrations](INTEGRATIONS.md#config-messages).

Manual selection, batch saving, and source-row actions are covered in
[Destination and source workflows](DESTINATION-AND-SOURCE-WORKFLOWS.md#page-sources).

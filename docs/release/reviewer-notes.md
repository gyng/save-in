# Reviewer notes

Notes for an AMO or Chrome Web Store reviewer. They explain what Save In does,
why it requests each permission, how to exercise the main flows, and what data
it does and does not handle. Keep this in sync with `manifest.json` and the
[store descriptions](../store/descriptions.md) at each release.

- Version: 4.0.1
- Manifest: MV3, one shared `manifest.json` for Firefox (event page) and Chrome
  (service worker). Minimum Firefox 140, minimum Chrome 123.

## What it does

Save In adds a right-click context menu that saves images, video, audio, links,
selected text, and whole pages into folders inside the browser's own download
folder. Pattern-based rules can sort and rename saves automatically, a Page
Sources panel lists the media a page is built from, and an opt-in integration
can record or route ordinary browser downloads. Everything runs locally; there
is no account and no first-party server.

## Why each permission is requested

- `contextMenus` — the core feature is the right-click "Save In" menu and its
  destination submenu.
- `downloads` — every save is performed through the browser's downloads API so
  the file lands in the user's chosen subfolder of the download directory. The
  optional browser-download integration also reads download events here.
- `declarativeNetRequestWithHostAccess` — used only to set a `Referer` header on
  the extension's own HEAD/GET for a file the user chose to save, when a site
  serves media that requires it. Session-scoped rules are added for the exact
  requested URL (plus up to three redirect hops) and removed immediately after.
  The extension does not use `webRequest` or `webRequestBlocking` and does not
  modify page traffic.
- `storage` — saves the user's settings, routing rules, and local history in
  `storage.local`; transient per-download state and the separate private **Last
  used** destination in `storage.session`. The private destination is removed
  when the final private window closes. The off-by-default **Remember private
  browsing activity** setting permits private saves to use the same local
  activity stores. Local only; nothing is synced or transmitted.
- `notifications` — optional completion/failure notifications for saves.
- `offscreen` (Chrome only) — lends the service worker a DOM so a fetched
  download can become a blob object URL, to hash bytes, and to run the on-device
  Prompt API. Not used on Firefox, whose event page already has a DOM.
- `host_permissions: <all_urls>` and the `<all_urls>` content script — the user
  can right-click media on any site, and the content script provides
  click-to-save and Page Sources discovery. It reads the page's own DOM to list
  saveable sources; it does not exfiltrate page content.

## How to exercise the main flows

1. Right-click any image, link, or the page background → "Save In" → pick a
   folder. The file is saved into that subfolder of the download directory.
2. Open the options page → Routing rules → add a rule (e.g. match file type
   `pdf`, save into `pdfs/`) and use the route debugger to preview a match.
3. Open Page Sources (toolbar action or the shortcut) on a media-rich page to
   list and batch-save its images, video, and audio.
4. Optionally enable Browser routings to record or route downloads the browser
   starts on its own; it is off by default.

## Data collection and privacy

- Firefox `data_collection_permissions`: `required: ["none"]`. The optional
  entries (`browsingActivity`, `websiteActivity`, `websiteContent`) cover only
  local, user-initiated features (routing on the current page/URL, Page Sources
  reading the page, and the opt-in on-device rule assistant). No data leaves the
  device through them.
- No analytics, no telemetry, no remote logging, no account. Settings, rules,
  and history stay in local extension storage.
- Private browsing: `incognito: "spanning"`. By default Save In excludes
  private-window activity from its history, restart state, and debug log. Its
  separate private **Last used** destination survives background sleeps in
  `storage.session` and is removed when the final private window closes. The
  explicit **Remember private browsing activity** option is off by default and
  admits private saves to normal local activity storage; it never enables
  webhooks or browser credentials in private windows. Chrome also keeps a bare,
  non-identifying pending count during a private download handoff so a worker
  restart cannot misclassify it as an ordinary browser download; the count is
  balanced when the handoff returns or expires after ten seconds. Save In's own
  success and failure notifications remain available but omit private filenames,
  paths, URLs, sizes, and media types.
- The optional on-device rule assistant runs Gemini Nano locally (Chrome Prompt
  API); prompts are not sent to any server. Webhooks and the external Download
  API are opt-in integrations the user configures explicitly.

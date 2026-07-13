# 4.0.0

save-in is now a Manifest V3 extension on both Firefox and Chrome (#225,
#227), from a single manifest: Firefox ≥ 121 runs the background as an event
page, Chrome ≥ 123 as a service worker. Thanks @rudolphos for #230 and
testing on Chromium!

- Migrate to Manifest V3; requires Firefox 121+ / Chrome 123+
- Wake the service worker as soon as the click-to-save combo key is held, so
  alt+click saves work reliably on Chrome (thanks @rudolphos, #230)
- Download notifications and filenames now survive the background
  terminating mid-download (session storage tracking)
- The "Set Referer header" option uses Firefox's native downloads headers;
  Chrome does not support it. Empty or invalid filter lines no longer break
  the context menu (#222)
- Click-to-save now falls back to the link under the cursor (respects the
  "links" option), so alt+click on PDF/file links works (#226)
- Page titles in filenames come from the tab that was clicked, fixing wrong
  or mutated titles (#172, #188)
- Download history actually accumulates now (previously only the last entry
  was kept) and is capped at 100 entries
- Click-to-save and external-extension downloads no longer inherit the
  previous download's filename or rename route
- The external DOWNLOAD API is now official and versioned (v1, #110): send
  `{ type: "PING" }` to negotiate the version and capabilities, `DOWNLOAD`
  now returns a typed `OK`/`ERROR` response and validates the URL scheme, and
  Advanced → External integrations shows the extension id, live version, and a
  copy-paste snippet
- New path variables: `:counter:` (atomic, persistent, per-download counter with
  a reset control), `:uuid:`, and `:mime:`/`:contenttype:`/`:mimeext:` (from a
  HEAD request) for naming extensionless URLs
- Scriptable / AI-assisted configuration: `GET_SCHEMA`, `VALIDATE` and (internal)
  `APPLY_CONFIG` messages validate a config against the schema before applying
  (#89), plus an experimental WebMCP adapter that exposes them as AI-agent tools
  on the options page (Advanced → External integrations → WebMCP)
- Reliability: `Variable.applyVariables` is async; concurrent downloads survive a
  service-worker restart without losing notifications (pending counter, per-URL
  filename recovery, per-download Referer rule ids)
- Shortcut files keep their extensions instead of being saved as .txt
  (#161): the download mime now matches the shortcut type
- Server-provided filenames containing a literal % no longer error out and
  fall back to the URL filename
- Empty menu aliases (`alias:` with no value) fall back to the path instead of a blank
  menu item; multi-dash comments are munged consistently
- New session-scoped debug log, viewable at the bottom of the options page
  (#159, #216)
- Options page opens in a tab
- "Fetch via Fetch API" is now available on Chrome too
- Extension-side Fetch and HEAD requests now have an explicit website
  credentials option. New and upgraded profiles omit cookies until the user
  explicitly enables authenticated extension requests.
- Firefox can optionally preserve the originating Container or private cookie
  context for direct downloads. The optional permission selects a cookie store
  without reading or storing cookie values.
- Remove the old content-script fetch path; MV3 cross-origin fetching runs in
  an extension context with host permission
- Waterfox and other Gecko forks are now detected as Firefox, and browser
  detection is synchronous (#186)
- Concurrent downloads (e.g. tab-strip batch saves) no longer misattribute
  filenames, referers, notifications, or history entries to each other
- Download completion/failure notifications survive a service worker
  cold-start (listeners now register synchronously); "Last used" keeps its
  routing metadata across restarts
- New :pagerootdomain: and :sourcerootdomain: variables (#221)
- More new variables: :weekday:, :monthname:, :ampm:, :isoweek:/:week:,
  :pagetitleslug:, :pagetitlesnake:, :sourcepath:, :tld:
- The options page shows a live preview of the context-menu tree as you
  edit the directory list
- Downloads that fail with a network or server error are now retried
  once automatically through a background fetch before reporting failure
  (on by default; "Retry failed downloads in the background" in More
  Options)
- Routing rules got a guided quick-add row (matcher, pattern, destination)
  with variable autocomplete, and a built-in template library with
  one-click starter rules
- The directory list has a Text/Visual editor: the visual mode edits rows
  with indent, drag-to-reorder, alias, and delete controls; both modes
  share a "+ Add" menu (variables with live values, separators, submenu
  lines) and a live menu-tree preview. The rules editor gets the same
  "+ Add" menu (into:/capture: clauses and variables).
- The directory list and routing rules now save explicitly via Apply
  (with a Discard button) instead of autosaving; Apply/Discard light up
  only while there are unsaved edits, and switching tabs or closing the
  page prompts to save or discard. Every other setting still autosaves.
- Options page refresh: full-width tabbed layout, live save indicator in
  the top bar, system font stack, dark-mode fixes
- Filenames are hardened for Windows: control characters, trailing
  dots/spaces, and reserved device names (CON, NUL, ...) are neutralized;
  a broken replacement character can no longer defeat the sanitizer
- Dark-mode last-used menu icon on Firefox (#184); "close tab on save" now
  also applies to page saves (#115)
- Options textareas autosave after you pause typing instead of rebuilding
  the context menu on every keystroke
- Tabbed options page with a refreshed system-font design; fixed a stale
  event-listener leak and a settings-import that never persisted
- A bad routing-rule regex is now dropped instead of matching everything;
  malformed URLs, absent capture groups, and info-less external messages no
  longer abort downloads
- The Firefox-only conflict action is downgraded on Chrome, where
  it silently broke all downloads (#89, #217); a fresh install's default
  Downloads menu item shows a name instead of "." (#213)
- HTML-redirect shortcuts escape the target URL
- - Removed vendored libraries for easier store review: the webextension
    polyfill is a 6-line first-party shim (Chrome minimum raised to 123 for
    promise-capable contextMenus), the options-page autocomplete and l10n are
    small first-party rewrites — this also revives autocomplete, whose event
    wiring had been silently broken. Only readable, credited
    content-disposition.js remains vendored
- Dev: automated Chrome (CDP) and Firefox (RDP) end-to-end smoke tests,
  watch-mode dev loop, 130-test vitest suite, oxlint + oxfmt, web-ext 10,
  npm, CI on Node 24

# 3.7.3

- Firefox settings no longer disabled on the options page when in Firefox (#214)

# 3.7.2

- Fix light mode icon again

# 3.7.1

- Fix invalid default menu configuration
- Now notifies by default for successful downloads
- Fix light mode icon for last used menu item being white
- Refactor context menu creation, might help with #200

# 3.7.0

This update might require a change in your muscle memories. Previously all submenus of the same depth would have their shortcut keys increment even if they had different parents. That's now been fixed. Thanks,
@mfaizsyahmi!

If you want to use your old buggy shortcut again, use the new `(key: <VALUE>)` comment (eg, `menu // (key: 1)`), which will override the automatically-assigned shortcut with `1`.

- Reset accessKey count on every submenu. (#198, #199). Thanks @mfaizsyahmi!
- Add new meta comment to override accessKey
- Use white icon for previous entry in dark mode (#184)
- Add basic history to options page (#159)

It's been difficult getting motivation to work on save-in, especially with the poor code quality, stalled TypeScript changes, and impending v3 manifest changes. Sorry if I've disappointed anyone! I still have grand dreams of rewriting this extension to make it maintainable, but my energy is being and has been sucked up by $DAY_JOB!

# 3.6.0

- Add support for multiple `capture` clauses (#160, @MaddyKakkoHeart)

# 3.5.3

- Add "fetch via Fetch API" option for some incompatible sites (eg, Instagram) (#166)
- Upgrade webextension-polyfill to 0.8.0

# 3.5.2

- Refactor `legacyDownloadInfo` out from code
- Fix some potential bugs with filename and source URL routing
- Fix dashes in aliases breaking download paths (#124)
- Fix separators in submenus not being treated as special directories (#117)
- Fix Click-to-save not working for middle and right mouse buttons (#116)
- Fix text not visible in dark mode (#112)
- Update sv localisation (#119, @Sopor)
- Update vendored mozilla/webextension-polyfill to 0.5

# 3.5.0

- Make options page support dark mode for Firefox (#112)
- Add unofficially (unsupported) onMessageExternal listener for use with other extensions such as Foxy Gestures (#110)
  See wiki at https://github.com/gyng/save-in/wiki/Use-with-Foxy-Gestures

# 3.4.1

- Fix `Referer` header not set in Chrome >= 72 (#66)
- Check if download originates from save-in before renaming download (Chrome, #109)
- Add favicon to options page (#108)

# 3.4.0

- Add option to always prefer links when downloading from pages that match a regex list of URLs (#100)
- Add notification option for when a link is downloaded instead of the source
- Add option to close tabs marked for saving (FF, #68)

# 3.3.0

- Add downloading of multiple highlighted tabs (FF63, #91)
- Enable access keys for Firefox >= 63 (#91)
- Add sv localisation by @Sopor- (#98, #99)

# 3.2.0

- Add option to set `Referer` header on downloads, disabled by default. Should fix errors while downloading for sites that check this, especially pixiv.net in Chrome. Requires new permissions. (#66)

# 3.1.3

- Fix submenus not tracking parent menu item
- Fix submenu items having duplicate IDs

# 3.1.2

- Fix export settings not exporting updated settings after changing them (#83)
- Improve checkmark styling in options page (#84)

# 3.1.1

- Fix neighbouring submenus nesting when they should not

# 3.1.0

- Add nl localisation (Thanks @80486dx, #72)

- Add menu item aliasing (#64)

  To use this, put an `(alias: <display name>)` in the comments for that line. For example:

  ```
  cats // (alias: actually dogs)
  ```

- Add submenu support (#26)

  To use this, add `>`s at the start of the line. For example:

  ```
  submenu
  >mammals
  >>i/cats
  >>i/dogs
  ```

# 3.0.0

- Fix Chrome rules matching against `_`, now matches against special characters instead
- Add variables view to last download in options
- Fix routing failing in some cases (regression) (#80)
- Fix last used access key not working at all (Chrome)

# 2.7.3

- Fix accesskeys not appearing in Chrome (regression) (#79)
- Fix notifications not showing up for alt-clicked images (#78)

# 2.7.2

- Replace custom polyfill with mozilla/webextension-polyfill

# 2.7.1

- Include credentials when firing `HEAD` to grab Content-Disposition (Firefox)

# 2.7.0

- Add option to prefer links over media (#75)
- Use @Rob--W's Content-Disposition parser (#73)
  (source: Rob--W/open-in-browser)[https://github.com/Rob--W/open-in-browser/blob/master/extension/content-disposition.js]
- Add localisation hooks to most things

# 2.6.2

- Fix import settings on options page being totally broken
- Remove debug information and last download information from options

# 2.6.0

- Add option to choose which mouse button to use for click-to-save (#60)
- Add autocomplete dropdown in options page (#63)

# 2.5.4

- Fix overzealous leading dot sanitisation when rewriting filenames (#61)
- Fix notifications not being polyfilled for Chrome (#62)
- Fix potential uninitialised object error in Chrome

# 2.5.3

- Throttle saving tabs from tabstrip, might fix random bugginess when saving (#57)

# 2.5.0

- Save tabs from tabstrip, with options to save to right, and tabs opened from another tab. Firefox only. (#57)

# 2.4.1

- Fix Freedesktop shortcuts not using the page title for Name and Title (#54)

# 2.4.0

- Major refactor to options management, downloading, and renaming. I've tried to keep behaviour identical to older versions so if there are any unexpected changes please file an issue. The extension has had insane feature creep and code spaghettification, so this taming was necessary to keep it maintainable.
- Fix save-to-click toggle key not deactivating after switching tabs (#15)
- Add option to download things via content script. Disabled by default, Firefox only. (#46)
- Treat `~` as a normal character in paths (#51)
- Add option to show or hide last used location. Enabled by default. (#52)
- Add more fields to Freedesktop shortcuts (#54)
- Add option to prompt on menu item click when shift is held. Enabled by default. (#55)
- Options page now validates routes without needing to refresh to get last download

# 2.3.0

- Add `comment:`, `menuindex:` matchers
- Allow comments on menu items

# 2.2.1

- Also stop propagation immediately on click-to-save

# 2.2.0

- Add filesize and mimetype to successful download notification (#48)
- Add experimental click-to-save feature (#15, #20)

# 2.1.0

- Add `context:` clause
- Do not automatically add `.html` to all page downloads. (#45) This avoids wrong extensions on non-HTML pages. For the old behaviour, use a rule:
  ```
  context: page
  into: :pagetitle:.html
  ```

# 2.0.2

- Don't warn if path has a `\` in it
- Hack to allow multiple separators (#44)

# 2.0.0

- Filename rewrites upgrade: now 100% more flexible

  - New rule-based syntax
  - Now able to use regex capture groups on supported clauses
  - Whole bunch of new matchers
  - Document how to route downloads
  - Option for exclusive rule-base mode: disable context menu for quicker rule-based saving
  - Option to prompt if no rules matched
  - Option to notify on rule match

- Add `:sourceurl:`, `:selectiontext:` variables (#39)
- Add `:naivefilename:`, `:naivefileext:` variables
- Add replacement character option (#39)
- Settings now autosave on update
- More iteration on options page
- Fix improper bad character replacements creating extra directories (#37)
- Add error messages for bad paths and rewrite patterns (#29)
- Add settings import and export
- Add menu keyboard shortcuts for Chrome (#15)\*
- Add option to prompt on download failure
- Fix `:pagetitle` not updating (#41)
- Bug fixes and other improvements

# 1.6.0

- Add `:second:` variable (#31)
- Add `:pagetitle:` variable (requires new `tabs` permission)
- Add saving of current page (#17, #30)
- Add saving of things as shortcuts (#17)
- Save selection with page titles for filenames
- Add filename conflict action option for Chrome (#18)\*
- Add reset to default button in options
- Add :linktext: to directories
- Add truncate path component option
- Better error handling for bad regex patterns (#34)
- Photonized options page

# 1.5.2

- Only notify for downloads downloaded through save in

# 1.5.1

- Fix false-positive failure notifications (#28)
- Fix for browsers (FF < 57) which do not support `icons` in context menu items (#27)
- Set notify on failure to be on by default

# 1.5.0

- Add `:year:`, `:month:`, `:day:`, `:hour:`, `:minute:` variables (#24)
- Add last used menu entry (#20)\*
- Add save selection feature/option (#19)
- Add debug logging checkbox in options page

# 1.4.4

- Fix Firefox Nightly 58.0a not saving into default directory (#7)

# 1.4.1

- Fix nested directories being treated as a single directory
- Pad single-digit components in dates with `0`

# 1.4.0

- Added global filename rewrites, along with `:filename:`, `:fileext:`, and `:$n:` variables
- Added `:unixdate:`, `:isodate:` variables
- Added option to prompt if filename has no extension
- Fixed Chrome detection on Firefox
- Fixed bunch of undefined variables in Chrome (notifications)

# 1.3.1

- Added timeout duration option for notifications

# 1.3.0

- Added notifications for download success/failures (disabled by default)
- Added `notifications` permission

# 1.2.0

- Added option to show file dialog on save
- Fix link option always being checked in options page

# 1.1.0

- Added `<all_urls>` permission (to get around CORS when issuing HEAD requests)
- Handle `Content-Disposition` headers
- Directory variables (:sourcedomain:, :pagedomain:, :pageurl:, :date:)
- Now always defaults to `.` as a directory to be saved into (improves first-run experience)
- Options page styling tweaks

# 4.0.0

> _Rebuilt from the first character to the last for Manifest V3, and still
> filing your downloads with the same stubborn logic it has used since 2017.
> (The full dig is in [docs/V4-ARCHAEOLOGY.md](docs/V4-ARCHAEOLOGY.md).)_

Version 4 is an extensive revamp. It modernizes browser support and makes
complex download organization easier while preserving existing settings and
rules.

- Rebuilt for current Firefox and Chrome MV3 extension platforms; now requires
  Firefox 121+ or Chrome 123+.
- Redesigned Options with clearer navigation, visual directory editing, rule
  templates, previews, a route debugger, search, first-run guidance, improved
  localization, and better dark mode.
- Made downloads resilient to background restarts, with reliable filenames,
  notifications, history, retries, and private-browsing safeguards.
- Expanded routing and renaming with many new variables, safer filename
  handling, Page Sources, and more dependable click-to-save behavior.
- Added opt-in automatic saving for discovered Page Sources through guarded
  `context: ^auto$` routing rules, with live/private controls and a per-page
  limit. **Visual** mode under **Routing rules** creates and identifies these
  rules; valid settings from the earlier dedicated rule field migrate
  automatically.
- Added opt-in tracking and routing for ordinary browser downloads, including a
  separately labelled experimental Firefox replacement mode.
- Added explicitly approved extension integrations, validated configuration
  tools, experimental WebMCP support, and disabled-by-default HTTPS webhooks.
- Unified both browser releases into one readable, reproducible package backed
  by automated Firefox and Chrome end-to-end tests.
- Migrated path-component truncation from character counts to UTF-8 byte limits,
  applied it consistently to files and folders, and preserved filename
  extensions within the configured limit.
- Expanded the routing grammar with `fetch:` URL rewriting, `rename:` filename
  find-and-replace, `finalfilename:` matching, and a `:menupath:` variable,
  alongside tighter rule validation and new site template collections.
- Widened automatic Page Sources saves with per-channel opt-in coverage for
  linked media, documents, and streams, CSS backgrounds, playlist hints, and
  inline `data:` sources.
- Streamlined saving with opt-in Quick Save and a keyboard command, a
  switchable default destination, and post-save tab actions, plus History undo
  and move.
- Added a per-site disable list, six new themes, and parallelized
  Referer-protected metadata and content requests.

<details>
<summary>Detailed changes</summary>

### Platform and compatibility

- Migrated to Manifest V3 and raised the minimum versions to Firefox 121 and
  Chrome 123 (#225, #227).
- Unified Firefox and Chrome releases into one readable, reproducible package
  with browser-specific background handling.
- Moved cross-origin acquisition from the old content-script path into the
  extension context. “Always download through Save In” is now available on
  Chrome as well as Firefox.
- Waterfox and other Gecko forks are detected as Firefox (#186).
- Downgraded the Chrome-only conflict action on Firefox, where it could break
  downloads (#89, #217). Fresh installs also show “Downloads” instead of “.”
  for the default destination (#213).

### Routing and editing

- Added a route debugger that tests saved or unsaved rules against recent,
  sample, or custom download details; explains first-match decisions; previews
  variable expansion and sanitization; and links results back to the editor
  (#194).
- Visual mode and the route debugger now flag automatic rules the current
  settings cannot feed: rules whose source kinds no enabled discovery channel
  produces name the option to turn on, and debugged sources current options
  would never discover get the same note. The hints follow the checkboxes
  live and never block saving.
- Added searchable routing templates, Quick add, grammar-aware validation,
  variable and clause autocomplete, and final-filename previews (#191).
- Added **Text** and **Visual** modes for **Save locations** and **Routing
  rules**. Visual mode supports indentation, drag-to-reorder, aliases, clauses,
  variables, separators, and a live context-menu preview.
- Added **Recent locations**: the context menu can list up to five recently
  used destinations beside **Last used**, controlled by a count from 0 to 5
  (#122).
- A save location can prompt for its final destination through the browser's
  Save As dialog, added with a `(dialog: true)` comment or the Visual-mode
  **Always ask where to save** action (#154).
- Directory and routing edits now use explicit Apply and Discard actions and
  warn before unsaved drafts are abandoned. Other settings continue to
  autosave.
- Added `:counter:`, `:uuid:`, `:mime:`, `:contenttype:`, `:mimeext:`,
  `:weekday:`, `:monthname:`, `:ampm:`, `:isoweek:`/`:week:`,
  `:pagetitleslug:`, `:pagetitlesnake:`, `:sourcepath:`, and `:tld:`
  variables. `:pagerootdomain:` and `:sourcerootdomain:` give the
  registrable domain without its subdomains (#221).
- **Add an extension when the filename has none** derives one from the server's
  Content-Type, so extensionless CDN and query-suffixed URLs stop saving bare as
  a file the system will not open (#43, #126, #135). Off by default: it is the
  one setting that renames a save you did not ask it to rename, and answering it
  costs a request to the site. It only ever uses a known type — an unrecognized
  one leaves the name alone rather than inventing an extension for it.
  `:mimeext:` and `actualfileext:` expose the same resolved extension to rules.
- Page titles now come from the clicked tab (#172, #188). Server-provided
  names, including extensionless and PHP download URLs, now reach routing:
  Firefox resolves the `Content-Disposition` name before rules run, and Chrome
  re-evaluates name-dependent rules once it reports the final name. Match a
  server-provided name with `actualfileext:` or `finalfilename:`; `fileext:`
  reads the URL and cannot see it (#178). Literal `%` characters no longer
  cause an error.
- Hardened Windows filenames against control and invisible format characters,
  variation selectors (#220), trailing dots or spaces, reserved device names,
  and broken replacement characters. Path-component limits now use UTF-8 bytes
  and preserve filename extensions.
- Click to save can now always use the default destination instead of the last
  folder you saved to (#162). It follows the same folder Quick save uses, so
  picking one other folder from the menu no longer redirects every later click.
  A matching routing rule still wins.
- Quick save can now be the only thing in the context menu, with no **Save In**
  submenu around it (#144) — a save in one click. The folder list, **Last used**,
  and the other menu actions go with it: browsers only skip the submenu when an
  extension offers a single item.
- Whitespace is now trimmed from both ends of every folder and filename,
  including non-breaking and other Unicode spaces (#53). Browsers reject a
  path component that begins or ends with whitespace, so such a save used to
  fail or quietly drop the folder; a component made only of whitespace now
  becomes the replacement character instead of disappearing. Whitespace inside
  a name is untouched.
- Shortcut files retain their intended extension instead of becoming `.txt`
  (#161). Options now name Windows internet shortcut (`.url`), macOS internet
  location (`.webloc`), Linux desktop shortcut (`.desktop`), and HTML redirect
  (`.html`) formats explicitly; HTML redirects also escape their target URL.
- Empty aliases fall back to their path, multi-dash comments are handled
  consistently, and invalid regular expressions, URLs, capture groups, and
  routing variables produce contained validation errors instead of broad
  matches or aborted downloads.
- Tightened routing-rule validation. Every clause line is now parsed on CRLF,
  LF, CR, and Unicode line boundaries; malformed lines, unresolved captures,
  unsafe destinations, and malformed known variables make only their containing
  rule inert. Earlier versions could silently ignore or partially execute those
  invalid rules. Existing valid rules remain compatible; repair any newly
  reported rule in the route debugger before relying on it after the upgrade.
- Added the `fetch:` routing clause: a matching rule can rewrite the download
  address before saving, using captures and routing variables (#137). Save In
  saves and automatic Page Sources saves honor the rewrite; ordinary browser
  download routing skips rewriting rules because a started download can only
  be renamed. The visual editor, autocomplete, route debugger, and references
  cover the new clause.
- Added the `rename:` routing clause (#187, #209): a matching rule can rewrite
  the final filename with a regular-expression find and replace
  (`rename/gi: find -> replacement`), with captures and routing variables
  expanding in the replacement. An empty replacement deletes the match, which is
  how you drop unwanted text such as a leading `https___`. It applies to Save In
  saves, automatic Page Sources saves, and routed ordinary browser downloads,
  and only ever changes the filename — never the destination folder. The visual
  editor, autocomplete, route debugger, and references cover the new clause.
- Added `finalfilename:` for matching the browser-resolved name after
  Content-Disposition (#178, #189), plus `:menupath:` for including the chosen
  Save In folder in a destination or filename (#208). Both are available in
  the editors, debugger, autocomplete, and references.
- Added two rule template collections: **Site originals** rewrites Twitter/X,
  Reddit, Wikimedia, Bluesky, ArtStation, Mastodon, Google, and Flickr media to
  their original-quality URLs, and **Site filing** names saves after site
  context, with a Twitter/X handle prefix plus scheme-free and slugged page
  names (#210).

### Page Sources and downloads

- Added Page Sources for previewing media discovered on the current page,
  including relevance sorting, richer previews, live updates, and per-page
  controls.
- Added opt-in automatic Page Sources saves (#47). Eligible rules use the normal
  routing grammar, require explicit `context: ^auto$`, page, and source
  conditions, and cannot be triggered by broad ordinary rules. Valid settings
  from the earlier dedicated automation field migrate automatically.
- Added opt-in handling for ordinary browser downloads (#106, #146, #152, #196).
  Chrome can record or route matching downloads before they are saved. Firefox
  can record them and offers a separately labelled experimental mode that
  cancels a matching HTTP(S) download and starts a routed replacement; that
  replacement can lose POST bodies, temporary URLs, authentication, or other
  request context.
- Fixed History so entries accumulate instead of replacing one another, capped
  it at 10,000 entries, and added search, filtering, pagination, localized
  statuses, download actions, copy actions for the saved path and source URL,
  and **Export all** in JSON or formula-safe CSV and TSV formats (#159, #216).
  Table headings now use **Started** and **Routing**.
- Wake the background as soon as the click-to-save modifier is held, making
  Chrome saves more reliable (thanks @rudolphos, #230). Click-to-save also
  falls back to the link under the cursor when link saving is enabled (#226).
- Click-to-save and external-extension requests no longer inherit the previous
  download's filename, destination, or rename route (#190).
- Added an option to save a shortcut recording a download's original source
  address alongside the media itself (#164). The source shortcut stays out of
  completion notifications and History totals, never delays or re-triggers the
  media save, and does not change how the next download is routed.
- “Retry failed downloads through Save In” retries eligible network and server
  failures once through a background fetch before reporting failure.
- Optional Referer handling protects each exact metadata or content request in
  both browsers, follows that request's exact redirect targets (#193), and is
  kept by retry fetches. Firefox keeps a native direct download when possible;
  Chrome saves the protected content locally. Invalid filter lines no longer
  break the context menu (#222), and the preset covers MangaDex image hosts
  (#218).
- Background fetches can include applicable website sign-in cookies, including
  after redirects, or run anonymously. Private-window extension requests stay
  anonymous because the shared background cannot select a private cookie store;
  Firefox direct downloads retain private-download-manager isolation.
- Background fetches use an explicit redirect policy and response-header
  timeout, and metadata lookup falls back to a body-cancelled GET when HEAD is
  rejected.
- Downloads, filenames, counters, Referer operations, notifications, History,
  and Last used routing metadata survive background shutdowns and concurrent
  activity without being attributed to the wrong request.
- “Close tab on save” now applies to page saves (#115).
- Automatic Page Sources saves can now cover more of a page, each behind its
  own off-by-default control: linked documents and streaming playlists
  (`.pdf`, HLS/DASH manifests — the manifest file itself, not an assembled
  stream), CSS background images, and detected streaming playlists. A stale
  or tampered page cannot bypass the controls: the background re-checks every
  candidate against your settings before saving.
- Automatic Page Sources saves can now adopt linked media through the opt-in
  **Include media that pages link to** control (off by default): with it on,
  anchors that point at an image, video, or audio file count as sources, while
  plain, document, and stream links stay out. Left off, automatic rules keep
  matching embedded media only. Eligibility, dedup, and per-page limits are
  unchanged.
- Automatic saves can optionally include inline `data:` images and media (up
  to 2 MB each, off by default). History shows a shortened form of these
  addresses instead of the full inline payload.
- Parallelized Referer-protected metadata and content requests over a bounded
  rule-ID pool (#193). Conflicting URL sets still wait, every operation removes
  only its own temporary rule, and redirected HEAD requests stay protected.

### Saving workflow and History

- Added opt-in **Quick Save** and an optional keyboard command for saving
  directly to the effective default through the normal routing pipeline. A menu
  toggle switches that default between Downloads and the configured folder,
  while per-location `(tab: close)` and `(tab: return)` actions can close or
  refocus the source tab after a successful save (#115, #68). Those act on any
  save, not only a saved page, and only once the save actually starts — the
  older global setting closed on a timer whether or not it worked.
- Added undo for a completed save (#102): a button on the success
  notification (Chrome) and a History row action (both browsers) remove the
  file, clear it from the browser's download list, and mark the History entry
  undone. A file already moved or removed still gets marked, with distinct
  feedback.
- Added **Move** to completed History rows: Save In downloads the source again
  into a chosen folder, then removes the verified original and links both
  History entries (#102). Automatic Page Sources saves expose the same per-row
  Undo action as interactive saves.
- Added a per-site disable list (#183): pages matching the listed
  WebExtension match patterns get no click-to-save, Page Sources panel, or
  automatic saves. Invalid lines report a diagnostic and never broaden the
  match.

### Integrations and privacy

- Made the external `DOWNLOAD` API official and versioned (v1, #110). `PING`
  negotiates capabilities, and `DOWNLOAD` validates its URL and returns a typed
  `OK` or `ERROR` response.
- External downloads now require an explicitly approved extension ID. Rejected
  callers can be reviewed and approved in Options without retaining the
  rejected URL; the default empty allowlist blocks download and active-tab URL
  access.
- Added `GET_SCHEMA`, `VALIDATE`, and internal `APPLY_CONFIG` messages (#89),
  plus experimental WebMCP tools for compatible in-browser agents while Options
  is open.
- Added disabled-by-default HTTPS webhooks for Save In download starts. Requests
  go directly to the user-selected endpoint, disclose and preview their fields,
  omit credentials and referrers, reject redirects, and are never retried.
  Automatic saves, ordinary browser downloads, external-extension requests, and
  private activity never trigger a webhook. Firefox requests its optional data
  permissions from the enabling action when the browser supports them.

### Options and localization

- Rebuilt Options as a full-width tabbed interface with clearer navigation,
  searchable settings, a live save indicator with one-click undo of the last
  change, consistent typography, improved keyboard and narrow-screen behavior,
  and dark-mode fixes.
- Added a first-install welcome guide with starter configurations and direct
  links to the most important setup actions.
- Added a language selector and opt-in, locally bundled generated translation
  catalogs with English fallback. Page Sources, integration feedback, History
  states, templates, and validation messages follow the selected language.
- Standardized user-facing terms across Options and translations, including
  **Routing rules**, **Shortcut files**, **Notification events**, and History's
  **Started**, **Routing**, and **Export all** labels.
- Expanded Advanced **Diagnostics** with MV3 background health, bounded lifecycle
  events, configuration issue counts, copyable support details, and recent
  session failures. It loads only when opened and excludes private activity.
  The Options page now opens in a browser tab.
- The **About** page now lists each requested browser permission with a plain
  explanation of why Save In needs it.
- Fixed the Firefox dark-mode Last used icon (#184), restored first-party
  autocomplete, and made ordinary text settings autosave after typing pauses.
- The **Last used** entry now keeps your configured access key (#205). Saving
  to a folder used to rewrite that menu item with a hardcoded `(&a)`, so a
  custom key stopped working until you re-entered it in Options. The entry also
  survives a browser restart now, instead of coming back disabled.
- Added six themes: the One Dark, Tokyo Night, and Catppuccin classics, and
  three Save In themes — Glacier (cool light blue), Matcha (soft light green),
  and Ember (warm dark amber). Pastel pink's pressed button color now darkens
  like the other light themes.

### Developer and release process

- Removed runtime libraries in favor of first-party WebExtension, localization,
  and autocomplete adapters. The readable, credited
  `src/vendor/content-disposition.ts` parser remains the only vendored code.
- Added strict TypeScript checks, comprehensive unit and property tests,
  automated Chrome and Firefox end-to-end suites, reproducible runtime and AMO
  source archives, store screenshot generation, oxlint, oxfmt, and Node 24 CI.

</details>

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
  [source: Rob--W/open-in-browser](https://github.com/Rob--W/open-in-browser/blob/master/extension/content-disposition.js)
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

# 3.5.1

* Refactor `legacyDownloadInfo` out from code
* Fix some potential bugs with filename and source URL routing
* Fix dashes in aliases breaking download paths (#124)
* Fix separators in submenus not being treated as special directories (#117)
* Fix Click-to-save not working for middle and right mouse buttons (#116)
* Fix text not visible in dark mode (#112)
* Update sv localisation (#119, @Sopor)

# 3.5.0

* Make options page support dark mode for Firefox (#112)
* Add unofficially (unsupported) onMessageExternal listener for use with other extensions such as Foxy Gestures (#110)
  See wiki at https://github.com/gyng/save-in/wiki/Use-with-Foxy-Gestures

# 3.4.1

* Fix `Referer` header not set in Chrome >= 72 (#66)
* Check if download originates from save-in before renaming download (Chrome, #109)
* Add favicon to options page (#108)

# 3.4.0

* Add option to always prefer links when downloading from pages that match a regex list of URLs (#100)
* Add notification option for when a link is downloaded instead of the source
* Add option to close tabs marked for saving (FF, #68)

# 3.3.0

* Add downloading of multiple highlighted tabs (FF63, #91)
* Enable access keys for Firefox >= 63 (#91)
* Add sv localisation by @Sopor- (#98, #99)

# 3.2.0

* Add option to set `Referer` header on downloads, disabled by default. Should fix errors while downloading for sites that check this, especially pixiv.net in Chrome. Requires new permissions. (#66)

# 3.1.3

* Fix submenus not tracking parent menu item
* Fix submenu items having duplicate IDs

# 3.1.2

* Fix export settings not exporting updated settings after changing them (#83)
* Improve checkmark styling in options page (#84)

# 3.1.1

* Fix neighbouring submenus nesting when they should not

# 3.1.0

* Add nl localisation (Thanks @80486dx, #72)

* Add menu item aliasing (#64)

  To use this, put an `(alias: <display name>)` in the comments for that line. For example:

  ```
  cats // (alias: actually dogs)
  ```

* Add submenu support (#26)

  To use this, add `>`s at the start of the line. For example:

  ```
  submenu
  >mammals
  >>i/cats
  >>i/dogs
  ```

# 3.0.0

* Fix Chrome rules matching against `_`, now matches against special characters instead
* Add variables view to last download in options
* Fix routing failing in some cases (regression) (#80)
* Fix last used access key not working at all (Chrome)

# 2.7.3

* Fix accesskeys not appearing in Chrome (regression) (#79)
* Fix notifications not showing up for alt-clicked images (#78)

# 2.7.2

* Replace custom polyfill with mozilla/webextension-polyfill

# 2.7.1

* Include credentials when firing `HEAD` to grab Content-Disposition (Firefox)

# 2.7.0

* Add option to prefer links over media (#75)
* Use @Rob--W's Content-Disposition parser (#73)
  (source: Rob--W/open-in-browser)[https://github.com/Rob--W/open-in-browser/blob/master/extension/content-disposition.js]
* Add localisation hooks to most things

# 2.6.2

* Fix import settings on options page being totally broken
* Remove debug information and last download information from options

# 2.6.0

* Add option to choose which mouse button to use for click-to-save (#60)
* Add autocomplete dropdown in options page (#63)

# 2.5.4

* Fix overzealous leading dot sanitisation when rewriting filenames (#61)
* Fix notifications not being polyfilled for Chrome (#62)
* Fix potential uninitialised object error in Chrome

# 2.5.3

* Throttle saving tabs from tabstrip, might fix random bugginess when saving (#57)

# 2.5.0

* Save tabs from tabstrip, with options to save to right, and tabs opened from another tab. Firefox only. (#57)

# 2.4.1

* Fix Freedesktop shortcuts not using the page title for Name and Title (#54)

# 2.4.0

* Major refactor to options management, downloading, and renaming. I've tried to keep behaviour identical to older versions so if there are any unexpected changes please file an issue. The extension has had insane feature creep and code spaghettification, so this taming was necessary to keep it maintainable.
* Fix save-to-click toggle key not deactivating after switching tabs (#15)
* Add option to download things via content script. Disabled by default, Firefox only. (#46)
* Treat `~` as a normal character in paths (#51)
* Add option to show or hide last used location. Enabled by default. (#52)
* Add more fields to Freedesktop shortcuts (#54)
* Add option to prompt on menu item click when shift is held. Enabled by default. (#55)
* Options page now validates routes without needing to refresh to get last download

# 2.3.0

* Add `comment:`, `menuindex:` matchers
* Allow comments on menu items

# 2.2.1

* Also stop propagation immediately on click-to-save

# 2.2.0

* Add filesize and mimetype to successful download notification (#48)
* Add experimental click-to-save feature (#15, #20)

# 2.1.0

* Add `context:` clause
* Do not automatically add `.html` to all page downloads. (#45) This avoids wrong extensions on non-HTML pages. For the old behaviour, use a rule:
  ```
  context: page
  into: :pagetitle:.html
  ```

# 2.0.2

* Don't warn if path has a `\` in it
* Hack to allow multiple separators (#44)

# 2.0.0

* Filename rewrites upgrade: now 100% more flexible

  - New rule-based syntax
  - Now able to use regex capture groups on supported clauses
  - Whole bunch of new matchers
  - Document how to route downloads
  - Option for exclusive rule-base mode: disable context menu for quicker rule-based saving
  - Option to prompt if no rules matched
  - Option to notify on rule match
  - Migrating old rules: https://github.com/gyng/save-in/wiki/Filename-rewrite#migrating-to-the-new-syntax

* Add `:sourceurl:`, `:selectiontext:` variables (#39)
* Add `:naivefilename:`, `:naivefileext:` variables
* Add replacement character option (#39)
* Settings now autosave on update
* More iteration on options page
* Fix improper bad character replacements creating extra directories (#37)
* Add error messages for bad paths and rewrite patterns (#29)
* Add settings import and export
* Add menu keyboard shortcuts for Chrome (#15)*
* Add option to prompt on download failure
* Fix `:pagetitle` not updating (#41)
* Bug fixes and other improvements

# 1.6.0

* Add `:second:` variable (#31)
* Add `:pagetitle:` variable (requires new `tabs` permission)
* Add saving of current page (#17, #30)
* Add saving of things as shortcuts (#17)
* Save selection with page titles for filenames
* Add filename conflict action option for Chrome (#18)*
* Add reset to default button in options
* Add :linktext: to directories
* Add truncate path component option
* Better error handling for bad regex patterns (#34)
* Photonized options page

# 1.5.2

* Only notify for downloads downloaded through save in

# 1.5.1

* Fix false-positive failure notifications (#28)
* Fix for browsers (FF < 57) which do not support `icons` in context menu items (#27)
* Set notify on failure to be on by default

# 1.5.0

* Add `:year:`, `:month:`, `:day:`, `:hour:`, `:minute:` variables (#24)
* Add last used menu entry (#20)*
* Add save selection feature/option (#19)
* Add debug logging checkbox in options page

# 1.4.4

* Fix Firefox Nightly 58.0a not saving into default directory (#7)

# 1.4.1

* Fix nested directories being treated as a single directory
* Pad single-digit components in dates with `0`

# 1.4.0

* Added global filename rewrites, along with `:filename:`, `:fileext:`, and `:$n:` variables
* Added `:unixdate:`, `:isodate:` variables
* Added option to prompt if filename has no extension
* Fixed Chrome detection on Firefox
* Fixed bunch of undefined variables in Chrome (notifications)

# 1.3.1

* Added timeout duration option for notifications

# 1.3.0

* Added notifications for download success/failures (disabled by default)
* Added `notifications` permission

# 1.2.0

* Added option to show file dialog on save
* Fix link option always being checked in options page

# 1.1.0

* Added `<all_urls>` permission (to get around CORS when issuing HEAD requests)
* Handle `Content-Disposition` headers
* Directory variables (:sourcedomain:, :pagedomain:, :pageurl:, :date:)
* Now always defaults to `.` as a directory to be saved into (improves first-run experience)
* Options page styling tweaks

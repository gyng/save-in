# 1.6.0

* Add `:second:` variable

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

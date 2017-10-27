# 1.4.0

* Added global filename rewrites, along with `:filename:` and `:$n:` variables
* Added `:unixdate:` variable
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

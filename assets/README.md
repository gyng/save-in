# Design sources

This directory contains editable source artwork. It is included in the Mozilla
source attachment but not in the executable extension package.

`icons/notification-*.svg` are the 128×128 masters for regenerating
Chrome-compatible raster notification icons. Generated runtime PNGs belong in
the top-level `icons/` directory and must be referenced explicitly by the
notification implementation before they are shipped.

`icons/ic_archive_white_24px.svg` is the retained light archive glyph master.
The extension currently ships only the icon variants referenced by its
manifest, menus, options page, and notifications.

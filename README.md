# save-in

[![Build Status](https://travis-ci.org/gyng/save-in.svg?branch=v1.1.0-rc.1)](https://travis-ci.org/gyng/save-in)

[Firefox Addons](https://addons.mozilla.org/en-US/firefox/addon/save-in)<br />
[Releases](https://github.com/gyng/save-in/releases/)

![Screenshot](docs/screenshot.png)

A web extension (Chrome, Firefox) for saving images, videos, audio, and links into specified directories.

`<all_urls>` permission is used for HTTP HEAD requests to check for `Content-Disposition` headers.

The WebExtension API only allows saving into directories relative to the default download directory. Symlinks/junctions can be used to get around this limitation.

Linux/Mac:

    ln -s /path/to/actual /default_download_dir/symlink

Windows

    mklink /default_download_dir/symlink /path/to/actual

See the options page for usage and more information.

## Development

1. Install dev dependencies `yarn install`
2. Develop
3. `yarn prettier` and/or `yarn prettier:write`
4. `yarn lint` and/or `yarn lint:fix`
5. `yarn package` to create a zip in the `build` directory for Firefox

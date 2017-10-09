# save-in

[![Build Status](https://travis-ci.org/gyng/save-in.svg?branch=master)](https://travis-ci.org/gyng/save-in)

[Firefox Addons](https://addons.mozilla.org/en-US/firefox/addon/save-in)<br />
[Chrome Web Store](https://chrome.google.com/webstore/detail/save-in%E2%80%A6/jpblofcpgfjikaapfedldfeilmpgkedf)<br />
[Releases](https://github.com/gyng/save-in/releases/)

![Screenshot](docs/screenshot.png)

A web extension (Chrome, Firefox) for saving images, videos, audio, and links into specified directories.

`<all_urls>` permission is used to get around CORS on HTTP HEAD requests (to check for `Content-Disposition` headers).

The WebExtension API only allows saving into directories relative to the default download directory. Symlinks/junctions can be used to get around this limitation.

Linux/Mac:

    ln -s /path/to/actual /default_download_dir/symlink

Windows

    mklink /default_download_dir/symlink /path/to/actual

See the options page for usage and more information.

## Development

1. Install dev dependencies `yarn install`
2. `yarn d` to start a dev Firefox instance using web-ext
3. Develop
4. `yarn prettier` and/or `yarn prettier:write`
5. `yarn lint` and/or `yarn lint:fix`
6. `yarn test` and/or `yarn test:watch`

## Deployment

### ZIP file

1. `yarn build` to create a zip in `web-ext-artifacts` directory

### Firefox

1. Get API keys from [here](https://addons.mozilla.org/en-US/developers/addon/api/key/)
2. Set environment variables `WEB_EXT_API_KEY` (JWT issuer) and `WEB_EXT_API_SECRET`
3. `yarn build:firefox:submit` to sign and upload to AMO (Firefox Addons), or manually upload at [Firefox Addons](https://addons.mozilla.org/en-US/developers/addons)
4. `yarn build:firefox:submit` also generates an XPI for manual distribution

### Chrome

Not on Chrome store yet, so manually pack this
1. Build a ZIP and extract it somewhere clean
2. [chrome://extensions/](chrome://extensions/)
3. Load unpacked extension...
4. Pack extension...

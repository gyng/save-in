# save-in

[Firefox Addons](https://addons.mozilla.org/en-US/firefox/addon/save-in)<br />
[Chrome Web Store](https://chrome.google.com/webstore/detail/save-in%E2%80%A6/jpblofcpgfjikaapfedldfeilmpgkedf)<br />
[Releases](https://github.com/gyng/save-in/releases/)

![Screenshot](docs/screenshot.png)

A web extension for Firefox and Chrome.

Adds a context menu to save media {image, video, audio, link, selection, page} in user-defined folders or directories relative to the default download location.

Save into dynamically named directories.

Flexible rules-based download renaming and routing.

Option to save as shortcuts {.url, .desktop, .html redirect}.

The WebExtension API only allows saving into directories relative to the default download directory. Symlinks can be used to get around this limitation:

Linux/Mac:

    ln -s /path/to/actual /default_download_dir/symlink

Windows:

    mklink /d \default_download_dir\symlink \path\to\actual

Make sure the actual directories exist, or downloads will silently fail.

- <all_urls> permission is used to get around CORS on HTTP HEAD requests (to check for Content-Disposition headers)
- tabs permission is used to get the active page's title.
- webRequest permissions are required to inject the Referer header on downloads (disabled by default)

Configure before use.

## Use from other extensions

Other extensions can trigger a save-in download by sending an external
message (see [the wiki](https://github.com/gyng/save-in/wiki/Integrations)
for a Foxy Gestures example). This API is unofficial and unsupported — use at
your own risk:

```js
browser.runtime.sendMessage(
  "{72d92df5-2aa0-4b06-b807-aa21767545cd}", // save-in's extension ID
  {
    type: "DOWNLOAD",
    body: {
      url: sourceUrl,
      // `comment` can be used for targeting in routing rules
      info: { pageUrl: `${window.location}`, srcUrl: sourceUrl, comment: "foo" },
    },
  },
);
```

The download is routed through the same rename/routing rules as a context
menu save. On Chrome, use save-in's Chrome Web Store extension ID instead.

## Development

1. Install dev dependencies `npm install` (Node 24+)
2. `npm run d` to start a dev Firefox instance using web-ext, or `npm run d:chrome` for a Chrome dev loop with auto-reload
3. Develop
4. `npm run fmt:check` and/or `npm run fmt`
5. `npm run lint` and/or `npm run lint:fix`
6. `npm test` and/or `npm run test:watch`, `npm run e2e:chrome`, `npm run e2e:firefox`

## Deployment

### ZIP file

1. `npm run build` to create the zip in the `web-ext-artifacts` directory — the
   same Manifest V3 zip is uploaded to both AMO and the Chrome Web Store

The single `manifest.json` declares both `background.scripts` (Firefox event
page, Firefox ≥ 121) and `background.service_worker` (Chrome). To load the
extension unpacked in Chrome, run `node scripts/stage.js` and load
`dist/unpacked` (or just use `npm run d:chrome`).

### Firefox

1. Get API keys from [here](https://addons.mozilla.org/en-US/developers/addon/api/key/)
2. Set environment variables `WEB_EXT_API_KEY` (JWT issuer) and `WEB_EXT_API_SECRET`
3. `npm run build:firefox:submit` to sign and upload to AMO (Firefox Addons), or manually upload at [Firefox Addons](https://addons.mozilla.org/en-US/developers/addons)
4. `npm run build:firefox:submit` also generates an XPI for manual distribution
5. Add https://github.com/yuku-t/textcomplete/releases in the comments when uploading.

### Chrome

1. `npm run build`
2. Go [here](https://chrome.google.com/webstore/developer/dashboard)
3. Upload the zip from `web-ext-artifacts`

### Notes for reviewers

#### Source code

The source code for this extension is available at https://github.com/gyng/save-in.

#### Third-party dependencies

All code is first-party except `src/vendor/content-disposition.js`, a
readable (non-minified) Content-Disposition header parser by @Rob--W, taken
from https://github.com/Rob--W/open-in-browser (license header in the file).
There are no minified files, no remote code, and no build-time
transformations: the shipped sources are the repository sources.

## Contributors

Pull requests, bug reports, and issues are welcome.

Localisations kindly contributed by

- nl [@80486dx](https://github.com/80486dx)
- sv [@Sopor-](https://github.com/Sopor-)

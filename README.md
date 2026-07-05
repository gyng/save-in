# save-in  
<img width="96" height="96" alt="image" src="https://github.com/user-attachments/assets/9dbaad3d-e69a-4f39-82fe-9016fb4e9c0a" />

[Firefox Addons](https://addons.mozilla.org/en-US/firefox/addon/save-in) | [Chrome Web Store (MV2)](https://chrome.google.com/webstore/detail/save-in%E2%80%A6/jpblofcpgfjikaapfedldfeilmpgkedf) | [Releases (MV2)](https://github.com/gyng/save-in/releases/)

 ![Screenshot](docs/screenshot.png)

A web extension to save media (image, video, audio, link, selection, page) via context menu into user-defined directories relative to the default download location. Supports dynamic naming, rules-based routing/renaming, and shortcut creation (.url, .desktop, .html).

### Path Configuration (Symlinks)
WebExtension APIs limit saves to the default download folder. Bypass this using symlinks:
* **Linux/Mac:** `ln -s /path/to/actual /default_download_dir/symlink`
* **Windows:** `mklink /d \default_download_dir\symlink \path\to\actual`
* *Note: Make sure the actual directories exist, or downloads will silently fail.*

### Permissions
* `<all_urls>`: Bypasses CORS for HTTP HEAD requests (checking Content-Disposition).
* `tabs`: Accesses active page titles.
* `webRequest`: Injects Referer headers (disabled by default).

Configure before use.

## Development

1. Install dev dependencies `yarn install`
2. `yarn d` to start a dev Firefox instance using web-ext
3. Develop
4. `yarn prettier` and/or `yarn prettier:write`
5. `yarn lint` and/or `yarn lint:fix`
6. `yarn test` and/or `yarn test:watch`

## Deployment

### ZIP File
1. Run `yarn build` to create a deployment ZIP archive in the `web-ext-artifacts` directory.

### Firefox
1. Obtain your API keys from the [Mozilla Developer Center](https://addons.mozilla.org/en-US/developers/addon/api/key/).
2. Set the following environment variables:
   * `WEB_EXT_API_KEY` (JWT issuer)
   * `WEB_EXT_API_SECRET`
3. Run `yarn build:firefox:submit` to sign and automatically upload the package to AMO (Firefox Add-ons). Alternatively, you can upload it manually via the [Firefox Add-ons Dashboard](https://addons.mozilla.org/en-US/developers/addons).
4. The `yarn build:firefox:submit` command also generates a local `.xpi` file for manual distribution.
5. **Note:** When uploading, include the library release link (https://github.com/yuku-t/textcomplete/releases) in the reviewer comments.

### Chrome
1. Navigate to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/developer/dashboard).
2. Upload the built ZIP file generated in the first step.

## Notes for Reviewers

### Source Code
The full source code for this extension is hosted publicly at https://github.com/gyng/save-in.

### Third-Party Dependencies

#### Textcomplete
* **Archive Download:** The library archive can be downloaded directly from [GitHub Releases](https://github.com/yuku-t/textcomplete/releases/download/v0.17.1/textcomplete-0.17.1.tgz).
* **Source Origin:** The vendored, minified source code is extracted from the archive pathway `package/dist/textcomplete.min.js`.
* **Integration:** The minified source is included within this add-on's repository at `src/options/vendor/textcomplete/textcomplete.min.js`. The original archive link was retrieved from the main [Textcomplete Releases Page](https://github.com/yuku-t/textcomplete/releases).
* **Build Commands:**
  * `yarn install` — Installs required dependencies for the library.
  * `yarn build:dist` — Generates the final distribution build for the library.

## Contributors

Pull requests, bug reports, and issue submissions are always welcome.

### Localizations
Special thanks to our localization contributors:
* **nl:** [@80486dx](https://github.com/80486dx)
* **sv:** [@Sopor-](https://github.com/Sopor-)

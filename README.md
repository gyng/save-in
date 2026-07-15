# Save In

[Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/save-in)<br />
[Chrome Web Store](https://chromewebstore.google.com/detail/save-in/jpblofcpgfjikaapfedldfeilmpgkedf)<br />
[Releases](https://github.com/gyng/save-in/releases/)

[Privacy policy](PRIVACY.md)

![Save In options](docs/store-screenshots/01-downloads-menu.png)

A WebExtension for Firefox and Chrome that adds a context menu for saving images,
video, audio, links, selected text, and pages into user-defined folders inside
the default download location.

- Save into dynamically named directories.
- Rename and route downloads with flexible routing rules.
- Create shortcut files as Windows internet shortcuts (`.url`), macOS internet
  locations (`.webloc`), Linux desktop shortcuts (`.desktop`), or HTML
  redirects (`.html`).
- Browse sortable, filterable download history, manage active or completed
  downloads, and export all stored fields as JSON or formula-safe CSV/TSV.
- Build paths from dates, page and source parts, `:counter:`, `:uuid:`,
  `:mime:`, `:mimeext:`, and other variables. Open **Reference** in Options for
  the maintained variable and matcher list.
- Match normalized MIME types (`mime:` / `contenttype:`), referrer URLs and
  hostnames, and page or source root domains in routing rules.
- Inspect MV3 background health, lifecycle events, configuration issue counts,
  and recent session failures from the collapsed Diagnostics panel in Advanced.

Page Sources can automatically save newly discovered matching media. Automatic
saves are off by default and use guarded routing rules with an
explicit `context: ^auto$`, a page condition, and a source condition. Rules are
created in **Visual** mode under **Routing rules** and remain subject to
private-window and per-page safety limits. See
[Automatic source saves](docs/AUTOMATIC-SOURCE-SAVES.md).

Optionally include matching ordinary browser downloads in local history. Chrome
can apply routing rules before saving; Firefox offers a separately
labelled experimental cancel-and-redownload mode for matching HTTP(S) downloads.

A versioned external API plus configuration tools support scripts and compatible
in-browser AI agents through WebMCP. See the source-controlled
[integration contract](docs/INTEGRATIONS.md).

Version 4 is a [Manifest V3](https://github.com/gyng/save-in/wiki/Manifest-V3) extension on Firefox 121+ and Chrome 123+.

The WebExtension API only allows saving into directories relative to the default
download directory. Firefox can follow a symlink placed there to another
existing directory. Current Chrome versions reject symlinked download
destinations, so this workaround is Firefox-only.

Linux/macOS:

    ln -s /path/to/actual /default_download_dir/symlink

Windows:

    mklink /d \default_download_dir\symlink \path\to\actual

Make sure the target directory exists. Firefox reports a failed download when
the target is missing or inaccessible.

- `<all_urls>` is used for page features and extension-context HEAD/fetch requests.
- The optional Referer filter supports anti-hotlink downloads. Both browsers use
  a temporary, exact declarativeNetRequest rule around requested metadata or
  content fetches, so protected downloads can use MIME, final-URL, and SHA-256
  variables. Firefox keeps its native `downloads.download({ headers })` final
  transfer unless content was already fetched for hashing; Chrome saves the
  protected content blob. Save In does not request `webRequest` or
  `webRequestBlocking`.
- Extension-side Fetch/HEAD requests include applicable credentials by default,
  including at redirect destinations. They can be made anonymous in Advanced
  downloading and require no cookie-reading permission. Private-window
  extension requests are always anonymous because the shared background cannot
  select a private cookie store, so authenticated resources that require Fetch
  mode may fail there. Firefox direct downloads use the private session.

## Integrations

Save In exposes a versioned external API (`PING` + `DOWNLOAD`) to explicitly
approved extensions, an internal configuration API (`GET_SCHEMA` / `VALIDATE` /
`APPLY_CONFIG`), and experimental WebMCP tools for compatible in-browser agents.
See the source-controlled [integration contract](docs/INTEGRATIONS.md) for the
protocol, availability, and trust model.

## Notes for reviewers

### Source code

The source code for this extension is available at https://github.com/gyng/save-in.

### Third-party dependencies

All shipped extension code is first-party except
`src/vendor/content-disposition.ts`, a
readable (non-minified) Content-Disposition header parser by @Rob--W, taken
from https://github.com/Rob--W/open-in-browser (license header in the file).
There are no minified files or remote code. Rolldown transpiles and
scope-hoists the TypeScript modules into one readable, non-minified JavaScript
file per execution target; the shipped bundle remains suitable for review.

## Contributors

Pull requests, bug reports, and issues are welcome.
See the [contributor guide](AGENTS.md) for development setup and validation, and
the [release workflow](docs/RELEASE.md) for packaging and store submissions.

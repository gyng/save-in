# Destination and source workflows

This guide covers the actions that connect Save In destinations, Page Sources,
History, and source-link shortcuts. Automatic unattended saving has a separate
[setup and safety guide](AUTOMATIC-SOURCE-SAVES.md).

## Destination-specific Save As

Open **Options → Save menu → Folders** and use **Always ask where to save** on a
folder row when that destination should open the browser's Save As dialog. The
setting applies only to that destination. Global Save As conditions under
**Save dialog** continue to apply independently.

In the text representation, the same setting is stored as destination metadata:

```text
Work // (dialog: true)
```

Removing the metadata returns the destination to normal direct saving. Aliases,
comments, nesting, and variables can be used on the same destination line.

## Recent locations

Set **Recent locations** under **Options → Save menu → Save behavior** to show
between zero and five recently used explicit destinations in the context menu.
Save In records a location only after its download starts successfully. Choosing
a recent location moves it to the front of the list and preserves whether that
destination always opens Save As.

Recent locations are stored on the device so they survive background restarts.
Private-window saves are not added. Rule-selected destinations are also not
added because no explicit menu destination was chosen.

## Page Sources

Open Page Sources from the toolbar or context menu to inspect sources exposed by
the current page. Each result can be saved by itself or selected for a batch.

- **Select filtered** selects every result in the current text and type filters.
- Selected sources remain selected when filters change; the selection bar shows
  how many selected sources are currently hidden.
- **Save selected** submits the downloads one at a time. A batch larger than 20
  sources asks for confirmation first.
- Sources the background rejects remain selected so they can be retried. A
  started count means Save In accepted those requests; completion and failures
  appear later in History.

Open a result's **More actions** menu and choose **Create automatic rule** to
open Routing rules with a disabled draft. The draft matches the current page
root domain, source root domain, and source kind. Review its destination, enable
it, and select **Apply**. Draft creation is unavailable from private tabs because
the draft would otherwise persist private browsing data.

Use `context: auto` with page and source conditions to match automatic
downloads. The first matching rule sets the save location. See
[Automatic source saves](AUTOMATIC-SOURCE-SAVES.md) for eligibility and safety
controls.

Use `css:` when a URL or source kind is too broad and the page element that
discovered the source is the useful distinction. Its value is a CSS selector,
not a regular expression:

```text
context: ^auto$
pagerootdomain: ^example\.com$
css: article .gallery img:not(.avatar)
into: Articles/:filename:
```

Comma-separated selectors use normal CSS OR behavior. Multiple `css:` clauses
must all match the same originating element. If the same source URL appears in
several elements, any one origin may satisfy the rule. DOM matching is available
for automatic Page Sources, click-to-save, and Page Sources panel saves; routes
without page-element context do not match `css:`.

## History actions

History records the original source URL for a Save In download, including when
the downloaded file is a generated shortcut. A completed row can provide these
actions:

- **Show in folder** asks the browser to reveal the file. It is available only
  while the browser still knows the completed download.
- **Copy saved path** copies the path Save In requested under the browser's
  Downloads folder, not an absolute operating-system path.
- **Copy source URL** copies the original media, link, or page URL rather than a
  temporary blob or data URL used to build a shortcut.

Private activity is excluded from Save In History.

## Source-link sidecars

Enable **Save a source link beside downloaded media** under **Options → Save as
shortcuts** to create a shortcut beside a media file saved from the context menu
or manually from Page Sources. The sidecar:

- uses the selected shortcut format (`.url`, `.webloc`, `.desktop`, or `.html`);
- uses the routed media filename and directory, replacing the media extension
  with the shortcut extension;
- records the original source URL;
- does not run through routing again, open another Save As dialog, trigger a
  webhook, or create a separate History row.

The media download remains the primary operation. If creating its optional
sidecar ultimately fails, Save In does not report the media download as failed.

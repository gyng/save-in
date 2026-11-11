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

A destination can also act on its source tab after the browser accepts a save
started from it: `(after: close-tab)` closes the tab, and `(after: return-tab)`
re-activates it. The earlier `(tab: close)` and `(tab: return)` spellings keep
working. The same `after: close-tab` action is available per rule in the routing
grammar.

```text
Read later // (after: close-tab)
```

## Last used

**Last used** repeats the most recently selected explicit destination. Regular
windows keep that destination on the device so it survives background and
browser restarts. Private windows keep a separate Last used destination only in
session storage: it survives background sleeps, is never shown in a regular
window, and is removed when private browsing ends or the browser closes.
With **Remember private browsing activity** enabled, private selections instead
update the normal Last used destination, so it remains available in regular and
later private windows.

With **Use browser Save As subfolders for Last used** enabled, an ordinary
browser download saved to a subfolder inside Downloads can update the regular
Last used destination without adding that download to Save In History. Save In
must first finish one download without a Save As dialog in the browser session
to identify the Downloads folder. Ordinary browser downloads saved directly in
Downloads and destinations chosen by browser-download routing do not change
Last used, so they cannot erase an explicit folder choice.

## Recent locations

Set **Recent locations** under **Options → Save menu → Save behavior** to show
between zero and five recently used explicit destinations in the context menu.
Save In records a location only after its download starts successfully. Choosing
a recent location moves it to the front of the list and preserves whether that
destination always opens Save As.

Recent locations are stored on the device so they survive background restarts.
Private-window saves are not added unless **Remember private browsing activity**
is enabled. Rule-selected destinations are also not added because no explicit
menu destination was chosen.

## Keyboard commands

Save In registers browser keyboard commands that you bind yourself. Only
**Show or hide Page Sources** has a suggested key; the others have none until
you assign one in Firefox under **Add-ons and themes → ⚙ → Manage Extension
Shortcuts**, or in Chrome at `chrome://extensions/shortcuts`.

| Command                               | What it acts on                          | What it does                                      |
| ------------------------------------- | ---------------------------------------- | ------------------------------------------------- |
| Quick save the current page           | The page in the active tab               | Saves to the Quick save destination               |
| Save to the last used location        | What is under the pointer, else the page | Saves to **Last used**                            |
| Save to the first folder in the menu  | What is under the pointer, else the page | Saves to the first folder you can pick            |
| Save to the second folder in the menu | What is under the pointer, else the page | Saves to the second folder you can pick           |
| Save to the third folder in the menu  | What is under the pointer, else the page | Saves to the third folder you can pick            |
| Show the folder picker                | What is under the pointer, else the page | Opens the [destination picker](#destination-picker) |

The Last used and folder commands (#15) act as if you had opened the context
menu on what the pointer is over and chosen that item: the same routing rules,
per-destination Save As, Last used and recent-location updates, History, and
private-window handling apply. Keep these points in mind:

- "Under the pointer" means an image, video, audio element, or link in the
  page's top frame. Anything else, including content inside an embedded frame,
  an image that is only visible through an empty overlay, and pages where
  extensions cannot run, saves the page. If **Show an action for the current
  page** is off, nothing is saved in that case.
- Folders are counted in menu order, skipping separators, disabled lines, and
  folders that only open a submenu. A command for a folder that does not exist
  does nothing.
- A command only picks an item the menu currently shows. With **Show last
  used menu item** off, or with the folder list removed by **Show only Quick
  save in the context menu** or **Hide folder choices**, the matching commands
  do nothing.
- The quick save command keeps its own rules: it always saves the page and
  works only while **Show a quick save item** is on.

## Destination picker

The destination picker is an optional list of your Save menu folders that
opens inside the page, at the pointer, so you can choose where one item goes
without the browser context menu. It is off until you choose one of the ways to
open it, and it never replaces or changes the context menu.

It lists **Last used** first, when there is one, and then your folders with
the same names, order, and nesting as the context menu. A folder that only
opens a submenu appears as a heading.

| To do this                        | Use                                         |
| --------------------------------- | ------------------------------------------- |
| Move through the folders          | Up and Down arrow keys, or the pointer      |
| Narrow the list                   | Type part of a folder name or of its parent |
| Save to the highlighted folder    | Enter, or click the folder                  |
| Close without saving              | Esc, or click anywhere outside the picker   |

Choosing a folder saves exactly as choosing it from the context menu would:
routing rules, per-destination Save As, Last used, recent locations, History,
and private-window handling are the same. In a private window the picker shows
only that window's own Last used destination.

There are three ways to open it:

- **A keyboard command.** Bind **Show the folder picker** as described under
  [Keyboard commands](#keyboard-commands). It opens centered, for what the
  pointer is over or else for the page.
- **A click-to-save gesture.** Under **Options → Click-to-save**, turn on
  **Show a folder picker instead of saving immediately**. Every click-to-save
  gesture then opens the picker at the pointer for the clicked item instead of
  saving it. Combined with a long left click binding, holding the button on an
  image shows your folders (#77).
- **Another extension**, such as a mouse-gesture add-on you have approved. See
  [Opening the destination picker](../integrating/INTEGRATIONS.md#opening-the-destination-picker).

Limits worth knowing:

- A save made through the picker is a menu save. Routing rules that match
  `gesture:` or `keys:` see click-to-save saves only, so they do not match a
  folder chosen in the picker, and **Always save to the default destination**
  does not apply to it.
- The picker does not open on sites matched under **Disable Save In on
  sites**, on pages where extensions cannot run, in a tab loaded before Save In
  was last updated, or when the menu has no folder to offer, as with **Show
  only Quick save in the context menu**. With **Hide folder choices** it offers
  the single routing item the context menu shows.
- Recent locations are not listed; the picker shows Last used and the
  configured folders.

## Click-to-save folders

**Options → Click-to-save** saves the clicked media without opening the context
menu. Each click gesture pairs up to two held keys with a mouse action, and the
same mouse action may appear more than once with different keys. A single left
click still cannot be combined with a double or long left click, and two rows
with the same mouse action and the same keys are rejected.

Routing rules can tell the bindings apart. `gesture:` matches the mouse action
(`left-click`, `middle-click`, `right-click`, `back-click`, `forward-click`,
`double-left-click`, or `long-left-click`). `keys:` matches the keys of the
binding that fired, spelled in lowercase in the order `ctrl`, `alt`, `shift`,
`meta`, joined with `+`; a binding without keys is `none`. To save Alt+click to
one folder and Ctrl+Shift+click to another (#15), add both bindings and write:

```text
keys: ^alt$
into: images/:filename:

keys: ^ctrl\+shift$
into: wallpapers/:filename:
```

Anchor `keys:` patterns: without `^` and `$`, `alt` also matches `ctrl+alt`.
When the held keys satisfy several bindings of the same mouse action, the
binding whose keys include all the others wins, so Alt+Shift+click uses an
Alt+Shift binding rather than an Alt binding. If no binding includes all the
others, such as Alt and Ctrl bindings while both keys are held, the click is
left to the page. Menu, Quick save, automatic, and external-extension saves
have no click-to-save keys, so a `keys:` rule never matches them.

## Page Sources

Open Page Sources from the toolbar or context menu to inspect sources exposed by
the current page. Each result can be saved by itself or selected for a batch.

Page Sources normally finds sources by reading the page's DOM. The off-by-default
**Detect media loaded by scripts** setting additionally watches network requests
for media a page loads with scripts — such as HLS/DASH streams or fetch/XHR
media, including from workers and cross-origin frames — that the DOM does not
expose. Turning it on requests the optional network-access (`webRequest`)
permission; declining or later revoking it reverts the setting and leaves the
rest of Page Sources unaffected. On Chrome, the request that wakes the sleeping
extension background is not reported to it, so reload the page if a stream is
missing right after the page loads. Automatic saves can use the same observations; see
[Media loaded by scripts](AUTOMATIC-SOURCE-SAVES.md#media-loaded-by-scripts).

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

Manual saves also support images and files that a page creates as `blob:` URLs,
including MangaDex reader images. Keep the source page open until the save
starts. Save In preserves the bytes and uses the media type for the filename
extension; routing and content-hash variables work normally. A revoked blob or
streaming-video `MediaSource` cannot be recovered this way. After updating the
extension, reload an older open page before saving its blobs.

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
must all match the same originating element. Automatic discovery and the Page
Sources panel combine every current element that declares the same source URL,
so any one of those origins may satisfy a rule without making routing depend on
DOM traversal order. Automatic discovery also compares duplicate source-kind
variants before choosing the first matching rule. Click-to-save evaluates the
element that was clicked. Routes without page-element context do not match
`css:`.

For bounded content-to-background messages, one rule may contain up to 64
`css:` matchers and the complete routing configuration may contain up to 256.
The validator rejects larger configurations instead of silently dropping
selector matches.

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
- **Debug this save** loads the routing inputs recorded with that row into the
  Route debugger and runs them against the rules currently in the editor. The
  result is a replay, so it can differ from the original destination after a
  rule change. Older rows may have fewer recorded inputs; missing fields remain
  visibly blank instead of being guessed.

Interactive link saves can route on page-supplied anchor metadata with
`:linktitle:` / `linktitle:` and `:linkdownload:` / `linkdownload:`. These name
the link's HTML `title` and `download` attributes. They are separate from
`:linktext:`, whose established browser-provided behavior remains unchanged.
The attributes are not available to automatic Page Sources saves.

Interactive image saves can likewise use the image's `alt` attribute with
`:alttext:` / `alttext:`. It is available when an image is saved from the
context menu, with click-to-save, or from the Page Sources panel, and is empty
when the saved source is not an image, the image has no alt text, or the save is
automatic. A context-menu save reads it from the top-level page only, for an
image with an `http` or `https` address:

```text
alttext: .
into: Photos/:alttext:.:fileext:
```

Private activity is excluded from Save In History by default. Enabling
**Remember private browsing activity** records it with a visible private marker.
Save In's notifications still report private save outcomes and routing decisions,
but do not show filenames, paths, URLs, sizes, or media types from private activity.

## Source-link sidecars

Enable **Save a source link beside downloaded media** under **Options → Shortcut
files** to create a shortcut beside a media file saved from the context menu
or manually from Page Sources. The sidecar:

- uses the selected shortcut format (`.url`, `.webloc`, `.desktop`, or `.html`);
- uses the routed media filename and directory, replacing the media extension
  with the shortcut extension;
- records the original source URL;
- does not run through routing again, open another Save As dialog, trigger a
  webhook, or create a separate History row.

The media download remains the primary operation. If creating its optional
sidecar ultimately fails, Save In does not report the media download as failed.

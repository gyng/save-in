# When a file already exists

**Options › Save behavior › Existing files › When a file already exists**
decides what happens when the destination folder already has a file with the
name Save In chose.

| Choice               | Firefox                                                   | Chrome                     |
| -------------------- | --------------------------------------------------------- | -------------------------- |
| Create a unique name | Saves as `name(1).ext` (the default)                      | Saves as `name (1).ext`    |
| Overwrite            | Replaces the existing file                                | Replaces the existing file |
| Ask each time        | Opens a Save As dialog, but only when the file exists     | Chrome's own dialog        |
| Skip                 | Does not save, and shows a "File already exists" notice   | Not offered                |

## How Firefox finds the existing file

Neither browser lets an extension look at your folders, and Firefox's download
list keeps calling a file present after you delete it. So Save In asks Firefox
to save under a unique name and checks the name Firefox picked. When Firefox
answers with `name(1).ext`, a file named `name.ext` is already in that folder,
whether or not it was ever downloaded. Save In then cancels that copy at once
and either skips the save or opens the Save As dialog for the original name.

- A skipped save appears in History as **Already exists** and is not sent to
  webhooks. Its notice follows **Notify when a download fails**; private
  saves get a notice that does not name the file.
- Closing the Save As dialog without saving ends the save. History shows it
  as **Canceled**, and no failure is reported.
- A very small file can finish before the cancel. Save In then deletes the
  `name(1).ext` copy, so only your original file remains.
- Firefox picks the name after the download has started, so a skipped direct
  save still sends one request to the server before it is canceled.

## Limits

- Only saves Save In names itself are checked. Ordinary browser downloads,
  saves where you already get a Save As dialog, and retries after a network
  failure keep the browser's behavior.
- A name Firefox shortens or cleans up for another reason, for example a very
  long name that leaves no room for `(1)`, is not treated as a conflict. The
  save then completes under Firefox's unique name, as with Create a unique name.
- Chrome reports its chosen name too late to cancel reliably, so Chrome offers
  no Skip. A profile imported from Firefox with Skip saves under a unique name
  on Chrome.
- A profile imported from Chrome with Ask each time now asks on Firefox.
  Earlier versions saved it under a unique name there, because Firefox has no
  dialog of its own for this.

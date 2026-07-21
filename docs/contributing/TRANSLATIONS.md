# Translation maintenance

English is the canonical message schema in `_locales/en/messages.json`. It is
the only browser-native catalog. The opt-in catalogs under
`src/i18n/generated/<locale>/messages.json` are bundled locally and never use
runtime translation or network access.

## Adding or changing copy

1. Add the complete English message before using its key. Every English entry
   needs a translator-facing `description` that names the control, state, or
   outcome and its source location.
2. Use one complete message for each user-visible sentence or accessible name.
   Do not assemble translated prose from fragments. Keep visible and accessible
   wording aligned.
3. Add the key to every generated catalog in the same change. Do not use the
   English message as a temporary value: valid JSON and complete key coverage do
   not prove that a string was translated.
4. Translate the described UI meaning, not just the isolated words. Reuse the
   terminology already used by that locale for folders, routing, sources,
   downloads, and browser controls.
5. Preserve placeholder names, `content`, examples, spacing, and technical
   tokens exactly. A language may reorder placeholders, but it must not rename
   or drop them. Keep separate singular and plural keys even when a language
   uses the same wording for both.
6. Format the catalogs and run `npm run check:i18n`. Run `npm run lint`
   before handing off a completed UI change.

Generated catalogs normally contain only `message` and `placeholders`.
Translator descriptions live in English so there is one canonical explanation
to maintain.

## Review passes

`npm run check:i18n` checks runtime-key coverage, rejects raw user-visible
manifest strings, and checks duplicate and unknown keys, catalog schema,
placeholder identity, protected technical tokens, edge whitespace, ellipses,
invisible artifacts, literal keyboard labels, and broad translation coverage.
It also rejects a non-literal message that remains the same in every generated
locale, including stale English wording left behind after the canonical message
changes.

That mechanical pass is necessary but not sufficient. Review new or changed
messages together as a feature, and repeat the passes until a complete pass
finds no new issues:

1. Compare each translation with the English description and the control that
   uses it. Verify the actor, action, outcome, prerequisites, exceptions, and
   complete scope. A prerequisite such as saving once _without_ a Save As
   dialog must not be shortened to merely saving once.
2. Compare repeated feature names within each locale. Reuse the established
   localized label for named UI concepts such as **Last used** or
   **Click-to-save**, including in help and error text. Make the name visibly a
   UI term when sentence grammar would otherwise make it ambiguous.
3. Resolve overloaded words from the feature context instead of translating
   them in isolation. Distinguish browser history from Save In History,
   ordinary browser downloads from Automatic Page Sources, and an ongoing save
   from a browser download. Prefer the user-visible outcome, such as “saved
   directly in Downloads,” over implementation shorthand such as “Downloads
   root.” In External integrations, `extension` means a browser extension, and
   a calling extension is the software sender—not extra time or a telephone
   line.
4. Check privacy and persistence copy against the actual data flow. Name the
   stores or features that receive private activity and the capabilities that
   remain disabled; generic wording such as “browser data” is not enough when
   the setting affects History, diagnostics, credentials, or webhooks
   differently.
5. Look for English fallbacks, mistranslated actions versus statuses, accidental
   changes to placeholders or product names, and unnatural literal phrasing.
   Check short labels in their surrounding UI, and check longer help, status,
   and error copy at narrow widths. Follow the localization layout rules in
   [UI.md](UI.md).

Rerun the review and `npm run check:i18n` after rebasing, merging, or while
related feature work is landing. A catalog can become incomplete or
semantically stale between two otherwise clean runs.

Some words legitimately stay the same in every locale, such as product names,
keyboard tokens, URLs, or fixed file-format labels. Add a key to
`intentionallySharedEnglishKeys` or the more specific literal lists in
`scripts/check-i18n.js` only when the value is deliberately invariant, not to
silence an unfinished translation.

## Working in a dirty or moving tree

Catalog files are shared by many features, so translation work often overlaps
uncommitted changes:

- Inspect both `git status` and the English catalog diff before editing.
- Treat existing catalog additions as feature-owned. Translate them in place,
  but do not overwrite or discard adjacent work.
- If a feature adds keys while translation checks are running, rerun
  `npm run check:i18n` and resolve missing or duplicate keys before committing.
- Stage only the intended catalog hunks. When additions share a large tail hunk,
  rebuild or interactively stage the index instead of committing unrelated
  feature files.
- Validate the staged snapshot, not only the working tree, before a partial
  commit. Materialize the index in a temporary directory with
  `git checkout-index --all --prefix=<temporary-directory>/`, then run
  `node scripts/check-i18n.js` there.

The working tree and staged snapshot can both pass while containing different
sets of feature keys. Report which one was verified and leave unrelated dirty
changes intact.

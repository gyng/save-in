# Automatic source saves

Save In can automatically save newly discovered page sources through the same
**Routing rules** used for interactive saves. The feature is disabled by
default. Automatic rules live in `filenamePatterns`, appear in **Text** and
**Visual** modes under **Routing rules**, and are marked **Automatic source** in
Visual mode.

## Set up an automatic rule

1. Open **Options → Page Sources → Automatically save page sources**.
2. Choose the safety controls, but leave **Save matches automatically** off
   while preparing the rule.
3. Select **Open routing rules** and switch to **Visual** if needed.
4. Select **Add automation rule**. Save In inserts a disabled starter rule.
5. Replace the example page and source conditions, choose the destination,
   enable the rule, and select **Apply**.
6. Return to Page Sources and enable **Save matches automatically**.

As a shortcut, open a source row's actions and select **Create automatic
rule**. Save In opens a disabled draft in the shared rule editor, scoped to the
page root domain, source root domain, and source kind. Review its destination,
enable it, and select **Apply** before turning on automatic saves.

For example, this rule saves JPEG, PNG, and WebP images discovered on one site:

```text
context: ^auto$
pagedomain: ^gallery\.example\.com$
sourcekind: ^image$
sourceurl/i: \.(?:jpe?g|png|webp)(?:[?#].*)?$
into: automatic/:pagedomain:/
```

The `into:` value uses the normal routing path and variable syntax. A trailing
slash preserves the resolved source filename. Rules can instead rename the file
with variables such as `:filename:`, `:pagedomain:`, or date components.

## Matching rules

Automatic discovery supplies the synthetic routing context `AUTO`. The
`context:` matcher normalizes contexts to lowercase, so the canonical opt-in is:

```text
context: ^auto$
```

Use `context: auto` with page and source conditions to match automatic
downloads. The first matching rule sets the save location.

Save In deliberately ignores ordinary routing rules during automatic discovery,
including broad rules such as `context: .*`. An automatic rule must explicitly
mention `auto` in its context pattern and must contain both:

- a page condition: `pageurl:`, `pagedomain:`, or `pagerootdomain:`; and
- a source condition: `sourceurl:`, `sourcedomain:`, `sourcerootdomain:`,
  `sourcekind:`, `mediatype:`, `fileext:`, or `urlfileext:`.

Invalid automatic rules are rejected by the normal routing validator. Among
valid automatic rules, the first complete match owns the destination. Ordinary
and automatic rules may be interleaved in the same editor without ordinary
rules becoming eligible for unattended saves.

`sourcekind:` uses the shared Page Sources vocabulary: `image`, `video`,
`audio`, `stream`, `document`, and `link`. The automatic page scanner currently
queues previewable HTTP(S) image, video, and audio elements. It deliberately
does not adopt Page Sources found only through links, CSS backgrounds, or
resource-timing playlist hints.

## Safety controls

- **Save matches automatically** is the master switch and defaults to off.
- **Include sources added after the page loads** keeps watching dynamic pages.
- **Allow in private windows** is a separate opt-in and defaults to off.
- **Maximum saves per page visit** defaults to 20 and accepts 1–500. Reloading
  the page starts a new visit.
- A source URL is queued once per page visit, and only after a guarded automatic
  rule matches it.

Chrome cannot assign an extension-started download to its Incognito download
context, so an allowed private automatic save may appear in Chrome's regular
download manager. Save In still excludes private activity from its own history,
restart state, debug log, and webhooks.

Automatic source matching itself does not use Declarative Net Request and does
not add another permission. The optional Referer feature may independently use
a temporary, exact `declarativeNetRequestWithHostAccess` rule while Save In
fetches protected metadata or content in either browser.

## Existing settings

Profiles created by the earlier dedicated automation editor stored rules in
`autoDownloadRules`. On load, Save In converts valid legacy rules into
`filenamePatterns`, adds `context: ^auto$`, preserves rule order and enabled
state, and clears the legacy field only after preparing the unified form.
Existing routing rules remain unchanged. Malformed legacy text is retained
instead of being silently discarded.

Exported configurations continue to accept the legacy field for backward
compatibility, but new configurations should put all automatic rules in
`filenamePatterns`.

## Troubleshooting

- If nothing saves, confirm the master switch and the rule's **Enabled** toggle
  are both on, then select **Apply** in the routing editor.
- If the rule is rejected, add an explicit page condition and source condition.
- If initial sources save but later ones do not, enable live discovery.
- If saving stops after several matches, check the per-page maximum and reload
  the page to begin a new visit.
- If a resource never appears, confirm the page exposes a previewable HTTP(S)
  source rather than a `data:`, `blob:`, or page-script-only resource.

The machine-facing validation and vocabulary contract is documented in
[Integrations](INTEGRATIONS.md#config-messages).

Manual selection, batch saving, and source-row actions are covered in
[Destination and source workflows](DESTINATION-AND-SOURCE-WORKFLOWS.md#page-sources).

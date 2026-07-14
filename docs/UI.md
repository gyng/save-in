# Save In UI system

Save In uses a refined native-utility interface: compact enough for browser
settings and in-page tools, but calm, legible, and explicit about state. New UI
must extend this system rather than introduce a separate visual language.

The options and reference surfaces load the ordered cascade declared by
`src/options/style.css`. Tokens, base rules, shell, components, editor features,
Advanced, History, feature-owned responsive rules, and utilities live in matching
`style-*.css` ownership files. Page-specific entry sheets import `reference.css`
and the first-run welcome flow into their declared layers, so they consume the
same tokens, atoms, and precedence contract. The Page Sources drawer runs in a
shadow root, so it owns a compact copy of the semantic color contract while
deliberately using smaller density tokens.

Ownership files stay intentionally bounded: split a file by workflow or
component before it exceeds the mechanical line limit. Every responsive or
corrective rule belongs to the feature layer that owns the component; do not
reintroduce a catch-all override layer.

Cascade layers are the supported ownership boundary for the declared Firefox
121 and Chrome 123 minimums. Keep selectors local to their feature file and put
cross-feature precedence in the layer order instead of escalating specificity.
CSS `@scope` is a future simplification for component-local element selectors,
but it must not carry essential styling until the minimum Firefox version is
deliberately raised to a release that supports it.

## Hierarchy

### Tokens

Tokens are CSS custom properties. Components consume semantic roles, never raw
palette values or color literals.

- Spacing: `--space-1` through `--space-6`, based on 4px.
- Type: `--text-xs` through `--text-xl`; `--leading-ui`,
  `--leading-copy`, and `--leading-code`.
- Shape and size: control, compact-row, radius, dialog-radius, and content-width
  tokens.
- Semantic color: page, raised, floating, border, control, text, muted, link,
  accent, focus, selection, success, warning, validation, danger, and syntax
  roles.
- Elevation and overlay: floating, dialog, preview, and backdrop tokens.

Raw palette values may appear only in token definitions. Decorative artwork
may define named decorative tokens; it must not leak those colors into controls
or feedback.

### Atoms

- Typography uses the native UI stack and the shared type scale. Monospace is
  reserved for paths, rules, variables, URLs, identifiers, and code examples.
- Controls use the shared height, radius, border, focus ring, and disabled state.
- Buttons have explicit roles: default, primary, quiet, compact/icon, menu
  trigger, and danger. The same action has the same role across surfaces.
- Badges are either rectangular metadata labels or pill-shaped statuses. Color
  communicates a named semantic state, not a feature-specific improvisation.
- Code has three treatments: inline token, block example, and plain monospace
  data. A component chooses one deliberately.

### Molecules

- An option row contains one control, a concise label, and optional muted help.
- Controls enabled by a parent option live in the shared indented
  `dependent-options` group. Disable and visually mute the unavailable controls,
  but keep explanatory help readable at normal help-text opacity.
- A tab list always has associated `tabpanel` elements, roving `tabindex`, and
  Left/Right/Up/Down/Home/End keyboard navigation. A control that opens a dialog
  is a button, not a tab.
- A disclosure is one of: inline help link, section heading, or menu trigger.
  Menu triggers share the same box, weight, and focus treatment.
- Editor validation uses one contract: exact text/gutter marking, a precise
  summary after the editor, and a red/warning visual row. Do not render prose
  inside editable code lines. Keep the summary collapsed unless at least one
  channel contains visible feedback; empty channel wrappers must not reserve
  space.
- Feedback is one of: field validation, inline status, page banner, or transient
  confirmation. Use the matching semantic variant and ARIA role.
- Editor action rows keep supporting links/help left and Discard/Apply together
  on the right. Apply is the primary action.

### Organisms

- The app shell owns identity, resources, language, search, save state, and main
  navigation. Keep it hidden through localization and the initial stored-option
  restore so editors render their real content before the first visible frame.
- Save locations and Routing rules are sibling editor workspaces and must share
  editor tabs, validation, action rows, previews, and responsive behavior.
- Routing rules has one visible primary creation action. Automation rules and
  the template library are secondary choices in the adjacent More menu; Page
  Sources may open that menu directly. Dismiss creation and per-rule menus on an
  outside click or Escape, restoring focus to the trigger after Escape.
- Keep matcher, pattern, flag, remove, and destination fields on shared clause
  columns so rows scan vertically. Put lower-frequency rule operations in a
  labelled per-rule menu, and give repeated controls rule/condition-specific
  accessible names.
- Keep the debugger directly after the routing editor so authoring flows into
  testing. Put the global no-match fallback after the debugger. Desktop
  references are a secondary column with collapsed disclosures; omit that
  column at narrow widths rather than creating a nested scrolling surface.
- Route debugger is a plain testing workflow: heading and Run test, result,
  variables, and rule explanation. It should not introduce a competing card
  system.
- Route debugger variables use one two-column field rhythm, collapsing to one
  column at narrow widths. Every field owns one column, labels sit above
  equal-height controls, and inputs fill their column instead of inheriting
  generic width caps.
- Visual routing cards keep the stable rule number and expose the optional rule
  name as a quiet inline field. Names remain leading `//` comments in rule text
  so imports, exports, Text mode, and older profiles keep one routing grammar.
- Long routing vocabularies use compact first-party typeahead dropdowns instead
  of expanded lists or native datalists. A typeahead filters a selectable
  dropdown; autocomplete inserts a token within freeform text at the caret.
  Matcher suggestions are alphabetical and destination fields autocomplete
  variables. The template library matches the compact reference disclosures;
  its floating results scroll independently while the filter stays pinned.
  Search, filter, and typeahead inputs are transient controls and must stay
  outside the settings autosave pipeline.
- Reorderable rule cards use a dedicated drag grip so text fields remain safe
  to select and edit. Keep equivalent Move up and Move down actions available
  for keyboard and assistive-technology workflows.
- Page Sources settings describe the real drawer. Its static preview must expose
  the same header actions and vocabulary as the shipped drawer.
- History is a dense data organism. Filters, menu triggers, statuses, table, and
  pagination still use shared atoms.
- Reference pages/dialogs use the shared table and tab contracts and must remain
  usable without horizontal scrolling at narrow widths.
- Dialogs use the `app-dialog` shell for backdrop, elevation, radius, and
  surface. Close controls and action rows use the shared atoms; size and
  internal layout may vary by task.

## Advanced settings contract

Advanced is a collection of uncommon settings, not permission to create a flat
or visually separate interface. Preserve these rules as the tab grows:

- Group settings by user outcome. Keep the local section navigation in the same
  order as the sections, use stable fragment targets, and add a new top-level
  group only when an existing group cannot describe the outcome.
- Use the standard option-row reading order: concise label, control, then muted
  help. Put help outside the `label` and connect it with `aria-describedby` so
  instructions do not become part of the control's accessible name.
- Show dependency structure through indentation and a shared border treatment.
  A dependent control is available whenever any parent workflow can use it; do
  not tie it to only one of several valid parent paths.
- Keep explanatory copy readable when a parent setting is off. Disabled controls
  and their labels may use the disabled semantic color, but help must still
  explain how and why the option becomes available.
- Put each external integration in the same neutral bordered section. Feature
  identity must not introduce a tinted card or competing component system.
  Surface current state as a live semantic status; do not use a static default
  badge where the setting can change.
- Keep the primary setup path visible and move tool names, protocol details, and
  other developer-only material into a disclosure. Monospace alone is enough for
  plain identifiers and snippets; a code-block background is not automatic.
- Anything presented as click-to-copy is a keyboard-operable control with button
  semantics, visible focus, a localized accessible name, and live confirmation.
- Action rows must wrap without fixed translated-text offsets. Check backup,
  reset, and similar multi-button rows with a long locale as well as English.
- At narrow widths, keep the main tab list to one horizontally scrollable row and
  reveal the active tab after activation or resize. Do not let wrapped tabs
  consume multiple rows above the active panel.

When changing Advanced, verify the section hierarchy, dependency states, and all
integration cards together. A locally polished row is not complete if it creates
a second pattern beside an equivalent setting.

## Interaction and accessibility contracts

- Every visible control has a localized accessible name matching its visible
  action.
- Tabs implement the complete ARIA keyboard pattern and only the active tab is
  in the sequential focus order.
- Focus is never conveyed by color alone and uses the shared focus token.
- Forced-colors mode keeps focus, selection, dirty state, and validation visible
  with system-color outlines or borders instead of relying on shadows or fills.
- Error state uses `aria-invalid` on the relevant control and points to visible
  feedback when available. Visual-editor rows add a redundant color-independent
  marker or accessible description.
- Disabled controls remain readable and do not retain hover/active styling.
- Motion has a `prefers-reduced-motion` fallback.
- Compact metadata may use `--text-xs`; instructions, errors, and actionable
  status stay at least `--text-sm`.

## Responsive and localization rules

- Use the content breakpoints at 760px, 640px, and 520px. Add a new breakpoint
  only when a demonstrated layout constraint cannot use one of these.
- Prefer a named inline-size container for an owned workspace. Reserve viewport
  media queries for shell-level behavior and surfaces whose available size is
  genuinely the viewport.
- Use logical properties, `text-align: start/end`, and inline/block terminology.
  Document localization sets both `lang` and `dir`; components must work without
  a separate RTL override sheet.
- Use `dvh` for viewport-height constraints so dialogs and full-height surfaces
  follow browser chrome changes. Static `vh` is rejected by the CSS policy.
- Use `:where()` for deliberately low-specificity shared atoms. Native CSS
  nesting is appropriate for a short set of states or pseudo-elements owned by
  one selector, but keep nesting shallow and readable.
- Gate progressive declarations with a feature query for every feature they
  rely on. Unsupported enhancements must fall back to a complete static state.
- All options elements and pseudo-elements inherit the global `border-box`
  sizing model. Do not add local `box-sizing` declarations.
- Nested dialogs, menus, listboxes, and other vertical scroll surfaces contain
  overscroll so reaching their boundary does not move the page behind them.
- Use the semantic stacking tokens in `style-tokens.css`; numeric `z-index`
  declarations are reserved for the documented Page Sources host boundary.
- Native checkboxes, radios, ranges, and progress controls inherit the semantic
  accent color. Related controls should remain native unless behavior requires
  a custom implementation.
- Use `subgrid` when repeated editor rows must share parent column tracks; keep
  the responsive track contract on the parent grid.
- Two-column workspaces collapse before either column violates its minimum
  usable width.
- Fixed offsets must not position translated status or help text. Prefer grid or
  flex ownership.
- Reference data becomes stacked rows on narrow screens; long syntax and URLs
  wrap rather than forcing page-level horizontal scrolling.
- UI and accessible copy comes from localization messages. Do not assemble
  translated sentences from fragments.

## Preventing drift

`npm run check:css` enforces the token boundary and shared UI invariants. DOM
contract tests cover semantic relationships, while behavior tests cover keyboard
and state transitions. Browser e2e tests cover focus and horizontal overflow.

Before merging a UI change:

1. Identify the token, atom, molecule, and organism being changed.
2. Reuse an existing variant or update the shared contract first.
3. Verify light, dark, 1280px, 768px, and 480px states, plus one long-string
   locale for wrapping and overflow.
4. Verify keyboard order, visible focus, accessible names, and error feedback.
5. Check the adjacent Save In surface, not only the changed component.
6. Update this document and the mechanical contract when adding a legitimate
   new variant.

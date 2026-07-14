# Save In UI system

Save In uses a refined native-utility interface: compact enough for browser
settings and in-page tools, but calm, legible, and explicit about state. New UI
must extend this system rather than introduce a separate visual language.

The options and reference surfaces are styled by `src/options/style.css` and
`src/options/reference.css`; feature-owned layout such as the first-run welcome
flow may live beside them, but must consume the same tokens and atoms. The Page
Sources drawer runs in a shadow root, so it owns a compact copy of the semantic
color contract while deliberately using smaller density tokens.

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
  `dependent-options` group; disabling the parent dims the group as well as
  disabling its controls.
- A tab list always has associated `tabpanel` elements, roving `tabindex`, and
  Left/Right/Up/Down/Home/End keyboard navigation. A control that opens a dialog
  is a button, not a tab.
- A disclosure is one of: inline help link, section heading, or menu trigger.
  Menu triggers share the same box, weight, and focus treatment.
- Editor validation uses one contract: exact text/gutter marking, a precise
  summary after the editor, and a red/warning visual row. Do not render prose
  inside editable code lines.
- Feedback is one of: field validation, inline status, page banner, or transient
  confirmation. Use the matching semantic variant and ARIA role.
- Editor action rows keep supporting links/help left and Discard/Apply together
  on the right. Apply is the primary action.

### Organisms

- The app shell owns identity, resources, language, search, save state, and main
  navigation.
- Save locations and Routing rules are sibling editor workspaces and must share
  editor tabs, validation, action rows, previews, and responsive behavior.
- Route debugger is a plain testing workflow: heading and Run test, result,
  variables, and rule explanation. It should not introduce a competing card
  system.
- Page Sources settings describe the real drawer. Its static preview must expose
  the same header actions and vocabulary as the shipped drawer.
- History is a dense data organism. Filters, menu triggers, statuses, table, and
  pagination still use shared atoms.
- Reference pages/dialogs use the shared table and tab contracts and must remain
  usable without horizontal scrolling at narrow widths.
- Dialogs use the `app-dialog` shell for backdrop, elevation, radius, and
  surface. Close controls and action rows use the shared atoms; size and
  internal layout may vary by task.

## Interaction and accessibility contracts

- Every visible control has a localized accessible name matching its visible
  action.
- Tabs implement the complete ARIA keyboard pattern and only the active tab is
  in the sequential focus order.
- Focus is never conveyed by color alone and uses the shared focus token.
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
3. Verify light, dark, 1280px, 768px, and 480px states.
4. Verify keyboard order, visible focus, accessible names, and error feedback.
5. Check the adjacent Save In surface, not only the changed component.
6. Update this document and the mechanical contract when adding a legitimate
   new variant.

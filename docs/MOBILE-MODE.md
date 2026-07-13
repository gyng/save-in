# Firefox for Android mobile mode

_Status: proposed. Save In does not yet claim Firefox for Android support._

## Recommendation

Add a capability-driven mobile mode to the existing extension rather than a
separate mobile product. On Firefox for Android, the extension action in the
Add-ons menu should open Page Sources, which becomes the primary touch-first
way to find and save resources. Desktop Firefox and Chrome should retain their
current context-menu workflows unchanged.

This is a reduced but coherent workflow, not desktop feature parity. Firefox
for Android does not let extensions add entries to browser context menus, but
Manifest V3 extension actions are available from its Add-ons menu. See
[Mozilla's desktop/Android differences](https://extensionworkshop.com/documentation/develop/differences-between-desktop-and-android-extensions/).

## Goals

- Start and remain usable when `contextMenus` is unavailable.
- Make Page Sources a clear, touch-first mobile entry point.
- Preserve routing, renaming, variables, history, and configuration formats
  wherever the corresponding browser APIs work.
- Keep stored settings and imported configurations compatible between desktop
  and mobile.
- Keep desktop behavior and the current minimum desktop browser versions
  unchanged.
- Expose unsupported features honestly instead of leaving controls that fail
  when tapped.

## Non-goals

- Emulating a long-press context-menu item. Firefox Android does not expose the
  required extension API.
- Supporting Chrome for Android, which does not provide general WebExtension
  support.
- Matching every desktop interaction. Keyboard shortcuts, modifier-click
  saving, tab-strip menus, and opening the system downloads folder are not
  useful primary mobile workflows.
- Changing routing syntax, path syntax, message payloads, or the import/export
  schema.
- Advertising Android compatibility before the real-device release gates in
  this document pass.

## Current compatibility boundary

The present build should be considered unsupported on Android. Its background
initialization unconditionally calls `contextMenus.removeAll()`, and startup
registers context-menu listeners without first checking that the API exists.
On a host without `contextMenus`, that can abort initialization before the
otherwise viable extension-action and Page Sources path is ready.

| Area | Expected Android state | Required response |
| --- | --- | --- |
| Browser context menus | Unavailable | Do not register, build, remove, or update menus. |
| Extension action | Available in Firefox's Add-ons menu | Use it to open or toggle Page Sources. |
| `downloads.download()` | Available, subject to Android behavior | Probe routing, filenames, subdirectories, and headers on-device. |
| `saveAs: true` | Errors on Firefox Android | Never send it on Android; present an explicit supported alternative. |
| `downloads.show()` / `showDefaultFolder()` | Not yet verified as useful | Capability-gate and hide controls that cannot work. |
| Keyboard and modifier-click shortcuts | Not touch-accessible | Keep their stored values, but label them desktop-only in mobile options. |
| Tab context menus | Unavailable | Skip registration; retain desktop settings unchanged. |
| Notifications | Needs device verification | Prefer in-panel status; use notifications only after verification. |
| Nested destination paths | Needs device/storage verification | Treat as a release-blocking functional test. |

MDN documents that Firefox for Android raises an error when
[`downloads.download()`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/downloads/download)
receives `saveAs: true`. Omitting it or passing `false` is therefore part of
the mobile capability boundary, not merely a visual preference.

## Product and information architecture

### Entry point

The Firefox Add-ons menu exposes **Save In: Page Sources** through the existing
extension action. Activating it opens the current page's Page Sources panel. If
the content script cannot run on the page, show a short explanation and a link
to the options page rather than silently doing nothing.

Do not add a separate persistent `mobileMode` preference. Mobile presentation
is derived from runtime platform information and detected API capabilities, so
the same profile or exported configuration does not change meaning when moved
between devices.

### Page Sources as the mobile home

The mobile panel should use a single-column, full-height layout:

1. Page identity and source filters.
2. Compact source rows with a large row target and preview.
3. A sticky selection summary and **Save** action.
4. A destination picker using the existing parsed directory-menu model.
5. Last-used and a small set of recent destinations before the full tree.

The destination picker can be a bottom sheet or an in-panel view. It must not
depend on hover, right-click, drag, modifier keys, or a pointer-precise popout.
Controls should have at least a 44 CSS-pixel touch target, remain usable with
the software keyboard open, and respect the viewport safe area. A successful
save should update the row and history in place; failures should remain visible
until dismissed or retried.

Page Sources cannot reproduce every desktop context-menu target. It can list
resources discoverable from the page DOM and manifests, but it cannot infer an
arbitrary link or image chosen through a browser long-press gesture. The UI and
store description must make that boundary clear.

### Options

Use the established options-page visual language and responsive layout. On
Android:

- Put supported routing, Downloads menu editing, Page Sources, history, and
  import/export controls first.
- Show a compact notice near desktop-only shortcut settings: context-menu and
  keyboard interactions are unavailable on this device, but their saved values
  are retained.
- Hide action controls such as **Open downloads folder** when the required API
  is absent. If a setting matters when the configuration returns to desktop,
  preserve it rather than deleting or resetting it.
- Do not create a second mobile-only settings hierarchy or configuration file.

## Architecture plan

### 1. Establish a capability record

Expand the platform layer into a cross-browser capability record. API support
must be determined by checking the actual API surface; Android presentation
may additionally use `runtime.getPlatformInfo()` to distinguish a touch/mobile
host. Candidate fields are:

```ts
type PlatformCapabilities = {
  contextMenus: boolean;
  tabContextMenus: boolean;
  downloadSaveAs: boolean;
  downloadsShow: boolean;
  downloadsShowDefaultFolder: boolean;
  keyboardCommands: boolean;
  mobilePresentation: boolean;
};
```

Keep browser identity only for genuine behavioral differences that cannot be
probed. Do not scatter Android checks through menu, download, and options code.

### 2. Make background startup menu-optional

Split menu-independent startup from desktop menu composition:

- Initialize options, session/download state, messages, downloads, history,
  notifications, and action behavior regardless of menu support.
- Register context-menu and tab-menu listeners synchronously only when their
  event surfaces exist. This preserves the MV3 wake-up rule without touching
  a missing API.
- Guard `removeAll`, menu construction, menu updates, and last-used menu state
  behind the same capability.
- Make an options save rebuild menus only when the menu surface exists.

Add regression tests with a deliberately absent `contextMenus` object. The
test must prove startup completes, messages are accepted, and the action path
still works.

### 3. Centralize download fallbacks

Put unsupported-download behavior at the download request boundary:

- Never pass `saveAs: true` when `downloadSaveAs` is false.
- Keep the stored desktop prompt preference intact. Before implementation,
  choose and document one mobile interaction: either ask for confirmation in
  the panel before downloading to the configured destination, or block that
  action with guidance to disable the desktop prompt option. Do not silently
  reinterpret the stored preference.
- Gate `downloads.show()` and `showDefaultFolder()` at both the handler and UI
  boundaries.
- Verify ordinary-browser download adoption, Referer support, cookie stores,
  conflict handling, blob/data URLs, lazy variables, and SHA-256 behavior on a
  real device. Disable each unsupported enhancement independently.

### 4. Adapt Page Sources for touch

Retain the existing content-script/message protocol and add responsive states
instead of creating a mobile-only panel implementation. Required work:

- A narrow-viewport layout with no horizontal overflow.
- Touch-safe filters, source selection, preview, destination selection, save,
  retry, dock/close, and error controls.
- A mobile destination picker backed by the same menu tree used on desktop.
- Clear loading, empty, unsupported-page, permission, partial-save, and
  background-restart states.
- Focus restoration and screen-reader announcements after opening a picker or
  completing a save.

### 5. Adapt options without changing configuration semantics

Render capability-dependent help and actions, while keeping every existing
storage key and import/export field. Validation must accept legacy desktop
shortcut and prompt values on mobile. Mobile should warn about unavailable
interactions but must not rewrite them during an unrelated Apply operation.

### 6. Add an Android test path

Follow Mozilla's
[Firefox for Android extension development guide](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/)
to create a repeatable emulator/device run. Keep the existing Chrome and
Firefox desktop suites parallel and unchanged; Android is an additional lane,
not a replacement for either minimum-browser suite.

Automate what the tooling can reliably reach, then retain a short manual matrix
for Android UI and system integration. The harness must use a throwaway Firefox
profile and clean downloaded artifacts, profiles, ports, and browser processes
on success, failure, and interruption.

## Phased delivery

| Phase | Scope | Exit condition |
| --- | --- | --- |
| 0. Device spike | Sideload the current staged bundle; record API presence and failures on supported Firefox Android versions. | Capability matrix and decisions for prompt, paths, notifications, and folder actions are documented. |
| 1. Safe startup | Capability record and optional context-menu registration/building. | Background initializes without `contextMenus`; desktop unit and E2E suites remain green. |
| 2. Safe downloads | Central download capability boundary and honest UI states. | No unsupported API call is made; a basic configured download succeeds on-device. |
| 3. Mobile Page Sources | Responsive panel and destination picker. | A touch-only user can discover, select, route, save, and verify a source. |
| 4. Mobile options | Responsive options and capability-aware actions/help. | Configuration can be edited/imported/exported without losing desktop-only values. |
| 5. Android regression lane | Automated lifecycle/download smoke tests plus manual UX matrix. | Release gates below pass on an emulator and at least one physical device. |
| 6. Distribution | Store copy, compatibility declaration, support notes, and staged release. | No release-blocking telemetry/support issue in the staged cohort. |

## Backward-compatibility rules

- Keep all stored option keys, defaults, routing syntax, directory-menu syntax,
  variables, clauses, history shapes, and message payloads compatible.
- Treat mobile capability adaptation as an input/output boundary. Internal
  refactors must not require profiles to migrate atomically.
- A mobile options save must round-trip unsupported desktop-only values.
- An update from an older extension must tolerate stale content scripts and a
  temporarily unavailable background, as on desktop.
- Do not make the absence of context menus equivalent to the user disabling a
  feature; it is a host capability, not a preference.
- Add legacy-profile and exported-config regression fixtures before changing
  any validation or normalization path.
- Prefer one manifest and one source graph. Introduce Android-specific manifest
  staging only if Firefox/AMO validation proves that unavoidable.

## Verification matrix

### Automated

- Unit: capability detection with missing APIs and partial `downloads` APIs.
- Unit: background startup and options apply without `contextMenus`.
- Unit: `saveAs` is never emitted when unsupported; stored prompt settings are
  preserved.
- Unit: folder/show actions cannot dispatch when unavailable.
- Component: Page Sources at narrow widths, large text, software-keyboard
  viewport, touch input, and reduced motion.
- Integration: action to panel, background cold start, one routed download,
  history update, failure/retry, and extension update/reload.
- Existing Chrome and Firefox desktop unit, typecheck, lint, and E2E gates.

### Real device or emulator

- Action is present in the Add-ons menu and opens the correct tab's panel.
- Images, links, media, HLS/DASH manifests, blob/data URLs, and inaccessible
  sources each produce the intended result or an actionable error.
- Renaming, conflict handling, simple paths, and nested paths land where shown.
- Routing rules and variables behave consistently with desktop; unsupported
  lazy values are labelled rather than rendered as missing data.
- Background termination/restart does not lose pending state or duplicate a
  download.
- Notifications, permissions, private browsing, rotation, back navigation,
  large text, screen readers, and the software keyboard are usable.
- Uninstall/reinstall and failed/interrupted tests leave no downloaded fixtures,
  profiles, ports, or Firefox processes behind.

## Release gates

Android support can be declared only when all of the following are true:

- Startup produces no unhandled error when context menus are absent.
- The extension action opens a usable Page Sources panel.
- A user can save at least one DOM source into a configured destination using
  touch alone, and history reports the outcome accurately.
- No flow sends `saveAs: true` or invokes another unavailable download action.
- Unsupported desktop features are absent or clearly labelled and never erase
  stored desktop settings.
- Import/export round-trips an existing desktop configuration unchanged.
- Chrome and Firefox desktop release checks still pass.
- Android smoke tests pass after a background restart and extension update.
- The workflow passes on the oldest supported Firefox Android version and a
  current stable version, including at least one physical device.

## Open decisions for the device spike

1. Does Firefox Android preserve nested relative paths supplied as a download
   filename under current scoped-storage behavior?
2. Which `downloads` methods and events are present, and which are meaningful
   in Android's system download UI?
3. Do headers, Referer, cookie-store selection, blob URLs, and filename conflict
   actions behave like desktop Firefox?
4. Are extension notifications reliable enough for completion/failure, or
   should mobile use only persistent in-panel status?
5. Should an imported desktop `prompt: true` setting cause an in-panel mobile
   confirmation or block saving until the user makes an explicit choice?
6. Does the current `offscreen` manifest permission pass Android installation
   and AMO validation unchanged?
7. Which Page Sources features are reliable on pages where Firefox restricts
   content scripts, and what fallback should the action show?

These questions must be answered with the staged bundle on Firefox Android;
desktop API presence and viewport emulation are not sufficient evidence.

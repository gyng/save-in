# save-in — Technical Roadmap

_Status: draft for discussion. Targets the `mv3` branch (manifest v4.0.0).
Effort sizing: **S** ≈ hours, **M** ≈ 1–3 days, **L** ≈ a week or more._

> **Verify-before-you-build note.** This repo dropped the webextension
> polyfill and sets `minimum_chrome_version: 123` / Firefox
> `strict_min_version: 121.0`. Several recommendations below assert a browser
> API capability or limitation (module service workers, native messaging,
> clipboard in workers, event-page module support). Every such claim is
> tagged **[verify]** — confirm it against the current minimums on a throwaway
> profile before committing engineering time. The whole extension only talks
> to `browser.*`/`chrome.*` through feature-detection today
> (`Headers.usingBlockingWebRequest`, `SessionState.available`,
> `URL.createObjectURL` probing); keep that discipline.

---

## Executive summary

The codebase is in unusually good shape for its age: one MV3 manifest, no
bundler, 99.5%-line vitest coverage with enforced thresholds, first-party
replacements for every vendored library, and a real two-browser e2e net. The
constraints that made it good — **shipped sources == repository sources** (an
explicit AMO-reviewer selling point, see `README.md` "Notes for reviewers")
and **every `src/*.js` self-exports for vitest** — are also the constraints
that bound this roadmap. The highest-value work is the stuff that _does not_
require a build step.

Top recommendations, in priority order:

1. **Pay down the global-mutation debt first, with no bundler.** Kill
   `requestedDownloadFlag`, make `globalChromeState` a keyed map (it is a
   correctness bug under concurrent tab-strip saves, not just ugliness), and
   split the ~620-line `src/menu.js` by extracting a **pure**
   `Menus.buildTree()`. This de-risks everything else and is fully covered by
   existing tests.
2. **Adopt types via `// @ts-check` + JSDoc + a check-only `tsconfig`**, not a
   `.ts` migration. `src/variable.js` already has `// @ts-check`; there is a
   stale `origin/types` branch to mine. This keeps the no-build property.
3. **Be honest about yt-dlp: a pure webext cannot run it.** Ship the _cheap_
   value first — a "copy yt-dlp command / save `.txt` hand-off" that reuses
   the existing `Shortcut` pipeline — and treat a native-messaging companion
   app as a separate, later, opt-in project.
4. **Turn the parse functions into UI.** A live context-menu-tree preview and
   a guided rule builder both hinge on making `Menus.parsePath`/`buildTree`
   and `Router.parseRule` reusable and side-effect-free — the same
   refactor as item 1. High user value; the `>`/`capture:`/`:$1:` syntax is
   the single most confusing thing in the product.
5. **Formalize the `onMessageExternal` DOWNLOAD API** (version it, document
   the `info` contract, add a capabilities ping). This is small, and it is the
   correct home for both the VideoDownloadHelper story and any external
   downloader integration.

What I would _not_ do: a full ES-module + bundler migration, and bundling
yt-dlp. Both trade away properties the project currently sells (readable
shipped source, zero native install) for benefits this codebase doesn't
yet need.

---

## 1. Architecture refactor / tech-debt

### Where the debt actually is

- **Shared global scope, no modules.** Every `src/*.js` defines a global
  (`Menus`, `Download`, `Path`, `Router`, `Variable`, `Messaging`,
  `OptionsManagement`, `Notification`, `Headers`, `Shortcut`, `SaveHistory`,
  `Log`, `SessionState`) and ends with
  `if (typeof module !== "undefined") module.exports = ...`. Every new
  cross-file global must be hand-registered in `.oxlintrc.json` `globals`.
- **Mutable free-floating globals**: `currentTab` (`index.js:1`),
  `options` (`option.js:7`), plus `window.optionErrors`,
  `window.lastDownloadState`, `window.ready`, `window.SI_DEBUG`. In the
  Chrome SW these live on `self` via the `self.window = self` shim in
  `src/background.js`. ~~`lastUsedPath`~~ → moved onto `Menus.state`;
  ~~`requestedDownloadFlag`~~ → replaced by `Notification.expectDownload()`;
  ~~`globalChromeState`~~ → `Download.pendingStates` keyed map (all **done**).
- ~~**The file list is duplicated**~~ **Done:** still duplicated by necessity
  (no build step), but `scripts/check-background-scripts.js` fails
  `npm run lint` on drift.
- ~~**`src/menu.js` is ~620 lines**~~ **Done:** split into `menu-build.js`
  (parsing + pure `buildTree` + rendering), `menu-click.js`
  (`addDownloadListener` — still the 180-line prefer-links/shortcut/route
  monster, still carrying its `// TODO: refactor this to handle only paths`),
  and `menu-tabs.js` (tab-strip menus + listeners).
- ~~**`globalChromeState` is a genuine race, not just style.**~~ **Done:**
  `Download.pendingStates` is a bounded per-URL map; `globalChromeState`
  survives only as a last-resort fallback for lookups that miss.
- ~~**`requestedDownloadFlag` is a cross-file signalling hack.**~~ **Done:**
  replaced by a module-level counter behind `Notification.expectDownload()`;
  `SessionState.siPendingDownload` remains the SW-restart fallback.
- **FIXMEs**: `index.js:4` (`// FIXME` on `optionErrors` shape),
  `download.js:101` (`// FIXME: Fix router params for new path struct`).

### Recommended path — de-globalise now, defer ESM

**Do not start with a bundler.** A build step is the one change that breaks
the project's headline properties: AMO/CWS get readable sources today
(`README.md` reviewer notes explicitly promise "no build-time
transformations"), and the vitest suite requires each file via the
`module.exports` tail. ESM buys encapsulation this code can get 80% of by
other means. Sequence:

**Phase A — mechanical, no-build, test-covered. Completed July 2026.**

1. ~~**Collapse the two global-mutation hacks.**~~ **Done.**
   - `requestedDownloadFlag` → a module-level counter behind
     `Notification.expectDownload()`; `SessionState.siPendingDownload`
     remains the SW-restart fallback.
   - `globalChromeState` → `Download.pendingStates`, a bounded per-URL map
     consumed by `onDeterminingFilename` and `Headers.refererListener`;
     the old singleton survives only as a last-resort fallback.
2. ~~**Split `menu.js`**~~ **Done:** `menu-build.js` / `menu-click.js` /
   `menu-tabs.js`, still globals + `module.exports`. `lastUsedPath` /
   `lastUsedMeta` moved onto `Menus.state` (same storage.local keys).
3. ~~**Single-source the file list.**~~ **Done, differently:** generating the
   manifest would be a build-time transformation (the README reviewer notes
   promise none), so the two lists stay — but
   `scripts/check-background-scripts.js` diffs them in `npm run lint`.
4. ~~**Extract pure parse/build cores**~~ **Done:** `Menus.buildTree(paths)`
   returns `{ items, errors }` with no `browser.*` calls (`addPaths` renders
   it); `Router.tokenizeLines`/`parseRule` take an error-collector argument
   and only `parseRules` pushes to `window.optionErrors`.

**Phase B — ESM, only if a bundler becomes justified (later, optional).**

Native ESM does not work equally in both targets. Chrome's
`background.service_worker` supports `"type": "module"` and static `import`
**[verify for Chrome 123]**; Firefox's `background.scripts` is an **event
page** that loads _classic_ scripts, and module background scripts are not
available there the same way **[verify for Firefox 121]**. So cross-browser
ESM means a bundler (esbuild/rollup) emitting: an IIFE bundle for the Firefox
event page and an ESM-or-IIFE bundle for the Chrome SW. If you go here:

- Introduce esbuild, keep `npm run build` emitting **unminified** output +
  sourcemaps, and update AMO reviewer notes to point at the repo + build
  command (AMO permits this; it just needs the source).
- Migrate leaf-first: `constants.js` → `path.js`/`variable.js` →
  `router.js`/`shortcut.js` → `download.js`/`headers.js`/`notification.js` →
  `menu*`/`messaging.js` → `index.js`. One module per PR. Each PR flips
  `module.exports` to real `export` and the test from `require` to
  `await import` (some tests already use `vi.resetModules()` +
  `await import`). Coverage stays green because each module still has exports.
- Two entry points (`entry.chrome.js`, `entry.firefox.js`) replace the
  hand-maintained file lists.

**Effort:** Phase A **M** total and high-leverage. Phase B **L** and
optional. **Risk:** Phase A low (mechanical, well-tested); Phase B medium and
it forfeits the readable-shipped-source property. **Dependencies:** Phase A
step 4 unblocks §4/§5; do it before them.

---

## 2. TypeScript adoption via JSDoc + `checkJS` (no build step)

### Recommendation: JSDoc + `// @ts-check` + check-only `tsconfig`. Not `.ts`.

A `.ts` migration requires emit → a bundler → loss of readable-shipped-source
and of the `module.exports` test pattern. JSDoc + `checkJS` gives ~90% of the
safety with `tsc --noEmit` as a pure CI gate and **zero** runtime change. The
repo has already voted for this: `src/variable.js:1` is `// @ts-check`, and
there is a stale `origin/types` branch (`a2b0050 chore: Add initial types`)
to harvest.

### Concrete plan

Foundation **done** (July 2026): check-only `tsconfig.json`
(`allowJs`, `checkJs: false`, opt-in via `// @ts-check`, `noEmit`,
`types: ["firefox-webext-browser"]`), `types/globals.d.ts` declaring the
shared globals plus `StateInfo`/`DownloadState`/`OptionError` typedefs,
`npm run typecheck` in CI. `variable.js` and `path.js` are opted in and
pass. Remaining work is the rollout:

1. **Refine `types/globals.d.ts` as files opt in** — many module globals are
   still `Record<string, any>`; tighten each one when its file (or a caller)
   gets `// @ts-check`. `SaveInOptions` derived from
   `OptionsManagement.OPTION_KEYS` (`option.js:12`) and `ParsedRule`
   (`router.js` `parseRule`) are the highest-value missing typedefs.
2. **Turn files on most-depended-on first**, one PR each:
   `router.js` → `download.js` (the routing/naming core, highest churn),
   then fan out. Gotcha learned: don't use inline `/** @type */ (…)` casts —
   oxfmt strips the parentheses and silently breaks the cast; use typedefs
   or optional fields instead.

**Effort:** setup + globals + core typedefs **M**; each additional
`// @ts-check` **S**. **Risk:** low — it's additive and CI-gated; the only
gotcha is `checkJS` fighting the global scope until `globals.d.ts` exists (do
that first). **Dependencies:** none, but it composes well with §1 (typed
structs make the `globalChromeState`/`state` refactors safer).

---

## 3. yt-dlp / VideoDownloadHelper integration

### Honest feasibility

**A pure WebExtension cannot invoke yt-dlp.** yt-dlp is a native binary; the
`downloads`, `webRequest`, and `fetch` surfaces this extension uses cannot
spawn a process. There are exactly three ways to bridge to native code, in
increasing cost:

**Option A — URL/command hand-off (recommended v1). S–M.**
Reuse what already exists. `src/shortcut.js` (`Shortcut.makeShortcut`,
`Shortcut.suggestShortcutFilename`) already turns a URL into a saved file via
the normal download pipeline. Add:
- A context-menu action / `SHORTCUT_TYPES` variant that saves a `.txt`/`.sh`
  containing `yt-dlp "<url>"` (optionally with the page URL as `--referer`),
  named from the page title. Near-zero new plumbing — it slots into
  `DOWNLOAD_TYPES`/`Shortcut` exactly like the existing `.url`/`.desktop`
  shortcuts.
- Or "Copy yt-dlp command" to clipboard. Note: `navigator.clipboard` is not
  available in an MV3 service worker **[verify]**, so this must round-trip
  through the content script — the `Messaging.send.fetchViaContent` pattern
  (`messaging.js:16`) is the template.

This gives users the value ("get me the real media, run it through yt-dlp")
with no install burden and no store-review risk. Ship it first.

**Option B — Native messaging host / companion app. L (weeks), separate project.**
- Requires `"nativeMessaging"` in `manifest.json` `permissions`, plus a
  separately-installed **native host manifest** registered in the OS
  (registry on Windows, `~/.mozilla/native-messaging-hosts` /
  `NativeMessagingHosts` on \*nix) pointing at an executable, with
  `allowed_extensions`/`allowed_origins` pinned to save-in's IDs **[verify
  current host-manifest schema per browser]**.
- The extension calls `runtime.connectNative(...)` / `sendNativeMessage(...)`;
  the host shells out to yt-dlp.
- **Security is the crux**: the host runs with full user privileges and
  receives URLs from the browser. It must never build a shell command by
  string concatenation (argument-array exec only), must validate the URL
  scheme, and must pin allowed origins. This is the part that gets a
  companion app rejected or exploited.
- **User burden**: install the host + yt-dlp, per-OS installers, upgrades. This
  is why it belongs in a _separate_ companion repo the user opts into, not in
  the core extension. (Prior art: this is exactly how `youtube-dl`/yt-dlp
  browser helpers and VideoDownloadHelper's "CoApp" work.)

**Option C — VideoDownloadHelper interop.**
VDH is itself a separate extension with its own native companion. There is no
public, documented inter-extension API to rely on, so building a bespoke VDH
integration is fragile. **But save-in already has the right primitive**:
`browser.runtime.onMessageExternal` (`messaging.js:116`) accepts
`{ type: "DOWNLOAD", body: { url, info, comment } }` from any extension. The
realistic story is the inverse of "integrate VDH": **formalize save-in's
external API (§7)** so VDH-like extensions (or a small glue extension) can
_push_ a media URL into save-in's routing/renaming pipeline. Recommend
documenting that path rather than coding against VDH internals.

### Recommended scope

Ship **Option A** now (fits the architecture, no install, no review risk).
Formalize the **external API (§7)** as the supported extension-to-extension
path (covers the VDH-ish use case). Treat **Option B** as a clearly-scoped,
separately-distributed companion for power users, explicitly out of the core
extension's "no native install" promise. **Do not bundle yt-dlp.**

---

## 4. Context-menu preview + visual builder

### Today

`options.paths` and `options.filenamePatterns` are raw `<textarea>`s
(`src/options/options.html`). Paths use a line-based mini-syntax parsed by
`Menus.parsePath` (`>` = nesting depth, `//` = comment, `(alias: x)` /
`(key: h)` meta via `Menus.parseMeta`, `---` = separator). The options page
already has: prefix autocomplete (`src/options/autocomplete.js`, fed by the
`GET_KEYWORDS` message), pop-out help (`variablelist.html`,
`clauselist.html`), and a **live routing preview of the last download**
(`updateErrors` in `options.js` → `CHECK_ROUTES` → `OptionsManagement.checkRoutes`).
So the plumbing for "parse in the background, render in the options page" is
proven — we're extending a pattern, not inventing one.

### Live context-menu-tree preview (recommended). M. High value.

The `>`-depth syntax is the #1 support-confusing feature; showing the
resulting tree removes the guesswork.

- **Backend**: add a `PREVIEW_MENUS` message (mirror `CHECK_ROUTES`) that runs
  the **pure** `Menus.buildTree(pathsArray)` extracted in §1-Phase-A-step-4 —
  the nesting-stack logic currently trapped inside `addPaths`
  (`menu.js:189`), minus the `browser.contextMenus.create` calls — and returns
  a nested `{ title, alias, depth, children, isSeparator, error }` tree plus
  the same `window.optionErrors.paths` already surfaced.
- **Frontend**: render a `<ul>` tree next to the paths textarea, updating on
  the existing `input` autosave cycle (`setupAutosave` already debounces and
  refreshes preview). Show alias vs raw dir, separators, and inline the
  per-line validation errors (`Path.Path.validate`) that today only appear in
  the `#error-paths` list.
- **Dependency**: the pure `buildTree` extraction (§1). Doing preview first
  _forces_ that good refactor.

### Visual/form path builder (alternative editing mode). M–L. Medium value.

A table view: one row per path, with indent/outdent buttons (writes `>`),
alias field, accesskey field, and "insert separator". Keep the **textarea as
the source of truth** ("advanced mode"); the form is a two-way view:
`parsePath` → rows for display, serialize rows → text on edit. This avoids a
schema migration and keeps power users happy. Lower priority than the preview
— the preview delivers most of the clarity for a third of the effort.

---

## 5. Rule builder (filename-patterns mini-language)

### The language, precisely

`options.filenamePatterns` is blank-line-separated rules; each rule is lines of
`matcher: regex`, an optional `capture: name[,name...]`, and a required
`into: destination` (`Router.parseRules` → `tokenizeLines` → `parseRule`,
`router.js`). Destinations interpolate regex captures as `:$1:`, `:$2:` and
`:variables:`. Valid matcher names are exactly the keys of
`Router.matcherFunctions` (`context`, `menuindex`, `comment`, `fileext`,
`filename`, `frameurl`, `linktext`, `mediatype`, `naivefilename`,
`pagedomain`, `sourcedomain`, `pagetitle`, `pageurl`, `selectiontext`,
`sourceurl`). `RULE_TYPES` = `MATCHER` / `CAPTURE` / `DESTINATION`.

The hard part for users is `capture:` + `:$1:` — authoring a regex, naming
which matcher to capture, and wiring the group index into the destination.
That is exactly what a builder should target.

### Guided builder. M–L. High value.

- **Per-rule form**: repeatable rows of `[matcher ▼] [regex input]` (the
  dropdown is populated from `GET_KEYWORDS` `matchers` — already available to
  the options page); a `capture` multi-select over the matchers used in that
  rule; an `into` field with "insert `:$1:`" and "insert `:variable:`" buttons
  (reuse `variablelist.html`).
- **Generation**: serialize the form to the exact text block. **Textarea stays
  authoritative** — regenerate text only on an explicit "apply" so hand-written
  `//` comments and spacing aren't silently destroyed (round-trip fidelity
  risk: the form model has no slot for free-text comments).
- **Round-trip in**: parse text → form via a pure variant of
  `Router.parseRule` that _returns_ errors instead of pushing to
  `window.optionErrors` (the §1 side-effect extraction). Live-validate with the
  existing `CHECK_ROUTES` round-trip, which already reports rule errors and,
  when there's a last download, the interpolated result and capture groups
  (`options.js` `updateErrors`, `#capture-group-rows`).
- **Reuse the test preview** already in the page: the builder's "does my rule
  match?" answer is `OptionsManagement.checkRoutes` — no new evaluation engine.

Ship the guided builder and the §4 tree preview together; they share the
"pure parse core + message + render" spine.

---

## 6. Additional `:variables:`

### How a variable is added

Every variable is a key in `SPECIAL_DIRS` (`constants.js:5`) with a matching
transformer in `Variable.transformers` (`variable.js:40`), each shaped
`opts => Path.PathSegment.String(...)` reading the `DownloadInfo` struct
(`url`, `pageUrl`, `sourceUrl`, `now`, `currentTab`, `linkText`,
`selectionText`, `filename`). Adding one automatically flows into
`path.js` (`specialDirRegexp` is built from `Object.values(SPECIAL_DIRS)`) and
into options-page autocomplete (`GET_KEYWORDS` returns
`Object.keys(Variable.transformers)`). **The critical constraint**:
`Variable.applyVariables` is **synchronous** and runs inside
`Download.renameAndDownload` _before_ the download starts. Anything needing
async data (network, storage, clipboard) needs new plumbing.

### Trivial (data already in `opts`, sync) — batch these. S each.

- `:weekday:` / `:dayofweek:` (`now.getDay()` → name), `:monthname:`,
  `:ampm:`, `:week:` / `:isoweek:` (ISO week number from `now`). Pure date math
  alongside the existing `:year:`/`:month:`/`:day:` set.
- **Sanitized page-title variants**: `:pagetitleslug:`
  (lowercase-dashed), `:pagetitlesnake:` — string transforms of
  `currentTab.title`. Genuinely useful; the raw `:pagetitle:` often has spaces
  and punctuation users then strip by hand.
- **URL-part variants** from `new URL(opts.url)`: `:sourcepath:` (pathname),
  `:tld:`, `:sourcequery:` (a named query param, if we allow the "parameterized
  variable" grammar below). `withUrl` (`variable.js:5`) already exists as the
  safe wrapper.

### Non-trivial (need new plumbing) — pick deliberately.

- **`:counter:` (incrementing)** — needs persistent, atomic state in
  `storage.local` that survives SW restarts. **Requires async transformers.**
  High user value (dedup, sequencing), so it's the best reason to make the
  jump.
- **`:mime:` / `:contenttype:`** — the Firefox path already does a
  `HEAD` fetch and reads `res.headers` (`download.js:211`); the Chrome path
  deliberately skips HEAD and uses `onDeterminingFilename`, so MIME isn't known
  when the _directory_ path is computed. Cross-browser asymmetry + async. Doable
  but not free.
- **Regex-extracted-from-URL** (`:urlmatch:(pattern):`) — the variable grammar
  today has **no parameters**; tokens are fixed strings matched by
  `specialDirRegexp`. Supporting arguments means extending `parsePathStr`
  tokenization (or reusing the routing `capture`/`:$1:` machinery, which
  already does regex capture for _rules_). Medium plumbing, high power.
- **`:filesize:`** — **not feasible pre-download.** Size is only known from the
  `onChanged` delta / `downloads.search` _after_ the file starts. It cannot be
  in the target path at `downloads.download` time. Be honest and drop it (or
  offer it only as post-hoc rename, which is a much bigger feature).
- **`:clipboard:`** — no clipboard read in an MV3 worker **[verify]**; needs a
  content-script round-trip + permission prompts. Low value / high cost —
  deprioritize.

### Recommendation

Ship the trivial date/title/URL batch now (**S**, big perceived value for the
effort). Make **one** plumbing investment: convert `Variable.applyVariables`
to async (return a `Promise`, `await` in `renameAndDownload`), which unlocks
`:counter:` and `:mime:`. That change ripples into `option.js`
`checkRoutes` and the `messaging.js` `CHECK_ROUTES` variable-interpolation loop
and their tests — scope it as **M** and land it on its own PR.

---

## 7. Official integration guide + versioned external API

### What exists

`browser.runtime.onMessageExternal` and `onMessage` both handle
`{ type: "DOWNLOAD", body: { url, info, comment } }` →
`Messaging.handleDownloadMessage` (`messaging.js:64`), which builds a
`DownloadState`, runs it through the same routing/rename pipeline as a menu
click, and replies `{ type: "DOWNLOAD", body: { status: "OK" } }`. It's
documented as "unofficial and unsupported" in `README.md` and the Foxy
Gestures wiki, keyed to the gecko id `{72d92df5-2aa0-4b06-b807-aa21767545cd}`
(Chrome uses the Web Store id). `onMessageExternal` accepts from **any**
extension by default.

### Recommendation: formalize and version it (v1). S–M.

1. **Message schema + versioning.** Accept an optional `version` (default `1`),
   and document the full `info` contract — every field the pipeline actually
   reads, grounded in `handleDownloadMessage` + the routing matchers:
   `pageUrl`, `srcUrl`/`sourceUrl`, `selectionText`, `linkText`, `comment`
   (targetable in rules), `menuIndex`, `modifiers`.
2. **Capabilities ping.** Add a `{ type: "PING" }` → `{ version, capabilities:
   [...] }` handler so callers can negotiate before sending. Cheap, and it's
   what turns "unofficial" into "supported".
3. **Response contract.** Today only `OK` is returned. Add typed errors
   (`INVALID_URL`, `BAD_REQUEST`) and echo the resolved final path so callers
   can confirm/routes. Keep back-compat: old `{ status: OK }` shape stays.
4. **Security note in the guide.** `onMessageExternal` is open to all
   extensions and _triggers downloads_ — a mild abuse vector. Consider an
   optional sender allowlist option, and document the trust model plainly.
5. **Examples**: Foxy Gestures (existing), a minimal 20-line standalone driver
   extension, and — tying to §3 — "how a media-extraction extension (VDH-like)
   pushes a URL into save-in." Add a couple of e2e assertions; the harness
   already drives messaging (`e2e/chrome.e2e.mjs`).

This is the correct home for the extension-to-extension half of §3, and it's
small. Version it now while the only known consumer is a documented wiki
example — cheap to do before an ecosystem forms, expensive after.

---

## Suggested sequencing & priority

| # | Item | Effort | Risk | Value | Depends on | When |
|---|------|--------|------|-------|-----------|------|
| 1 | ~~Kill `requestedDownloadFlag`; make `globalChromeState` a keyed map (fixes concurrent tab-strip race)~~ | M | Low–Med | High (correctness) | — | **Done** |
| 2 | ~~Split `menu.js`; single-source the background file list~~ (guarded by `scripts/check-background-scripts.js` in lint) | M | Low | Med (maintainability) | — | **Done** |
| 3 | ~~Extract pure `Menus.buildTree` + side-effect-free `parseRule`~~ | M | Low | High (unblocks §4/§5) | 2 | **Done** |
| 4 | ~~`tsconfig` + `globals.d.ts` + core typedefs; `tsc --noEmit` in CI~~ (`variable.js` + `path.js` opted in) | M | Low | High (safety) | — | **Done** |
| 5 | Trivial `:variables:` batch (weekday, week, title slugs, URL parts) | S | Low | Med–High | — | **Next release** |
| 6 | Live context-menu tree preview in options page | M | Low | High (UX) | 3 | **Next release** |
| 7 | Formalize + version the external DOWNLOAD API (+ PING, docs, e2e) | S–M | Low | Med–High | — | **Next release** |
| 8 | yt-dlp "copy command / save `.txt`" hand-off via `Shortcut` | S–M | Low | Med–High | — | **Next release / +1** |
| 9 | Guided rule builder (form for matcher/capture/into) | M–L | Med | High (UX) | 3, 7-style preview | **+1** |
| 10 | Async `applyVariables` → `:counter:`, `:mime:` | M | Med | Med–High | 4 helps | **+1** |
| 11 | Per-file `// @ts-check` rollout (path→router→download→…) | S each | Low | Med | 4 | **+1, ongoing** |
| 12 | Visual/form path builder | M–L | Med | Med | 6 | **+2** |
| 13 | ESM + bundler migration (only if justified) | L | Med–High | Low–Med | 1–3 | **Defer** |
| 14 | Native-messaging yt-dlp companion (separate repo) | L | High | Med (power users) | 7 | **Defer / separate** |

**Next-release theme:** de-globalise, add types, and turn the existing parse
functions into UI (preview + variables + external API). All no-build, all
test-covered, all high-leverage.

**Deliberately deferred:** the bundler/ESM migration and the yt-dlp native
companion — each forfeits a property the project currently sells (readable
shipped source; zero native install). Revisit only when a concrete need
outweighs that.

_Every **[verify]** tag above is a browser-API assumption to confirm against
Chrome 123 / Firefox 121 before building on it — this repo runs polyfill-free
and lives or dies on feature detection._

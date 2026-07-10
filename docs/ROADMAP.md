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
> (`RequestHeaders.usingBlockingWebRequest`, `SessionState.available`,
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
2. **Adopt types via JSDoc + a check-only `tsconfig`**, not a `.ts`
   migration. **Done:** `checkJs` now covers every src file
   (`npm run typecheck` in CI). This keeps the no-build property.
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
  `OptionsManagement`, `Notifier`, `RequestHeaders`, `Shortcut`, `SaveHistory`,
  `Log`, `SessionState`) and ends with
  `if (typeof module !== "undefined") module.exports = ...`. Every new
  cross-file global must be hand-registered in `.oxlintrc.json` `globals`.
- **Mutable free-floating globals**: `currentTab` (`index.js:1`),
  `options` (`option.js:7`), plus `window.optionErrors`,
  `window.lastDownloadState`, `window.ready`, `window.SI_DEBUG`. In the
  Chrome SW these live on `self` via the `self.window = self` shim in
  `src/background.js`. ~~`lastUsedPath`~~ → moved onto `Menus.state`;
  ~~`requestedDownloadFlag`~~ → replaced by `Notifier.expectDownload()`;
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
  replaced by a module-level counter behind `Notifier.expectDownload()`;
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
     `Notifier.expectDownload()`; `SessionState.siPendingDownload`
     remains the SW-restart fallback.
   - `globalChromeState` → `Download.pendingStates`, a bounded per-URL map
     consumed by `onDeterminingFilename` and `RequestHeaders.refererListener`;
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

### Recommendation: JSDoc + `checkJs` + check-only `tsconfig`. Not `.ts`.

A `.ts` migration requires emit → a bundler → loss of readable-shipped-source
and of the `module.exports` test pattern. JSDoc + `checkJs` gives ~90% of the
safety with `tsc --noEmit` as a pure CI gate and **zero** runtime change.

### Status: done (July 2026)

Check-only `tsconfig.json` (`allowJs`, **`checkJs: true` over all of src/**,
`noEmit`, `types: ["firefox-webext-browser", "chrome"]`),
`types/globals.d.ts` declaring the shared globals plus
`StateInfo`/`DownloadState`/`OptionError` typedefs, `npm run typecheck` in
CI. Getting there required renaming two runtime globals that shadowed
platform classes (`Notification` → `Notifier`, `Headers` →
`RequestHeaders`) — the old 2022 `origin/types` branch died on exactly this.
Gotcha learned: don't use inline `/** @type */ (…)` casts — oxfmt strips the
parentheses and silently breaks the cast; use typedefs or optional fields.

Remaining rollout (incremental, optional):

1. **Refine `types/globals.d.ts`** — many module globals are still
   `Record<string, any>`; tighten them as their files change.
   `SaveInOptions` derived from `OptionsManagement.OPTION_KEYS`
   (`option.js:12`) and `ParsedRule` (`router.js` `parseRule`) are the
   highest-value missing typedefs.
2. **Raise strictness gradually** — `strict: false` today; `noImplicitAny`
   and `strictNullChecks` are the next gates, each a sweep of its own.

**Effort:** remaining refinement **S** each. **Risk:** low — additive and
CI-gated. **Dependencies:** none.

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

### Live context-menu-tree preview. Done (July 2026).

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

The trivial date/title/URL batch is **shipped** (see table #5). The next step is
the **one plumbing investment**: convert `Variable.applyVariables` to async.

**Land it as two PRs:**

1. **Pure async refactor, no new variables.** A transformer may return a value
   _or_ a `Promise`; `applyVariables` wraps the `path.buf` map in `Promise.all`
   and returns `Promise<Path>`. Existing sync transformers resolve instantly, so
   output is byte-identical. The four call sites `await`:
   `download.js:194,198` (`renameAndDownload` — fire-and-forget, so awaiting
   internally is safe), `option.js:148` (`checkRoutes` preview), and
   `messaging.js:282` (the `CHECK_ROUTES` interpolation `reduce` → `Promise.all`).
   Ripples into `variable`/`download-flow`/`router`/`option`/`messaging` tests
   (add `await`). **M**, risk is the test sweep, not the logic.
2. **New variables on top.** In value-per-effort order:
   - **`:counter:`/`:count:`** — atomic incrementing `storage.local` state,
     serialized read-modify-write via the `SaveHistory.writeQueue` pattern so
     concurrent saves don't race. Survives SW restarts.
   - **`:mime:`/`:contenttype:`** and **MIME-derived `:ext:`** — from a `HEAD`
     `Content-Type` (Firefox already HEADs, `download.js:347`; Chrome would add
     one or read `onDeterminingFilename`). **This is the same capability as
     §8.1** — do the extension-correctness reliability fix here.
   - **`:finalurl:`/`:redirecturl:`** — URL after redirects, from the HEAD/fetch.
   - **`:uuid:`** — _shipped._ Sync `crypto.randomUUID()` (secure context in the
     SW, event page and Node). Fresh per use.
   - **`:sha256:`** — _shipped._ SHA-256 of the content, native via
     `crypto.subtle.digest`. Content hashing needs the bytes, so it fetches the
     file — but that **one fetch is shared with the save**: `Download.resolveContent`
     fetches once (in the offscreen document on Chrome, in-context on the event
     page), digests, and hands the download a reusable blob URL, so a hashed save
     is not downloaded twice (`info.contentPromise`; e2e asserts a single origin
     hit). Presence of `:sha256:` therefore forces the blob download path. Capped
     (`HASH_MAX_BYTES`) + timed out; blank on failure so it never blocks a save.
   - **`:md5:` (content hash)** — _held._ **MD5 is not in Web Crypto**, so it
     needs a small vendored pure-JS implementation; it's legacy and only buys
     server-ETag parity. Ship only if a user needs it (it would reuse
     `resolveContent`'s single fetch, same as `:sha256:`).
   - _Not worth it:_ `:filesize:` (known only post-download — drop),
     `:clipboard:` (no worker clipboard; content-script round-trip — low value),
     image dimensions (decode the blob — niche). `:urlmatch:(regex):` is
     high-power but needs a **parameterized-variable grammar** — separate, bigger.

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

**Status: shipped (v1, v4.0.0).** `PING` → `{ version, capabilities }`;
`DOWNLOAD` validates the URL scheme and returns typed `OK`/`ERROR`; More
Options → External API surfaces the id + snippet. Remaining: `RESOLVE_PATH`
(compute the save path without downloading, for downloader hand-offs) and the
scriptable-config messages in §9.

---

## 8. Core download reliability

Not previously on this roadmap — surfaced by a full pipeline audit plus the long
tail of site-specific bugs (#66 pixiv, #166 Instagram, #126/#135/#43 extensions,
#28 false failures, #193 referer-on-redirect). Five workstreams, most-valuable
first; all reference `src/download.js` / `headers.js` / `notification.js`.

### 8.1 Filename & extension correctness. M. High. #73/#126/#135/#43. ✅ DONE (mostly).

Extension is parsed **from the URL string only** (`EXTENSION_REGEX`,
`download.js:9`) — there is **no MIME→extension mapping anywhere**, so
extensionless CDN URLs and `?format=jpg` query-suffix images save without an
extension. On Chrome the browser's own resolved filename
(`onDeterminingFilename`, which honours Content-Disposition/MIME) is
**discarded whenever a routing rule or `:name:`/`:ext:` template sets the name**
(`download.js:144-152`).

- Split the **directory decision** (routing) from the **filename decision**: a
  rule that only chooses a folder should let the browser/CD/MIME name the file.
- Add a MIME→extension fallback for extensionless targets — **the same
  capability as the `:mime:`/`:ext:` variables (§6); do them together** on the
  #10 async refactor.
- Fix `EXTENSION_REGEX` false-positives (`file.12345` → bogus `.12345`).

### 8.2 Concurrency & SW-restart correctness. M. High (kills silent failures).

- `siPendingDownload` is a **boolean, not a counter** (`notification.js`): after
  a worker restart, two near-simultaneous downloads → the first flips it false
  and the **second is never tracked → no notification at all**. Make it a
  counter or keyed set.
- `siFinalFilename` is a single value → concurrent downloads suggest the same
  filename. Key by download id.
- DNR referer uses a single fixed rule id (`DNR_REFERER_RULE_ID = 4077`,
  `headers.js:35`) → concurrent referers clobber. Allocate per-download ids.

### 8.3 Referer robustness. M. #66 (pixiv), #193. ✅ DONE.

Chrome's DNR `urlFilter` is the **pre-redirect URL**, so the Referer often isn't
applied after a redirect (what hotlink-protected CDNs do). Firefox's redirect
leg falls back to the most-recent global state (wrong under concurrency), and the
Firefox HEAD probe (`download.js:347`) carries no Referer (#193). Broaden the DNR
condition (or re-arm on the redirect target) and key the Firefox listener by
`requestId`. **[verify]** current DNR redirect semantics per Chrome.

### 8.4 Notification accuracy. S–M. #28.

Firefox counts `state === "interrupted"` as failure → spurious "failed" toasts
for paused/resumable interruptions. Downloads lost from bookkeeping produce
**no** notification; immediate `downloads.download` rejections are only logged.
Distinguish terminal from resumable, and surface the rejections.

### 8.5 Fetch-fallback limits. S–M. #166, large files. ✅ DONE (offscreen).

MV3 has no `URL.createObjectURL`, so blob fallbacks base64 the whole file into a
`data:` URL in memory (`download.js:114-123`) — large files exhaust memory / hit
Chrome's data-URL cap. `fetchViaContent` uses `no-cors` → opaque **0-byte**
downloads cross-origin (`content.js`). Prefer `fetchViaFetch`; document/limit
the data-URL ceiling.

**The real fix — an Offscreen Document (Chrome). ✅ DONE.** `chrome.offscreen`
(permission: `offscreen`, Chrome-only) creates a hidden page with a full DOM,
so `URL.createObjectURL` works there. The SW asks the offscreen doc to fetch the
URL (credentials/referer intact) and hand back a blob URL, then downloads it — no
base64, no memory blowup, no data-URL cap. Blob URLs die with their creating
document, so the offscreen doc is kept alive and the blob URL revoked on a TTL
(`OFFSCREEN_BLOB_TTL_MS`) after `downloads.download` consumes it. `fetchDownload`
gates on `Download.canUseOffscreen()` (feature-detects `chrome.offscreen` +
absent `createObjectURL`) and falls back to the `data:` URL path if the offscreen
doc can't be created; Firefox keeps `createObjectURL` on its event page.
Implemented in `src/offscreen.{html,js}` + `Download.fetchViaOffscreen`;
covered by `test/download-mv3.test.js` and a Chrome e2e case.

---

## 9. Scriptable / AI-assisted configuration

The full design is in `docs/INTEGRATIONS.md §4`. Options are already a typed
schema (`OptionsManagement.OPTION_KEYS`) and the `paths`/`filenamePatterns`
grammars are pure and return structured errors, so the generate → validate → fix
loop is a natural fit. Ride the now-versioned external API (§7) and add three
messages (also add them to the `PING` `capabilities`):

1. **`GET_SCHEMA`** — `OPTION_KEYS` + a one-line human description per field.
   (We already send `OPTIONS_SCHEMA` internally; formalize + document it.)
2. **`VALIDATE`** — dry-run `{ paths?, filenamePatterns? }` →
   `{ pathErrors, ruleErrors, menuPreview }`. `PREVIEW_MENUS` + `CHECK_ROUTES`
   generalised, no new grammar.
3. **`APPLY_CONFIG`** — partial, schema-validated apply (unknown keys rejected,
   types coerced by the existing `onLoad` validators). Scriptable Import — and it
   **also closes #89** (invalid imported options silently breaking downloads).

Plus an options-page "Paste config" box (human-in-the-loop `VALIDATE` + preview)
and a self-describing prompt pack (schema + worked examples) users can paste into
any LLM. Guardrails already exist (invalid regex drops the rule, path traversal
rejected, import can't widen permissions). **S–M** each.

### WebMCP (browser-native AI tools) — shipped experimentally.

**Done (experimental).** `src/options/webmcp.js` registers four tools on the
options-page document, feature-detected on `document.modelContext`. Verified
end-to-end on Chrome 150 with the WebMCP flags: `getTools()` returns
`save_in_{get_schema,validate_config,apply_config,download}` and `executeTool`
round-trips (get_schema returned the full option list, validate_config parsed a
rule with no errors). The notes below record the original assessment.

---

_Original assessment:_

Chrome's [WebMCP imperative
API](https://developer.chrome.com/docs/ai/webmcp/imperative-api) lets a page or
extension register tools an in-browser AI agent can discover and call:
`document.modelContext.registerTool({ name, description, inputSchema, execute })`
(the surface already moved from `navigator.` to `document.`), discovered via
`getTools()` and invoked via `executeTool()`. It is the browser-native form of
exactly what §7/§9 expose over messaging — and it maps **1:1**:

- `save_url` → `Messaging.handleDownloadMessage` (inputSchema = `{ url, info?,
  comment? }`).
- `validate_config` → `VALIDATE` (pure `buildTree`/`parseRules`, structured
  errors — ideal for an agent's generate→validate→fix loop).
- `apply_config` → `APPLY_CONFIG`; `get_schema` is just tool discovery.

**Why not now:** it's an **origin trial**, Chrome-only, and explicitly "subject
to change" (the `navigator`→`document` rename already happened). Shipping it in a
polyfill-free stable extension would violate the feature-detection discipline.

**What to do:** build §9's messaging API first (stable, cross-browser), with each
handler a thin wrapper over an internal function (`handleDownloadMessage`,
`checkRoutes`, `buildTree`, `applyConfig`). Then a WebMCP adapter is ~30 lines
that `registerTool`s each with an `execute` calling the same internals — feature
-detected on `document.modelContext`, added when it leaves origin trial. Verify
the extension-context registration story before committing.

---

## Suggested sequencing & priority

| # | Item | Effort | Risk | Value | Depends on | When |
|---|------|--------|------|-------|-----------|------|
| 1 | ~~Kill `requestedDownloadFlag`; make `globalChromeState` a keyed map (fixes concurrent tab-strip race)~~ | M | Low–Med | High (correctness) | — | **Done** |
| 2 | ~~Split `menu.js`; single-source the background file list~~ (guarded by `scripts/check-background-scripts.js` in lint) | M | Low | Med (maintainability) | — | **Done** |
| 3 | ~~Extract pure `Menus.buildTree` + side-effect-free `parseRule`~~ | M | Low | High (unblocks §4/§5) | 2 | **Done** |
| 4 | ~~`tsconfig` + `globals.d.ts` + core typedefs; `tsc --noEmit` in CI~~ (checkJs over all of src/) | M | Low | High (safety) | — | **Done** |
| 5 | ~~Trivial `:variables:` batch (weekday, week, title slugs, URL parts)~~ | S | Low | Med–High | — | **Done** |
| 6 | ~~Live context-menu tree preview in options page~~ (PREVIEW_MENUS message + #menu-preview) | M | Low | High (UX) | 3 | **Done** |
| 7 | ~~Formalize + version the external DOWNLOAD API (PING, typed errors, docs)~~ | S–M | Low | Med–High | — | **Done (v1)** |
| 8 | yt-dlp "copy command / save `.txt`" hand-off via `Shortcut` | S–M | Low | Med–High | — | **+1** |
| 9 | ~~Guided rule builder~~ (shipped as quick-add row + template library; capture rules via templates) | M–L | Med | High (UX) | 3, 7-style preview | **Done** |
| 10a | ~~Async `applyVariables` refactor~~ (Promise.all, no new variables) | M | Med (test sweep) | Med–High | 4 helps | **Done** |
| 10b | ~~New async variables~~ (`:counter:`, `:uuid:`, `:mime:`/`:contenttype:`/`:mimeext:`) | M | Med | Med–High | 10a | **Done** |
| 11 | ~~Per-file `// @ts-check` rollout~~ (superseded: checkJs covers all of src/) | S each | Low | Med | 4 | **Done** |
| 12 | ~~Visual/form path builder~~ (Visual Editor tab + insert menu) | M–L | Med | Med | 6 | **Done** |
| 13 | ~~**§8.1 Filename/extension correctness**~~ — `appendMimeExtension` auto-appends the Content-Type extension to extensionless names; `EXTENSION_REGEX` no longer false-positives on all-digit tokens (directory/filename routing split still open) | M | Med | High | 10a | **Done** |
| 14 | ~~§8.2 Concurrency / SW-restart correctness~~ (pending counter, per-URL filename map, per-download DNR id) | M | Med | High (silent failures) | — | **Done** |
| 15 | ~~§9 AI config: `GET_SCHEMA` / `VALIDATE` / `APPLY_CONFIG`~~ (closes #89) + experimental WebMCP adapter | S–M | Low | Med–High | 7 | **Done** |
| 16 | ~~**§8.3 Referer on redirects**~~ (#66 pixiv, #193) — Firefox listener keyed by requestId (survives redirects/concurrency); Chrome DNR scoped to the source host for same-host signed-URL redirects | M | Med | Med–High | — | **Done** |
| 17 | ESM + bundler migration (only if justified) | L | Med–High | Low–Med | 1–3 | **Defer** |
| 18 | Native-messaging yt-dlp companion (separate repo) | L | High | Med (power users) | 7 | **Defer / separate** |

**Recommended build order:** ~~10a → 10b → 14~~ (done). Remaining: 15
(AI-config trio, also closes #89) → 13 (§8.1 pipeline: auto-append the MIME
extension to the saved filename) → 16 (referer on redirects / pixiv) → 8 (yt-dlp
hand-off).

**Deliberately deferred:** the bundler/ESM migration and the yt-dlp native
companion — each forfeits a property the project currently sells (readable
shipped source; zero native install). Revisit only when a concrete need
outweighs that.

**Deliberately deferred:** the bundler/ESM migration and the yt-dlp native
companion — each forfeits a property the project currently sells (readable
shipped source; zero native install). Revisit only when a concrete need
outweighs that.

_Every **[verify]** tag above is a browser-API assumption to confirm against
Chrome 123 / Firefox 121 before building on it — this repo runs polyfill-free
and lives or dies on feature detection._

# Published-release issue sweep — 2026-09-05

Reviewed all 82 open issues in `gyng/save-in`, including their comments, after
the maintainer explicitly authorized replies and closures. Posted concise
release-specific replies on 38 verified resolved issues and closed each
with GitHub's `completed` reason. Left 44 issues open where requirements
remain, behavior is only partially covered, or a fix could not be verified.

This record supersedes the closure recommendations in the historical
[v4 validation notes](issues-v4.md). No issues were closed as stale, duplicate,
or not planned, and no unresolved issue received a speculative fixed claim.

## Release and verification

- Verified the published [4.1.0 release](https://github.com/gyng/save-in/releases/tag/v4.1.0)
  at `f7d711a442a49e60f321249018cd00702431ce93` in a separate source snapshot.
  Unreleased `master` fixes were not credited to 4.1.0. Replies say the fix is
  available in 4.1.0 rather than
  implying every feature was first introduced there; #234 identifies 4.0.1.
- Confirmed version 4.1.0 in both the
  [Chrome Web Store](https://chromewebstore.google.com/detail/save-in/jpblofcpgfjikaapfedldfeilmpgkedf)
  and [AMO](https://addons.mozilla.org/en-US/firefox/addon/save-in/), and confirmed
  the GitHub release includes the Chromium CRX requested in #225.
- The released code passed 2,235 focused routing, download, content, menu,
  messaging, platform, History, configuration normalization, and options-field
  synchronization tests.
- All nine on-demand live-site tests passed, including Pixiv's Referer gate.
- The release's complete browser suites passed: 66 tests on Chrome 150.0.7871.114
  and 46 on Firefox 152.0.6, including both History RSS regression gates.
- Three temporary execution probes verified the exact reply examples for
  #187, #209, and the shared folder-capture recipe for #50/#208. In particular,
  #209 needs `rename: ^https?:// ->`, not the historical `^https?_+` suggestion:
  renaming precedes sanitization. The original suggestion failed the probe;
  the corrected example passed with the reporter's complete filename recipe.
- Before each reply, rechecked the issue's state and update timestamp. After
  posting, verified each closure through the GitHub API. The links below point
  to the actual replies, not proposed drafts. A final tracker query confirmed
  that exactly the 44 issues listed below remain open.

## Replied and closed

Source links are pinned to the verified release. These establish the mechanism;
they do not imply a live retest of every reporter's original website or browser fork.

| Issue | Posted reply | Release evidence |
| --- | --- | --- |
| [#234](https://github.com/gyng/save-in/issues/234) huge amount of memory used when this addon is working, making FF to crash | [Reply](https://github.com/gyng/save-in/issues/234#issuecomment-5550445836) | [history.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/background/history.ts), [history.test.ts](https://github.com/gyng/save-in/blob/v4.1.0/test/downloads/history/history.test.ts) |
| [#226](https://github.com/gyng/save-in/issues/226) alt klick on pdf link doesnt save the pdf | [Reply](https://github.com/gyng/save-in/issues/226#issuecomment-5550446401) | [content.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/content/content.ts), [content.test.ts](https://github.com/gyng/save-in/blob/v4.1.0/test/content/content.test.ts) |
| [#225](https://github.com/gyng/save-in/issues/225) Chromium killed save-in with update | [Reply](https://github.com/gyng/save-in/issues/225#issuecomment-5550447027) | Published release and live store listing |
| [#222](https://github.com/gyng/save-in/issues/222) Enabling "Set the "Referer" header to page URL if it's missing" disables the button from the dropdown menu | [Reply](https://github.com/gyng/save-in/issues/222#issuecomment-5550447663) | [menu-rebuild.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/background/menu-rebuild.ts), [referer-rules.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/downloads/referer-rules.ts) |
| [#221](https://github.com/gyng/save-in/issues/221) pagedomain / sourcedomain variables without subdomain | [Reply](https://github.com/gyng/save-in/issues/221#issuecomment-5550448244) | [domain.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/shared/domain.ts), [variable.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/routing/variable.ts) |
| [#220](https://github.com/gyng/save-in/issues/220) Dynamic downloads don't work when there are secret chars in the page title | [Reply](https://github.com/gyng/save-in/issues/220#issuecomment-5550448857) | [constants.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/shared/constants.ts), [variable.test.ts](https://github.com/gyng/save-in/blob/v4.1.0/test/routing/variable.test.ts) |
| [#216](https://github.com/gyng/save-in/issues/216) [Feature Request] Fix the logging | [Reply](https://github.com/gyng/save-in/issues/216#issuecomment-5550449497) | [history-entry.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/downloads/history-entry.ts), [history.test.ts](https://github.com/gyng/save-in/blob/v4.1.0/test/downloads/history/history.test.ts) |
| [#213](https://github.com/gyng/save-in/issues/213) why a "." for Downloads folder? Rename? | [Reply](https://github.com/gyng/save-in/issues/213#issuecomment-5550450159) | [option-defaults.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/config/option-defaults.ts), [directory-parser.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/menus/directory-parser.ts) |
| [#212](https://github.com/gyng/save-in/issues/212) Filename variable not working | [Reply](https://github.com/gyng/save-in/issues/212#issuecomment-5550450738) | [download-disposition.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/downloads/download-disposition.ts), [download-disposition.test.ts](https://github.com/gyng/save-in/blob/v4.1.0/test/downloads/download-disposition.test.ts) |
| [#210](https://github.com/gyng/save-in/issues/210) Twitter renaming | [Reply](https://github.com/gyng/save-in/issues/210#issuecomment-5550451422) | [rule-templates.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/options/rule-editor/rule-templates.ts), [core-matcher-regressions.test.ts](https://github.com/gyng/save-in/blob/v4.1.0/test/routing/core-matcher-regressions.test.ts) |
| [#209](https://github.com/gyng/save-in/issues/209) Regex to remove 'http://' and 'https://' from final filenames? | [Reply](https://github.com/gyng/save-in/issues/209#issuecomment-5550453980) | [download-disposition.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/downloads/download-disposition.ts) |
| [#208](https://github.com/gyng/save-in/issues/208) Feature request: Rename downloads -> Please add a folder name variable | [Reply](https://github.com/gyng/save-in/issues/208#issuecomment-5550454674) | [variable.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/routing/variable.ts) |
| [#194](https://github.com/gyng/save-in/issues/194) [FR] Add description about behavior of multiple routing rules | [Reply](https://github.com/gyng/save-in/issues/194#issuecomment-5550455520) | [ROUTING-ACTIONS.md](https://github.com/gyng/save-in/blob/v4.1.0/docs/using/ROUTING-ACTIONS.md), [route-debugger.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/options/route-debugger/route-debugger.ts) |
| [#193](https://github.com/gyng/save-in/issues/193) Pass Referer when following redirections in HEAD requests | [Reply](https://github.com/gyng/save-in/issues/193#issuecomment-5550456261) | [variable.test.ts](https://github.com/gyng/save-in/blob/v4.1.0/test/routing/variable.test.ts), [referer-rules.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/downloads/referer-rules.ts) |
| [#189](https://github.com/gyng/save-in/issues/189) Issues with Dynamic Downloads/Rename and Route rules with DeviantArt.com | [Reply](https://github.com/gyng/save-in/issues/189#issuecomment-5550456982) | [matchers.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/routing/matchers.ts), [filename-listener.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/downloads/filename-listener.ts) |
| [#188](https://github.com/gyng/save-in/issues/188) [Bug] With the Dynamic Downloads/Rename and Route editor, last download pagetitle changes to "Add-ons Manager" with any change | [Reply](https://github.com/gyng/save-in/issues/188#issuecomment-5550457635) | [menu-click.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/background/menu-click.ts), [handlers.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/background/messaging/handlers.ts) |
| [#187](https://github.com/gyng/save-in/issues/187) [Feature Request] Change filename characters with Dynamic Downloads/Rename and Route | [Reply](https://github.com/gyng/save-in/issues/187#issuecomment-5550458399) | [rename.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/routing/rename.ts) |
| [#186](https://github.com/gyng/save-in/issues/186) Waterfox detected as Chrome | [Reply](https://github.com/gyng/save-in/issues/186#issuecomment-5550459075) | [chrome-detector.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/platform/chrome-detector.ts), [chrome-detector.test.ts](https://github.com/gyng/save-in/blob/v4.1.0/test/platform/chrome-detector.test.ts) |
| [#178](https://github.com/gyng/save-in/issues/178) php generated download - td.php name is captured (instead on name.torrent). | [Reply](https://github.com/gyng/save-in/issues/178#issuecomment-5550459727) | [matchers.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/routing/matchers.ts), [download-plan.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/downloads/download-plan.ts) |
| [#172](https://github.com/gyng/save-in/issues/172) Chrome 91 :pagetitle: taking other tab's page title | [Reply](https://github.com/gyng/save-in/issues/172#issuecomment-5550460444) | [menu-click.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/background/menu-click.ts), [download-listener.cases.ts](https://github.com/gyng/save-in/blob/v4.1.0/test/background/menus/download-listener.cases.ts) |
| [#162](https://github.com/gyng/save-in/issues/162) Click To Save | [Reply](https://github.com/gyng/save-in/issues/162#issuecomment-5550463711) | [handlers.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/background/messaging/handlers.ts), [messaging-download-api.test.ts](https://github.com/gyng/save-in/blob/v4.1.0/test/background/messaging/messaging-download-api.test.ts) |
| [#161](https://github.com/gyng/save-in/issues/161) small fix request: on Linux, Chrome, shortcuts are saved with the wrong extension ('txt' instead of 'desktop') | [Reply](https://github.com/gyng/save-in/issues/161#issuecomment-5550464561) | [shortcut.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/downloads/shortcut.ts), [shortcut.test.ts](https://github.com/gyng/save-in/blob/v4.1.0/test/downloads/shortcut.test.ts) |
| [#159](https://github.com/gyng/save-in/issues/159) [Feature Request] Can some sort of logging be added? | [Reply](https://github.com/gyng/save-in/issues/159#issuecomment-5550465416) | [history.test.ts](https://github.com/gyng/save-in/blob/v4.1.0/test/downloads/history/history.test.ts), [history-entry.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/downloads/history-entry.ts) |
| [#144](https://github.com/gyng/save-in/issues/144) [Request] Quick Save option - no sub-menu | [Reply](https://github.com/gyng/save-in/issues/144#issuecomment-5550466305) | [menu-rebuild.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/background/menu-rebuild.ts), [menu.test.ts](https://github.com/gyng/save-in/blob/v4.1.0/test/background/menus/menu.test.ts) |
| [#137](https://github.com/gyng/save-in/issues/137) Can I rewrite URI/URL/sourceurl ?  | [Reply](https://github.com/gyng/save-in/issues/137#issuecomment-5550467079) | [rule-templates.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/options/rule-editor/rule-templates.ts), [download-plan.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/downloads/download-plan.ts) |
| [#115](https://github.com/gyng/save-in/issues/115) Close the tab from which something is being downloaded in general | [Reply](https://github.com/gyng/save-in/issues/115#issuecomment-5550467815) | [ROUTING-ACTIONS.md](https://github.com/gyng/save-in/blob/v4.1.0/docs/using/ROUTING-ACTIONS.md), [directory-parser.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/menus/directory-parser.ts) |
| [#102](https://github.com/gyng/save-in/issues/102) Feature request Undo last save.  | [Reply](https://github.com/gyng/save-in/issues/102#issuecomment-5550468592) | [history-actions.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/options/history/history-actions.ts), [undo-download.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/downloads/undo-download.ts) |
| [#100](https://github.com/gyng/save-in/issues/100) Allow setting of "Prefer links over sources" per site | [Reply](https://github.com/gyng/save-in/issues/100#issuecomment-5550469331) | [menu-target.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/background/menu-target.ts), [content.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/content/content.ts) |
| [#90](https://github.com/gyng/save-in/issues/90) Handle data-URIs | [Reply](https://github.com/gyng/save-in/issues/90#issuecomment-5550469968) | [download-execution.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/downloads/download-execution.ts), [download-acquisition.test.ts](https://github.com/gyng/save-in/blob/v4.1.0/test/downloads/download-acquisition.test.ts) |
| [#89](https://github.com/gyng/save-in/issues/89) Invalid options are not validated when imported | [Reply](https://github.com/gyng/save-in/issues/89#issuecomment-5550470589) | [option-schema.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/config/option-schema.ts), [option-field-sync.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/options/core/option-field-sync.ts) |
| [#82](https://github.com/gyng/save-in/issues/82) Chrome: Addon affecting all downloads instead of those only started by user | [Reply](https://github.com/gyng/save-in/issues/82#issuecomment-5550473744) | [filename-listener.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/downloads/filename-listener.ts), [browser-downloads.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/downloads/browser-downloads.ts) |
| [#74](https://github.com/gyng/save-in/issues/74) Sanitize filename | [Reply](https://github.com/gyng/save-in/issues/74#issuecomment-5550474482) | [path.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/routing/path.ts), [path.test.ts](https://github.com/gyng/save-in/blob/v4.1.0/test/routing/path.test.ts) |
| [#68](https://github.com/gyng/save-in/issues/68) option to close tab upon saving | [Reply](https://github.com/gyng/save-in/issues/68#issuecomment-5550475224) | [ROUTING-ACTIONS.md](https://github.com/gyng/save-in/blob/v4.1.0/docs/using/ROUTING-ACTIONS.md), [directory-parser.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/menus/directory-parser.ts) |
| [#66](https://github.com/gyng/save-in/issues/66) Not work on pixiv | [Reply](https://github.com/gyng/save-in/issues/66#issuecomment-5550476110) | [referer-rules.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/downloads/referer-rules.ts), [download-execution.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/downloads/download-execution.ts) |
| [#65](https://github.com/gyng/save-in/issues/65) prioritize title attribute over text when using :linktext: | [Reply](https://github.com/gyng/save-in/issues/65#issuecomment-5550476735) | [context-link-metadata.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/content/context-link-metadata.ts), [variable.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/routing/variable.ts) |
| [#50](https://github.com/gyng/save-in/issues/50) Add prefix to all filenames copied into specific directory [enhancement] | [Reply](https://github.com/gyng/save-in/issues/50#issuecomment-5550477485) | [router.test.ts](https://github.com/gyng/save-in/blob/v4.1.0/test/routing/router.test.ts) |
| [#43](https://github.com/gyng/save-in/issues/43) Mimetype support | [Reply](https://github.com/gyng/save-in/issues/43#issuecomment-5550478237) | [download-plan.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/downloads/download-plan.ts), [download-plan.test.ts](https://github.com/gyng/save-in/blob/v4.1.0/test/downloads/download-plan.test.ts) |
| [#28](https://github.com/gyng/save-in/issues/28) Save In displays the 'failed download' notification when the download panel is opened after user deleted a previously successfully downloaded file | [Reply](https://github.com/gyng/save-in/issues/28#issuecomment-5550479056) | [notification-events.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/downloads/notification-events.ts), [notification-model.ts](https://github.com/gyng/save-in/blob/v4.1.0/src/downloads/notification-model.ts) |

## Left open

These are the remaining requirements or evidence gaps, not new bug confirmations.
Experimental Firefox replacement downloads were not treated as equivalent to
general native interception that preserves arbitrary request context.

| Issue | Reason to keep open |
| --- | --- |
| [#218](https://github.com/gyng/save-in/issues/218) can't save page images on mangadex.org (firefox) | MangaDex failure has no confirmed reproduction or verified resolution; a template change alone is insufficient. |
| [#217](https://github.com/gyng/save-in/issues/217) Fail with timer-auto-close prompt if the file already exists. | Chrome has native conflict prompts, but the requested timed/automatic dialog dismissal is not implemented and the reporter browser is unspecified. |
| [#211](https://github.com/gyng/save-in/issues/211) Instagram username as filename prefix ? | Instagram author/display-name extraction from the media page is not implemented. |
| [#205](https://github.com/gyng/save-in/issues/205) option hotkey for "context menu - last saved context menu" kept turning off when extension settings tab is closed | Hotkey behavior changed, but the Civitai wrong-content/download failure follow-up remains unverified. |
| [#201](https://github.com/gyng/save-in/issues/201) [Request] Switch "last used" download path dynamically between browser & extension | Opt-in native Save As Last used works only inside Downloads after session calibration; arbitrary native destinations remain unsupported. |
| [#196](https://github.com/gyng/save-in/issues/196) Firefox - Unable to route  | Firefox browser-download routing remains an experimental HTTP(S) cancel/re-download workflow; original general native-download request is only partially met. |
| [#191](https://github.com/gyng/save-in/issues/191) More examples in the Wiki for some common sites? | More templates exist, but Facebook friend-name extraction and community submissions are not implemented. |
| [#190](https://github.com/gyng/save-in/issues/190) [Bug] Saving Through Download Menu Affecting Default Download Directory In Dynamic Downloads | Click/AUTO matched routes are fixed, but explicit menu destinations still prefix a matched route; thread includes that broader case. |
| [#184](https://github.com/gyng/save-in/issues/184) [Feature Request] White SVG usage - theme detection or manual option | Submenu icons support themes, but the requested browser-owned root icon remains constrained. |
| [#183](https://github.com/gyng/save-in/issues/183) Is there a way to blacklist a single website? | Per-site disable gates page/content features, not every extension action; full-site blacklist scope remains ambiguous. |
| [#180](https://github.com/gyng/save-in/issues/180) [Feature Request] Conditional Statements And Variables | No arbitrary user variables or if/elif routing grammar. |
| [#171](https://github.com/gyng/save-in/issues/171) feat: continuous route rules | Rules intentionally stop at the first match; chained rule evaluation is not implemented. |
| [#166](https://github.com/gyng/save-in/issues/166) [Firefox] stopped saving files | Fetch/retry workarounds exist, but the thread reports recurring Instagram crashes and separate mediatype/fork follow-ups without a complete verified resolution. |
| [#152](https://github.com/gyng/save-in/issues/152) [Feature Request] Automatic routing for HTML download attribute | Ordinary download routing works on Chrome; Firefox replacement mode cannot preserve every HTML-download request context. |
| [#148](https://github.com/gyng/save-in/issues/148) [Feature Request][Firefox] Add option to download image from browser cache | No explicit browser-cache-only image download option. |
| [#146](https://github.com/gyng/save-in/issues/146) Dynamic Downloads does not apply to files downloaded normally | Firefox native download interception is only the experimental HTTP(S) replacement mode; site-specific original request context is unverified. |
| [#145](https://github.com/gyng/save-in/issues/145) Redirection of screenshots | Firefox screenshot blob downloads are explicitly excluded from ordinary rerouting. |
| [#143](https://github.com/gyng/save-in/issues/143) Firefox download issues | Maintainer tracker for Firefox onDeterminingFilename; the API is not provided by this release. |
| [#142](https://github.com/gyng/save-in/issues/142) Roadmap | Mixed roadmap tracker with remaining Firefox API and UI-library items; not a single completed fix. |
| [#136](https://github.com/gyng/save-in/issues/136) Unable to save image on website, where right click is not allowed | Referer/retry mechanisms do not establish a fix for the unspecified original site or the Webtoons follow-up. |
| [#135](https://github.com/gyng/save-in/issues/135) Image file extensions not recognized | Missing-extension option is implemented, but the site-specific mediatype follow-up is unverified. |
| [#126](https://github.com/gyng/save-in/issues/126) not saving images whose URLs have dynamic parameter suffixes | MIME-extension handling is improved, but no confirmed cause/fix for the reported ArtStation download failure or resolution mismatch. |
| [#125](https://github.com/gyng/save-in/issues/125) Forward slash will open quick find | Old Firefox quick-find interception needs current trusted-key browser reproduction; ordinary text-input code alone does not prove it fixed. |
| [#121](https://github.com/gyng/save-in/issues/121) [Feature Request] usage of the clipboard | No clipboard-content routing variable. |
| [#118](https://github.com/gyng/save-in/issues/118) not important | JavaScript redirect landing pages are not followed as a browser navigation by a direct Save In download. |
| [#111](https://github.com/gyng/save-in/issues/111) Program saved with symlink refuses to install in Win7 | Reporter later described a possible one-off; cannot attribute a verified Windows 7/symlink fix. |
| [#110](https://github.com/gyng/save-in/issues/110) Feature Request: allow other extensions to pass a URL to Save In | External download API is implemented, but the latest follow-up asks to open the folder menu from Gesturefy, which remains unsupported. |
| [#106](https://github.com/gyng/save-in/issues/106) Feature Request:  Routing downloads by clicking link or going to download url along instead of just from context menu | Chrome native routing exists; generic Firefox native routing remains experimental/partial. |
| [#104](https://github.com/gyng/save-in/issues/104) Last selected location menu (option) does not respect add key shortcut setting. | Numbered folder keys and the Last used access key remain separate settings by design. |
| [#94](https://github.com/gyng/save-in/issues/94) Add Skip to Uniquify/Overwrite/Prompt | No filesystem-wide skip-existing conflict action; URL/history duplicate handling is not equivalent. |
| [#92](https://github.com/gyng/save-in/issues/92) Problem with using Save in with RSS (podcasts) in Feedbro because files are not displayed as MP3 file | Server filename handling improved, but Feedbro/site-specific missing title/filename cases remain unverified. |
| [#87](https://github.com/gyng/save-in/issues/87) Dynamic submenus | Filesystem enumeration and dynamic directory menus are not implemented. |
| [#86](https://github.com/gyng/save-in/issues/86) [Request] Vivaldi Support | Vivaldi-specific forced Save As follow-up has not been tested in Vivaldi. |
| [#77](https://github.com/gyng/save-in/issues/77) Separate context Menu | No long-press popup containing destination folders; access keys and Page Sources are different features. |
| [#73](https://github.com/gyng/save-in/issues/73) parse content-disposition | Parser and Referer setting exist, but the private/login-redirect failure cannot be confirmed resolved from this thread. |
| [#70](https://github.com/gyng/save-in/issues/70) Grab downloads directly | Generic native Firefox interception remains partial because HTTP(S) replacement cannot preserve arbitrary request context. |
| [#69](https://github.com/gyng/save-in/issues/69) object saving routine is unable to save the object protected by recaptcha | Referer/retry does not guarantee reCAPTCHA-protected resource downloads retain the required browser state. |
| [#57](https://github.com/gyng/save-in/issues/57) Save all images from tabs to the right/left | Saving tabs to the left remains unsupported; multiple follow-up cases are not all verified. |
| [#47](https://github.com/gyng/save-in/issues/47) Automatically save all URLs that match rules | Automatic page-source rules implement much of the intent, but not arbitrary all-URL network interception described in the request. |
| [#45](https://github.com/gyng/save-in/issues/45) PDF / Arxiv issues | Some PDF naming paths are fixed; the browser PDF-viewer/Arxiv failures are not all confirmed resolved. |
| [#25](https://github.com/gyng/save-in/issues/25) [Feature Request] Consider using native messaging to save outside the downloads folder | Native messaging for arbitrary filesystem destinations is not implemented. |
| [#21](https://github.com/gyng/save-in/issues/21) Feature Request: Move menu to top level, top of menu | Browser-owned menu ordering/top placement remains unsupported. |
| [#18](https://github.com/gyng/save-in/issues/18) Feature request:  Overwrite or Rename if file already exists | Firefox native conflict prompts/skip-existing remain unsupported. |
| [#15](https://github.com/gyng/save-in/issues/15) Please add keyboard shortcut support! | Access keys and gestures exist, but direct modifier combinations bound to individual folders are not implemented. |

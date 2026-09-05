# Failure-report reproductions — 2026-09-05

Follow-up to the [published-release issue sweep](issues-4.1-sweep.md).
Closed the two maintainer trackers as explicitly requested:

- [#142 reply](https://github.com/gyng/save-in/issues/142#issuecomment-5551694974):
  roadmap superseded by the repository roadmap.
- [#143 reply](https://github.com/gyng/save-in/issues/143#issuecomment-5551696048):
  broad Firefox tracker retired; browser API requests and individual failures
  remain separate.

Both closures use `not_planned`, and were verified through the GitHub API.
Neither asserts that Mozilla implemented `downloads.onDeterminingFilename`.
The 13 failure reports below remain open pending disposition; these checks do
not equate an unsuccessful reproduction with a confirmed historical fix.

## Method and limits

Tested Save In **4.1.0**, release commit
`f7d711a442a49e60f321249018cd00702431ce93`, extracted into an isolated snapshot
and staged with the existing e2e entry. Runtime source was not patched.
Temporary probes invoked the production context-menu handler through the
structured browser control client and inspected real browser downloads,
History, saved bytes, and image dimensions. This verifies the download pipeline;
it does not itself exercise physical context-menu selection or click-to-save.
The Options checks used trusted browser keyboard input.

Browsers were Chrome 150.0.7871.114, Firefox 152.0.6, Vivaldi 8.2.4133.47,
and Edge 152.0.4191.66 on Linux/WSL. Chrome/Firefox used isolated headless
profiles; Vivaldi/Edge used headed browsers under Xvfb so a forced Save As
dialog would prevent unattended completion. Their profiles explicitly used
the test download directory and disabled the browser's ordinary download prompt.
Save In's prompt options were also disabled except where stated.

Live resources, signed URLs, response headers, and CDN behavior can change.
Fresh public examples are identified below where the original report supplied
no usable resource. No authenticated/private session or Windows 7 environment
was available.

## Results

| Issue | Result | Evidence and remaining scope |
| --- | --- | --- |
| [#218](https://github.com/gyng/save-in/issues/218) MangaDex | **Reproduced** | The actual Firefox reader displayed a 2063 × 3000 page-owned `blob:` image. Saving it produced `DOWNLOAD_API_FAILED`, even with Referer enabled. Direct CDN downloads are a separate case; see below. |
| [#205](https://github.com/gyng/save-in/issues/205) Edge shortcut / Civitai | **Partially verified** | Trusted entry of `e` persisted in storage and the UI after closing/reopening Options, and in storage after a full Edge restart using the same profile. A public Civitai landing page returned HTML; its file endpoint returned safetensors bytes with the correct filename header. The reporter's exact click target, stale-name sequence, and hours-long behavior remain unverified. |
| [#166](https://github.com/gyng/save-in/issues/166) Firefox / Instagram | **Not reproduced on a public sample** | Opened Instagram's public profile and saved the same displayed 361 × 640 JPEG three times in Firefox. All completed, 26,775 bytes each, with image routing enabled. This does not settle logged-in, video, browser-fork, or intermittent cases. |
| [#136](https://github.com/gyng/save-in/issues/136) Webtoons / blocked image | **Reproduced; setting works for Webtoons** | The actual image from the linked Webtoons episode failed with `SERVER_FORBIDDEN` in both browsers by default. Enabling Referer for its image host completed the correct 96,651-byte PNG in both. The original unnamed site remains unverifiable. |
| [#135](https://github.com/gyng/save-in/issues/135) Extensionless images | **Controlled case passes; original URLs dead** | Both supplied blacktowhite.net image URLs returned 404. A local extensionless `/full` image routed correctly with `mediatype: ^image$` and saved as `full.png` in both browsers when the missing-extension option was enabled. |
| [#126](https://github.com/gyng/save-in/issues/126) ArtStation / Squarespace query parameters | **Not reproduced on the exact URLs** | ArtStation saved a 1,098,528-byte, 1600 × 1934 JPEG in both browsers. Squarespace preserved `?format=1500w`; both saved images decode to 1500 × 963. Chrome received JPEG, Firefox WebP. The missing-extension option was enabled for Squarespace. |
| [#125](https://github.com/gyng/save-in/issues/125) Firefox slash opens Quick Find | **Not reproduced with trusted input** | In the current standalone Options page, typing `/nested` into the Text-mode folder editor inserted the text and retained focus. Recorded key events were trusted. The old embedded Add-ons Manager workflow was not recreated. |
| [#111](https://github.com/gyng/save-in/issues/111) Windows 7 symlink installer | **Environment unavailable** | No Windows 7/UAC reproduction was possible. The earlier released Firefox symlink e2e pass verifies Linux routing only; it cannot establish Windows installer compatibility or explain this reported one-off. |
| [#92](https://github.com/gyng/save-in/issues/92) Feedbro / MP3 names | **Routing passes; naming limitation remains** | Current BBC and Acast enclosure URLs both matched `fileext: mp3` and completed in both browsers. BBC retained its descriptive filename. Acast saved as `media.mp3` in Firefox and a hash-based `.mp3` in Chrome; the server supplied no episode-title filename. Feedbro's own rendering and the original dead AudioBoom episodes were not reproduced. |
| [#86](https://github.com/gyng/save-in/issues/86) Vivaldi Save As | **Not reproduced in Vivaldi** | A headed Vivaldi download completed directly under `subdir/routed/probe.png` without dialog interaction. This establishes the tested Linux/profile behavior, not every Vivaldi OS/settings combination. |
| [#73](https://github.com/gyng/save-in/issues/73) Private/login-redirect download | **Missing reproduction** | The report explicitly concerns a nonpublic download and supplies no usable site or resource. Requires a representative authenticated flow to test the redirect, metadata, and final bytes. |
| [#69](https://github.com/gyng/save-in/issues/69) reCAPTCHA-protected resource | **Missing reproduction** | No target URL or challenge/download sequence is supplied. A generic successful HTTP download would not verify preservation of the required browser state. |
| [#45](https://github.com/gyng/save-in/issues/45) Arxiv / PDF viewer | **Not reproduced on the supplied PDF** | Both link-context saving and PAGE-context saving from an actual opened PDF tab completed as `1712.01815v1.pdf`, 636,527 bytes, in both browsers. The old rule's literal `.pdf` suffix duplicates the extension; a folder-only rule preserves the correct name. The historical arxiv-sanity page was unavailable. |

## Reproduction details

### MangaDex: distinguish the displayed blob from its CDN source

1. Open [the tested chapter](https://mangadex.org/chapter/f21a7112-d4a0-4fe6-a027-2d5de0c9604e)
   in Firefox and wait for its first page image.
2. Inspect the large reader image's `currentSrc`. In this run it was
   `blob:https://mangadex.org/<page-owned-id>`.
3. Save that image to a configured folder. The production handler recorded
   `DOWNLOAD_API_FAILED`; no completed browser download appeared.

Separately, resolve the chapter's original image through MangaDex's public
at-home API and save that HTTP(S) source. Both browsers returned
`SERVER_FORBIDDEN` by default, but downloaded a valid 1,176,195-byte PNG with
`setRefererHeader: true` and filter `*://*.mangadex.network/*`.
That filter already ships in 4.1.0; the Referer option defaults to off.
This successful CDN path **does not fix the displayed blob path**.

#### Unreleased fix follow-up

The subsequent fix reads a page-owned blob through the isolated content script
in its source tab/frame and relays bounded chunks over an extension port. The
download pipeline owns the resulting copy, derives the filename extension from
the blob's MIME type, and reuses its computed hash. It leaves the page's original
blob URL alive. No new permission, Referer setting, or MangaDex-specific rule is
required.

Retested the same live chapter in Firefox 152.0.6 with Referer disabled: its
2063 × 3000 displayed blob image now completed as a 1,176,195-byte PNG with a
`.png` filename. The deterministic Chrome/Firefox regression verifies several
transport chunks, MIME routing, full-hash naming, exact saved bytes, and that
the original page blob remains readable. The regression failed without blob
preparation. The complete verification passed 4,892 unit/integration tests,
memory checks, lint/type checks, 70 Chrome cases, and 50 Firefox cases.

This fix is **not part of the tested 4.1.0 release**. The release findings above
remain historical; #218 stays open until release disposition.

### Webtoons: confirmed Referer requirement

The report's [Erma episode](https://www.webtoons.com/en/canvas/erma/13-days-of-ermaween-2023-day-1/viewer?title_no=170650&episode_no=555)
still exposes its image in an `_images` element's `data-url` on
`webtoon-phinf.pstatic.net`. Save that exact URL with the episode as `pageUrl`.
The default request is forbidden; enable the Referer option and match
`*://webtoon-phinf.pstatic.net/*` to complete it.

The resulting PNG SHA-256 was
`48333116021ab460e4b101ae8f5abbf3652776d6c526b314552c6a84158c6726`
in both browsers. Firefox retained the source filename; Chrome's protected
blob acquisition used a generated UUID filename. This check establishes content
recovery, not filename parity.

### Images with query parameters or missing extensions

For #126, reuse the two exact URLs in the issue, including every query
parameter. Enable **Add an extension when the filename has none** for the
extensionless Squarespace URL. Decode the actual output to compare dimensions,
not just byte counts: content negotiation returned different image formats.
ArtStation's JPEG SHA-256 was
`7d5abb08cbd85657c1f2c86271292b743493eb1226c709fcf714b4465de42379`.

For the bounded #135 substitute, serve a PNG at `/full` with
`Content-Type: image/png`, without a disposition header. Use the missing-extension
option and this rule, then save it as an image:

```text
mediatype: ^image$
into: media/:filename:
```

The saved filename was `full.png` under the routed directory. This demonstrates
the media matcher and extension recovery independently of the unavailable site.

### Podcasts: separate rule matching from unavailable titles

Use a current enclosure from the report's
[BBC feed](http://podcasts.files.bbci.co.uk/p02nrsln.rss) or
[On The Continent feed](https://rss.acast.com/onthecontinent), with:

```text
fileext: mp3
into: podcasts/:filename:
```

Both completed and routed correctly. BBC's tested episode was **Keith Andrews -
The Football Interview**, with final filename
`FootballDaily-20260904-KeithAndrewsTheFootballInterview.mp3`.
Server-generated audio sizes differed between requests, so byte equality was
not used as a correctness claim for that podcast.

Acast's **A Jumbo 2026/27 WSL Preview** enclosure ended in `/media.mp3`.
Its HEAD response returned `text/plain` without a filename hint; GET redirected
to audio with `Content-Disposition: inline`, still without a filename hint.
Both browsers saved 68,370,457-byte MP3s. Firefox used `media.mp3`; Chrome used
`864daeaefa06f7085a6a02bbefa00f13.mp3`. Neither received the episode title as a
server-suggested filename. A rule or page/feed metadata would need to supply it.
This does not prove the older AudioBoom failures share the same cause.

### Edge and Civitai: verified persistence, incomplete click reproduction

Set Last used's key to `e` using trusted input. Close and reopen Options; verify
both the control and `storage.local.keyLastUsed`. Exit Edge completely and
relaunch the same isolated profile; read the stored key before editing Options.
All three checks retained `e`. Firefox and Vivaldi also passed the Options
close/reopen check.

The reporter did not provide an exact Civitai URL. A current public model with
“indomitable” in its name was used only for a bounded response comparison:

- `https://civitai.com/models/125824` returned HTML.
- `https://civitai.com/api/download/models/168779` returned safetensors bytes
  and `attachment; filename="indomitable_azurlane.safetensors"`.

Only the first 4 KiB were read. This shows that landing pages and file URLs have
different content; it does not prove which URL the reporter clicked or reproduce
the stale “indomitable” filename after a later image click.

### Arxiv: remove the now-redundant literal extension

Open [the original PDF](https://arxiv.org/pdf/1712.01815v1) and save the page
through Save In using:

```text
pagedomain: arxiv.org
into: arxiv/
```

The PDF viewer case completed in both browsers with filename
`1712.01815v1.pdf`, without `.html` or a crash. The file SHA-256 was
`26c43408551c22f4fdc98e47f9b4592ab2161fac1ba5df27c897f46d8b6cec7f`.
The reporter's `into: arxiv/:filename:.pdf` instead produced `.pdf.pdf` because
`:filename:` already includes the proper extension.

## Local artifacts

Exploratory scripts and raw browser/download evidence are retained for this
workspace session under `/tmp/save-in-reproduction`; they are not required CI
fixtures or permanent repository artifacts. Principal files are:

- `chrome-results.jsonl`, `firefox-results.jsonl`, and `samples-phase1.json`,
  `samples-phase2.json`, `samples.json`: three batches of download probes.
- `firefox-ui.json`: trusted slash input, shortcut persistence, three real
  Instagram image saves, and the actual MangaDex blob failure.
- `vivaldi-results.json`, `edge-results.json`, `edge-restart-results.json`:
  headed fork tests and persisted Edge key after restart.
- `site-probes.json`, `podcast-probes.json`, `civitai-probes.json`:
  public resource availability and bounded response checks.
- `maintainer-results.json`: verified closure states and posted reply URLs.

The first batch's case labelled “45 Arxiv link save” supplied image-style
context metadata incorrectly and saved the HTML abstract page. It is a discarded
harness mistake, not a product failure. The corrected link case and the actual
PDF-viewer case are the evidence used above. Probe test completion only means
the observation ran; individual download outcomes determine the result.

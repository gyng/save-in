// Runtime type-guard matrix for the page-source vocabulary: untrusted
// messages and stored candidates narrow through these before use.
import {
  classifyUrlKind,
  isMediaSourceKind,
  isPageSourceChannel,
  isPageSourceKind,
  PAGE_SOURCE_CHANNELS,
  PAGE_SOURCE_KINDS,
} from "../../src/shared/page-source.ts";

test("accepts every declared kind and channel", () => {
  for (const kind of PAGE_SOURCE_KINDS) expect(isPageSourceKind(kind)).toBe(true);
  for (const channel of PAGE_SOURCE_CHANNELS) expect(isPageSourceChannel(channel)).toBe(true);
});

test.each([["IMAGE"], ["embed"], [""], [7], [null], [undefined]])(
  "rejects %o for both vocabularies",
  (value) => {
    expect(isPageSourceKind(value)).toBe(false);
    expect(isPageSourceChannel(value)).toBe(false);
  },
);

test("kinds and channels stay disjoint vocabularies", () => {
  // A channel name must never pass as a kind (and vice versa): the automatic
  // scan gates channels independently of media kind.
  for (const channel of PAGE_SOURCE_CHANNELS) expect(isPageSourceKind(channel)).toBe(false);
  for (const kind of PAGE_SOURCE_KINDS) expect(isPageSourceChannel(kind)).toBe(false);
});

// classifyUrlKind is the shape-only classifier both the DOM scan and the
// background webRequest collector use before any richer metadata exists.
test.each([
  ["https://cdn.test/a/photo.PNG", "image"],
  ["https://cdn.test/a/photo.jpeg", "image"],
  ["https://cdn.test/a/clip.mp4", "video"],
  ["https://cdn.test/a/clip.mkv", "video"],
  ["https://cdn.test/a/song.flac", "audio"],
  ["https://cdn.test/a/song.mp3", "audio"],
  ["https://cdn.test/live/master.m3u8?token=abc", "stream"],
  ["https://cdn.test/live/manifest.mpd", "stream"],
  ["https://cdn.test/doc/report.pdf", "document"],
  ["https://cdn.test/api/data.json", "link"],
  ["https://cdn.test/segment", "link"],
  ["https://cdn.test/a/photo%2Epng", "link"], // %-encoded dot stays encoded → not media
  ["not a url", "link"], // new URL() throws → link, never an exception
])("classifies %s as %s", (url, kind) => {
  expect(classifyUrlKind(url)).toBe(kind);
});

test("isMediaSourceKind treats every kind but link as saveable media", () => {
  for (const kind of PAGE_SOURCE_KINDS) {
    expect(isMediaSourceKind(kind)).toBe(kind !== "link");
  }
});

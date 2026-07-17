// Runtime type-guard matrix for the page-source vocabulary: untrusted
// messages and stored candidates narrow through these before use.
import {
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

import { describe, expect, test } from "vitest";

import { isOffscreenFetchRequest, isOffscreenFetchResponse } from "../src/content-fetch-types.ts";

describe("offscreen message runtime validation", () => {
  test("accepts valid fetch requests and responses", () => {
    expect(
      isOffscreenFetchRequest({
        type: "OFFSCREEN_FETCH",
        url: "https://x/image.png",
        hash: "SHA-256",
        maxBytes: 1024,
      }),
    ).toBe(true);
    expect(isOffscreenFetchResponse({ blobUrl: "blob:https://x/id", hash: "abcd" })).toBe(true);
    expect(isOffscreenFetchResponse({ error: "fetch failed" })).toBe(true);
  });

  test.each([
    null,
    [],
    { type: "OFFSCREEN_FETCH", url: 42 },
    { type: "OTHER", url: "https://x/image.png" },
    { type: "OFFSCREEN_FETCH", url: "https://x/image.png", maxBytes: -1 },
    { type: "OFFSCREEN_FETCH", url: "https://x/image.png", maxBytes: Number.NaN },
  ])("rejects malformed fetch request %#", (value) => {
    expect(isOffscreenFetchRequest(value)).toBe(false);
  });

  test.each([null, [], { blobUrl: 42 }, { error: {} }])(
    "rejects malformed fetch response %#",
    (value) => {
      expect(isOffscreenFetchResponse(value)).toBe(false);
    },
  );
});

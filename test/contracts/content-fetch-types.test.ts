import { describe, expect, test } from "vitest";

import {
  isOffscreenBlobReleaseRequest,
  isOffscreenFetchCancelRequest,
  isOffscreenFetchRequest,
  isOffscreenFetchResponse,
} from "../../src/shared/content-fetch-types.ts";

describe("offscreen message runtime validation", () => {
  test("accepts valid fetch requests and responses", () => {
    expect(
      isOffscreenFetchRequest({
        type: "OFFSCREEN_FETCH",
        url: "https://x/image.png",
        requestId: "r1",
        hash: "SHA-256",
        maxBytes: 1024,
        credentials: "omit",
      }),
    ).toBe(true);
    expect(
      isOffscreenFetchRequest({
        type: "OFFSCREEN_FETCH",
        url: "https://x/empty",
        requestId: "r2",
        maxBytes: 0,
      }),
    ).toBe(true);
    expect(isOffscreenFetchResponse({ blobUrl: "blob:https://x/id", hash: "abcd" })).toBe(true);
    expect(isOffscreenFetchResponse({ error: "fetch failed" })).toBe(true);
    expect(
      isOffscreenFetchResponse({
        error: "HTTP 403",
        status: 403,
        finalUrl: "https://s3.example/file",
      }),
    ).toBe(true);
    expect(isOffscreenFetchCancelRequest({ type: "OFFSCREEN_FETCH_CANCEL", requestId: "r1" })).toBe(
      true,
    );
    expect(isOffscreenBlobReleaseRequest({ type: "OFFSCREEN_BLOB_RELEASE", requestId: "r1" })).toBe(
      true,
    );
  });

  test.each([
    null,
    [],
    { type: "OFFSCREEN_FETCH", url: 42, requestId: "r" },
    { type: "OTHER", url: "https://x/image.png", requestId: "r" },
    { type: "OFFSCREEN_FETCH", url: "https://x/image.png", requestId: 42 },
    // A request nobody can name is a blob nobody can release.
    { type: "OFFSCREEN_FETCH", url: "https://x/image.png" },
    { type: "OFFSCREEN_FETCH", url: "https://x/image.png", requestId: "r", maxBytes: -1 },
    { type: "OFFSCREEN_FETCH", url: "https://x/image.png", requestId: "r", maxBytes: 1.5 },
    {
      type: "OFFSCREEN_FETCH",
      url: "https://x/image.png",
      requestId: "r",
      maxBytes: Number.MAX_SAFE_INTEGER + 1,
    },
    { type: "OFFSCREEN_FETCH", url: "https://x/image.png", requestId: "r", maxBytes: Number.NaN },
    {
      type: "OFFSCREEN_FETCH",
      url: "https://x/image.png",
      requestId: "r",
      credentials: "same-origin",
    },
  ])("rejects malformed fetch request %#", (value) => {
    expect(isOffscreenFetchRequest(value)).toBe(false);
  });

  test.each([
    null,
    [],
    { blobUrl: 42 },
    { error: {} },
    { error: "HTTP 403", status: "403" },
    { error: "HTTP 403", finalUrl: 42 },
  ])("rejects malformed fetch response %#", (value) => {
    expect(isOffscreenFetchResponse(value)).toBe(false);
  });
});

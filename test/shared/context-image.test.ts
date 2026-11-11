import { MAX_CONTEXT_IMAGE_URL_LENGTH, parseContextImage } from "../../src/shared/context-image.ts";

describe("context image contract", () => {
  test("accepts a fetchable image address and canonicalizes it", () => {
    expect(parseContextImage({ src: "https://example.test/a b.png", extra: 1 })).toEqual({
      src: "https://example.test/a%20b.png",
    });
    expect(parseContextImage({ src: "http://example.test/a.png" })).toEqual({
      src: "http://example.test/a.png",
    });
  });

  test.each([
    ["no response", undefined],
    ["a null response", null],
    ["a non-record", "https://example.test/a.png"],
    ["a missing address", {}],
    ["a non-string address", { src: 7 }],
    ["an empty address", { src: "" }],
    ["a relative address", { src: "/a.png" }],
    ["a page-owned blob", { src: "blob:https://example.test/1" }],
    ["an inline placeholder", { src: "data:image/gif;base64,AAAA" }],
    ["a script address", { src: "javascript:alert(1)" }],
    [
      "an oversized address",
      { src: `https://example.test/${"x".repeat(MAX_CONTEXT_IMAGE_URL_LENGTH)}` },
    ],
  ])("rejects %s", (_label, value) => {
    expect(parseContextImage(value)).toBeNull();
  });
});

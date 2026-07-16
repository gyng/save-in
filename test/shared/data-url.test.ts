import {
  DATA_URL_DEDUP_THRESHOLD,
  DATA_URL_DISPLAY_LENGTH,
  DATA_URL_MAX_LENGTH,
  automaticSeenKey,
  historyDisplayUrl,
  isDataUrl,
  isDataUrlWithinCap,
  parseDataUrlMediaType,
  truncateDataUrlForDisplay,
} from "../../src/shared/data-url.ts";
import { Sha256 } from "../../src/shared/sha256.ts";

const dataUrl = (payloadLength: number, header = "image/png;base64"): string =>
  `data:${header},${"A".repeat(payloadLength)}`;

describe("isDataUrl", () => {
  test.each([
    ["data:image/png;base64,AAAA", true],
    // Schemes are case-insensitive.
    ["DATA:text/plain,hi", true],
    ["https://cdn.test/cat.png", false],
    ["blob:https://page.test/uuid", false],
    ["ftp://host/file", false],
    ["not a url", false],
  ])("%s -> %s", (value, expected) => {
    expect(isDataUrl(value)).toBe(expected);
  });
});

describe("isDataUrlWithinCap", () => {
  test("admits a string exactly at the 2 MB cap and rejects one past it", () => {
    const atCap = "d".repeat(DATA_URL_MAX_LENGTH);
    expect(atCap.length).toBe(2 * 1024 * 1024);
    expect(isDataUrlWithinCap(atCap)).toBe(true);
    expect(isDataUrlWithinCap(`${atCap}x`)).toBe(false);
  });
});

describe("parseDataUrlMediaType", () => {
  test.each([
    // valid
    ["data:image/png;base64,iVBORw0KGgo=", "image/png"],
    ["data:text/plain,hello", "text/plain"],
    // valid with extra params before the base64 flag
    ["data:text/html;charset=utf-8;base64,PGgxPg==", "text/html"],
    // missing mediatype (RFC default section empty) -> octet-stream
    ["data:,Hello%2C%20World", "application/octet-stream"],
    ["data:;base64,SGVsbG8=", "application/octet-stream"],
    // malformed: no comma at all, or a header with no type/subtype
    ["data:image-png", "application/octet-stream"],
    ["data:notamediatype,x", "application/octet-stream"],
  ])("%s -> %s", (value, expected) => {
    expect(parseDataUrlMediaType(value)).toBe(expected);
  });
});

describe("truncateDataUrlForDisplay", () => {
  test("leaves a short value untouched and truncates a long one with an ellipsis", () => {
    const short = "data:text/plain,hi";
    expect(truncateDataUrlForDisplay(short)).toBe(short);

    const long = dataUrl(500);
    const truncated = truncateDataUrlForDisplay(long);
    expect(truncated).toBe(`${long.slice(0, DATA_URL_DISPLAY_LENGTH)}…`);
    expect(truncated.length).toBe(DATA_URL_DISPLAY_LENGTH + 1);
    // The truncated form is not a usable, fetchable URL.
    expect(truncated.endsWith("…")).toBe(true);
  });
});

describe("historyDisplayUrl", () => {
  test("truncates only long data: URLs, passing http(s) and short values through", () => {
    expect(historyDisplayUrl(undefined)).toBeUndefined();
    expect(historyDisplayUrl("https://cdn.test/cat.png")).toBe("https://cdn.test/cat.png");
    const short = "data:text/plain,hi";
    expect(historyDisplayUrl(short)).toBe(short);
    const long = dataUrl(4000);
    expect(historyDisplayUrl(long)).toBe(`${long.slice(0, DATA_URL_DISPLAY_LENGTH)}…`);
  });
});

describe("automaticSeenKey", () => {
  test("keys http(s) and short data: URLs on the string itself", () => {
    expect(automaticSeenKey("https://cdn.test/cat.png")).toBe("https://cdn.test/cat.png");
    const short = dataUrl(DATA_URL_DEDUP_THRESHOLD - 100);
    expect(short.length).toBeLessThanOrEqual(DATA_URL_DEDUP_THRESHOLD);
    expect(automaticSeenKey(short)).toBe(short);
  });

  test("keys a long data: URL on its SHA-256 so the dedup set never holds the payload", () => {
    const long = dataUrl(DATA_URL_DEDUP_THRESHOLD + 500);
    expect(long.length).toBeGreaterThan(DATA_URL_DEDUP_THRESHOLD);
    const expected = `sha256:${new Sha256().update(new TextEncoder().encode(long)).hex()}`;
    const key = automaticSeenKey(long);
    expect(key).toBe(expected);
    expect(key.length).toBeLessThan(long.length);
    // Equal payloads collapse to one key; a single differing byte does not.
    expect(automaticSeenKey(long)).toBe(key);
    expect(automaticSeenKey(`${long}B`)).not.toBe(key);
  });
});

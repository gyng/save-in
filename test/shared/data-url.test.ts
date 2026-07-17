import {
  DATA_URL_DEDUP_THRESHOLD,
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
    [`data:image/${"x".repeat(200)},x`, "application/octet-stream"],
    [`data:image/png;${";".repeat(20_000)},x`, "image/png"],
    ["data:IMAGE/PNG,x", "image/png"],
  ])("%s -> %s", (value, expected) => {
    expect(parseDataUrlMediaType(value)).toBe(expected);
  });
});

describe("truncateDataUrlForDisplay", () => {
  test("shows only normalized media metadata, never payload or arbitrary parameters", () => {
    expect(truncateDataUrlForDisplay("data:text/plain,TOP_SECRET")).toBe("data:text/plain,…");
    expect(truncateDataUrlForDisplay("data:text/html;charset=TOP_SECRET;base64,TOP_SECRET")).toBe(
      "data:text/html;base64,…",
    );
    expect(truncateDataUrlForDisplay("data:;base64,TOP_SECRET")).toBe(
      "data:application/octet-stream;base64,…",
    );
    expect(truncateDataUrlForDisplay("data:malformed")).toBe("data:…");
    expect(truncateDataUrlForDisplay("https://cdn.test/cat.png")).toBe("https://cdn.test/cat.png");
  });
});

describe("historyDisplayUrl", () => {
  test("redacts every data: payload while passing http(s) through", () => {
    expect(historyDisplayUrl(undefined)).toBeUndefined();
    expect(historyDisplayUrl("https://cdn.test/cat.png")).toBe("https://cdn.test/cat.png");
    expect(historyDisplayUrl("data:text/plain,hi")).toBe("data:text/plain,…");
    const long = dataUrl(4000);
    expect(historyDisplayUrl(long)).toBe("data:image/png;base64,…");
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

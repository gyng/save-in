import { describe, expect, test } from "vitest";

import { MESSAGE_TYPES } from "../src/shared/constants.ts";
import {
  isExternalMessage,
  isInternalMessage,
  isStringKeyedRecord,
} from "../src/shared/message-protocol.ts";

describe("message protocol runtime validation", () => {
  test("accepts valid internal and external message bodies", () => {
    expect(
      isInternalMessage({ type: MESSAGE_TYPES.PREVIEW_MENUS, body: { paths: "images" } }),
    ).toBe(true);
    expect(
      isExternalMessage({
        type: MESSAGE_TYPES.DOWNLOAD,
        body: {
          url: "https://x/image.png",
          info: { pageUrl: "https://x/", suggestedFilename: "image.png" },
          version: 1,
        },
      }),
    ).toBe(true);
  });

  test.each([
    { type: MESSAGE_TYPES.PING, body: {} },
    { type: MESSAGE_TYPES.PREVIEW_MENUS, body: { paths: 1 } },
    { type: MESSAGE_TYPES.CHECK_ROUTES, body: { state: { info: null } } },
    { type: MESSAGE_TYPES.VALIDATE, body: [] },
    { type: MESSAGE_TYPES.VALIDATE, body: { info: { filename: 42 } } },
    { type: MESSAGE_TYPES.VALIDATE, body: { info: { pageUrl: null } } },
    { type: MESSAGE_TYPES.APPLY_CONFIG, body: { config: [] } },
    { type: MESSAGE_TYPES.DOWNLOAD, body: { url: 1 } },
    { type: MESSAGE_TYPES.DOWNLOAD, body: { info: "not an object" } },
    { type: MESSAGE_TYPES.DOWNLOAD, body: { version: Number.NaN } },
  ])("rejects malformed internal message %#", (message) => {
    expect(isInternalMessage(message)).toBe(false);
  });

  test("rejects malformed external bodies even when their type is recognized", () => {
    expect(isExternalMessage({ type: MESSAGE_TYPES.VALIDATE, body: { paths: false } })).toBe(false);
    expect(
      isExternalMessage({
        type: MESSAGE_TYPES.DOWNLOAD,
        body: { url: "https://x/image.png", info: { pageUrl: 42 } },
      }),
    ).toBe(false);
  });

  test("recognizes only non-array records as imported configuration", () => {
    expect(isStringKeyedRecord({ paths: "images" })).toBe(true);
    expect(isStringKeyedRecord([])).toBe(false);
    expect(isStringKeyedRecord(null)).toBe(false);
  });

  test("never throws for adversarial structured-clone values", () => {
    const values = [undefined, null, true, 0, "PING", [], new Date(), /x/, new Map(), new Set()];
    for (const value of values) {
      expect(() => isInternalMessage(value)).not.toThrow();
      expect(() => isExternalMessage(value)).not.toThrow();
    }
  });
});

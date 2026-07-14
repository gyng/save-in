import { describe, expect, test } from "vitest";

import {
  createExternalValidationRateLimiter,
  externalValidationRequestError,
  isSafeExternalRegex,
} from "../src/background/external-validation.ts";

describe("external validation safeguards", () => {
  test.each([/^https?:\/\//, /(?:jpg|png)$/i, /(?:ab)+/, /[a-z]+/, /a{1,3}/])(
    "accepts bounded regexes %#",
    (regex) => {
      expect(isSafeExternalRegex(regex)).toBe(true);
    },
  );

  test.each([/(a+)+$/, /(a*){2,}/, /(a|aa)+$/, /^(a+)\1$/, /^(?<part>a+)\k<part>$/])(
    "rejects regexes with unsafe repetition %#",
    (regex) => {
      expect(isSafeExternalRegex(regex)).toBe(false);
    },
  );

  test("rejects oversized external validation fields before parsing", () => {
    expect(externalValidationRequestError({ filenamePatterns: "x".repeat(32_769) })).toBe(
      "Validation rules are too large",
    );
    expect(externalValidationRequestError({ info: { filename: "x".repeat(4_097) } })).toBe(
      "Validation sample fields are too large",
    );
    expect(
      externalValidationRequestError({
        automaticCandidate: {
          pageUrl: `https://example.test/${"x".repeat(8_193)}`,
          sourceUrl: "https://example.test/a.png",
          sourceKind: "image",
        },
      }),
    ).toBe("Automatic validation fields are too large");

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(externalValidationRequestError({ info: cyclic })).toBe(
      "Validation request is too large",
    );
  });

  test("limits bursts per browser-authenticated sender ID", () => {
    const allow = createExternalValidationRateLimiter({ maxRequests: 2, windowMs: 1_000 });
    expect(allow("extension-a", 100)).toBe(true);
    expect(allow("extension-a", 200)).toBe(true);
    expect(allow("extension-a", 300)).toBe(false);
    expect(allow("extension-b", 300)).toBe(true);
    expect(allow("extension-a", 1_101)).toBe(true);
  });
});

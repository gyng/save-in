import { describe, expect, test } from "vitest";

import {
  createExternalValidationRateLimiter,
  externalValidationRequestError,
  hasUnsafeExternalRegex,
  isSafeExternalRegex,
} from "../../src/background/external-validation.ts";

describe("external validation safeguards", () => {
  test("accepts a literal template string that is never executed as a regex", () => {
    expect(isSafeExternalRegex("literal")).toBe(true);
  });

  test.each([/^https?:\/\//, /(?:jpg|png)$/i, /(?:ab)+/, /[a-z]+/, /a{1,3}/, /(ab){1}/])(
    "accepts bounded regexes %#",
    (regex) => {
      expect(isSafeExternalRegex(regex)).toBe(true);
    },
  );

  test.each([
    /(a+)+$/,
    /(a*){2,}/,
    /(a+){2}/,
    /(a+){1,3}/,
    /(a|aa)+$/,
    /^(a+)\1$/,
    /^(?<part>a+)\k<part>$/,
  ])("rejects regexes with unsafe repetition %#", (regex) => {
    expect(isSafeExternalRegex(regex)).toBe(false);
  });

  test("rejects oversized external validation fields before parsing", () => {
    expect(externalValidationRequestError(undefined)).toBeNull();
    expect(externalValidationRequestError({ paths: "x".repeat(32_769) })).toBe(
      "Validation paths are too large",
    );
    expect(externalValidationRequestError({ filenamePatterns: "x".repeat(32_769) })).toBe(
      "Validation rules are too large",
    );
    expect(externalValidationRequestError({ info: { filename: "x".repeat(4_097) } })).toBe(
      "Validation sample fields are too large",
    );
    expect(externalValidationRequestError({ info: { contexts: Array(33).fill("link") } })).toBe(
      "Validation sample fields are too large",
    );
    expect(externalValidationRequestError({ info: { contexts: ["x".repeat(4_097)] } })).toBe(
      "Validation sample fields are too large",
    );
    expect(
      externalValidationRequestError({ info: { currentTab: { title: "x".repeat(4_097) } } }),
    ).toBe("Validation sample fields are too large");
    expect(
      externalValidationRequestError({
        automaticCandidate: {
          pageUrl: `https://example.test/${"x".repeat(8_193)}`,
          sourceUrl: "https://example.test/a.png",
          sourceKind: "image",
        },
      }),
    ).toBe("Automatic validation fields are too large");
    expect(
      externalValidationRequestError({
        automaticCandidate: {
          pageUrl: "https://example.test/",
          sourceUrl: `https://example.test/${"x".repeat(8_193)}`,
        },
      }),
    ).toBe("Automatic validation fields are too large");
    expect(
      externalValidationRequestError({
        automaticCandidate: { suggestedFilename: "x".repeat(1_025) },
      }),
    ).toBe("Automatic validation fields are too large");

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(externalValidationRequestError({ info: cyclic })).toBe(
      "Validation request is too large",
    );
  });

  test("bounds adversarial validation object graphs", () => {
    expect(externalValidationRequestError({ extra: [1, "small"] } as never)).toBeNull();
    expect(externalValidationRequestError({ extra: Array(1_025).fill(null) } as never)).toBe(
      "Validation request is too large",
    );
    expect(
      externalValidationRequestError({
        extra: Object.fromEntries(Array.from({ length: 1_025 }, (_, index) => [`k${index}`, null])),
      } as never),
    ).toBe("Validation request is too large");

    const root: Record<string, unknown> = {};
    let cursor = root;
    for (let index = 0; index < 4_097; index += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    expect(externalValidationRequestError({ extra: root } as never)).toBe(
      "Validation request is too large",
    );

    const wideKeys = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [`${index}-${"x".repeat(700)}`, null]),
    );
    expect(externalValidationRequestError({ extra: wideKeys } as never)).toBe(
      "Validation request is too large",
    );
  });

  test("rejects oversized regexes and unsafe matcher rules", () => {
    expect(isSafeExternalRegex(new RegExp("a".repeat(1_025)))).toBe(false);
    expect(isSafeExternalRegex({ source: "(a+){" } as RegExp)).toBe(true);
    expect(
      hasUnsafeExternalRegex([
        [
          { type: "MATCHER", value: /(a+)+$/ },
          { type: "DESTINATION", value: "safe" },
        ],
      ] as never),
    ).toBe(true);
    expect(hasUnsafeExternalRegex([[{ type: "DESTINATION", value: "safe" }]] as never)).toBe(false);
  });

  test("rejects an unsafe rename find pattern, not only matcher patterns", () => {
    // rename:'s find regex is compiled and executed against an attacker-supplied
    // filename during traceRules, so it must pass the same ReDoS gate as a
    // matcher. A safe matcher must not launder a catastrophic rename find past
    // the gate.
    expect(
      hasUnsafeExternalRegex([
        [
          { type: "MATCHER", value: /safe/ },
          { type: "RENAME", value: "(a+)+$ -> x", find: /(a+)+$/, replacement: "x" },
          { type: "DESTINATION", value: "out/" },
        ],
      ] as never),
    ).toBe(true);
    expect(
      hasUnsafeExternalRegex([
        [{ type: "RENAME", value: "\\d+ -> x", find: /\d+/, replacement: "x" }],
      ] as never),
    ).toBe(false);
  });

  test("limits bursts per browser-authenticated sender ID", () => {
    const allow = createExternalValidationRateLimiter({ maxRequests: 2, windowMs: 1_000 });
    expect(allow("extension-a", 100)).toBe(true);
    expect(allow("extension-a", 200)).toBe(true);
    expect(allow("extension-a", 300)).toBe(false);
    expect(allow("extension-b", 300)).toBe(true);
    allow.reset();
    expect(allow("extension-a", 300)).toBe(true);
    expect(allow("extension-a", 1_101)).toBe(true);
  });
});

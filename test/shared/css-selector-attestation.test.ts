import {
  isCssSelectorAttestation,
  MAX_CSS_SELECTOR_LENGTH,
  MAX_CSS_SELECTOR_MATCHES,
  MAX_CSS_SELECTOR_ORIGINS,
  MAX_CSS_SELECTORS_PER_ORIGIN,
} from "../../src/shared/css-selector-attestation.ts";

describe("CSS selector attestations", () => {
  test("accepts bounded groups and rejects malformed shapes", () => {
    expect(isCssSelectorAttestation([["article img"], ["video"]])).toBe(true);
    expect(isCssSelectorAttestation("article img")).toBe(false);
    expect(
      isCssSelectorAttestation(Array.from({ length: MAX_CSS_SELECTOR_ORIGINS + 1 }, () => [])),
    ).toBe(false);
    expect(isCssSelectorAttestation(["article img"])).toBe(false);
    expect(
      isCssSelectorAttestation([
        Array.from({ length: MAX_CSS_SELECTORS_PER_ORIGIN + 1 }, () => "img"),
      ]),
    ).toBe(false);
    expect(isCssSelectorAttestation([[""], ["x".repeat(MAX_CSS_SELECTOR_LENGTH + 1)]])).toBe(false);
  });

  test("rejects an aggregate match count above the cap", () => {
    const fullGroup = Array.from({ length: MAX_CSS_SELECTORS_PER_ORIGIN }, () => "img");
    const groups = Array.from(
      { length: Math.floor(MAX_CSS_SELECTOR_MATCHES / MAX_CSS_SELECTORS_PER_ORIGIN) + 1 },
      () => [...fullGroup],
    );
    expect(isCssSelectorAttestation(groups)).toBe(false);
  });
});

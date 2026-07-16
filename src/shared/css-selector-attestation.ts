// Content discovery produces these attestations, while the routing matcher and
// message protocol consume them in contexts that cannot import content code.

export const MAX_CSS_SELECTOR_LENGTH = 512;
export const MAX_CSS_SELECTOR_ORIGINS = 32;
export const MAX_CSS_SELECTORS_PER_ORIGIN = 64;
export const MAX_CSS_SELECTORS = MAX_CSS_SELECTORS_PER_ORIGIN;
export const MAX_CSS_SELECTOR_MATCHES = 256;

export type CssSelectorAttestation = string[][];

export const isCssSelectorAttestation = (value: unknown): value is CssSelectorAttestation => {
  if (!Array.isArray(value) || value.length > MAX_CSS_SELECTOR_ORIGINS) return false;
  let matches = 0;
  for (const group of value) {
    if (!Array.isArray(group) || group.length > MAX_CSS_SELECTORS_PER_ORIGIN) return false;
    matches += group.length;
    if (matches > MAX_CSS_SELECTOR_MATCHES) return false;
    if (
      !group.every(
        (selector) =>
          typeof selector === "string" &&
          selector.length > 0 &&
          selector.length <= MAX_CSS_SELECTOR_LENGTH,
      )
    )
      return false;
  }
  return true;
};

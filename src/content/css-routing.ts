import { RULE_TYPES } from "../shared/constants.ts";
import {
  MAX_CSS_SELECTOR_MATCHES,
  MAX_CSS_SELECTOR_ORIGINS,
  MAX_CSS_SELECTORS_PER_ORIGIN,
  type CssSelectorAttestation,
} from "../shared/css-selector-attestation.ts";
import { isCssMatcherClause, type RoutingRule } from "../routing/rule-types.ts";
import type { PageSource } from "./source-panel-model.ts";

export const cssSelectorsForRules = (rules: readonly RoutingRule[]): string[] => [
  ...new Set(
    rules.flatMap((rule) =>
      rule.flatMap((clause) =>
        clause.type === RULE_TYPES.MATCHER && isCssMatcherClause(clause) ? [clause.value] : [],
      ),
    ),
  ),
];

export const sourceOriginElements = (source: PageSource): Element[] =>
  source.channel === "resource-hint" ? [] : (source.originElements ?? [source.element]);

export const matchedCssSelectorsByOrigin = (
  elements: Iterable<Element>,
  selectors: readonly string[],
): CssSelectorAttestation => {
  if (selectors.length === 0) return [];
  const groups: CssSelectorAttestation = [];
  const signatures = new Set<string>();
  let totalMatches = 0;
  for (const element of new Set(elements)) {
    if (groups.length >= MAX_CSS_SELECTOR_ORIGINS || totalMatches >= MAX_CSS_SELECTOR_MATCHES)
      break;
    const matched: string[] = [];
    for (const selector of selectors) {
      if (
        matched.length >= MAX_CSS_SELECTORS_PER_ORIGIN ||
        totalMatches + matched.length >= MAX_CSS_SELECTOR_MATCHES
      )
        break;
      try {
        if (element.matches(selector)) matched.push(selector);
      } catch {
        // Stored settings may predate selector validation or be written
        // directly. Invalid selectors fail closed without stopping discovery.
      }
    }
    if (matched.length === 0) continue;
    const signature = JSON.stringify(matched);
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    groups.push(matched);
    totalMatches += matched.length;
  }
  return groups;
};

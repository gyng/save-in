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
  source.originElements ?? (source.channel === "resource-hint" ? [] : [source.element]);

export const matchedCssSelectorsByOrigin = (
  elements: Iterable<Element>,
  rules: readonly RoutingRule[],
): CssSelectorAttestation => {
  const selectorGroups = [
    ...new Map(
      rules.flatMap((rule) => {
        const selectors = [
          ...new Set(
            rule.flatMap((clause) =>
              clause.type === RULE_TYPES.MATCHER && isCssMatcherClause(clause)
                ? [clause.value]
                : [],
            ),
          ),
        ];
        return selectors.length > 0 ? [[JSON.stringify(selectors), selectors] as const] : [];
      }),
    ).values(),
  ];
  if (selectorGroups.length === 0) return [];
  const groups: CssSelectorAttestation = [];
  let totalMatches = 0;
  const uniqueElements = [...new Set(elements)];
  for (const selectors of selectorGroups) {
    if (groups.length >= MAX_CSS_SELECTOR_ORIGINS || totalMatches >= MAX_CSS_SELECTOR_MATCHES)
      break;
    if (
      selectors.length > MAX_CSS_SELECTORS_PER_ORIGIN ||
      totalMatches + selectors.length > MAX_CSS_SELECTOR_MATCHES
    )
      break;
    const matched = uniqueElements.some((element) => {
      try {
        return selectors.every((selector) => element.matches(selector));
      } catch {
        // Stored settings may predate selector validation or be written
        // directly. Invalid selectors fail closed without stopping discovery.
        return false;
      }
    });
    if (!matched) continue;
    groups.push(selectors);
    totalMatches += selectors.length;
  }
  return groups;
};

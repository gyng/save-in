import { RULE_TYPES } from "../shared/constants.ts";
import {
  MAX_PAGE_TEXT_SELECTORS,
  normalizePageText,
  type PageTextCapture,
} from "../shared/page-text-capture.ts";
import {
  isPageTextMatcherClause,
  type MatcherClause,
  type RoutingInfo,
  type RoutingRule,
} from "./rule-types.ts";
import { evaluateMatcherClause } from "./rule-matcher.ts";

const isMatcher = (clause: RoutingRule[number]): clause is MatcherClause =>
  clause.type === RULE_TYPES.MATCHER;

// Matchers that depend on nothing but the page address, which is known before
// any page text is read.
const PAGE_ADDRESS_MATCHERS = new Set(["pageurl", "pagedomain", "pagerootdomain"]);

// The pagetext: selectors worth reading on one page. A rule whose own page
// conditions already rule this page out cannot use the text, so its selector
// is never read there — page text leaves a page only for a rule written for
// that page. Rules without a page condition apply everywhere.
export const pageTextSelectorsForPage = (
  rules: readonly RoutingRule[],
  pageUrl: string | undefined,
): string[] => {
  const info: RoutingInfo = { pageUrl };
  const selectors = new Set<string>();
  for (const rule of rules) {
    const matchers = rule.filter(isMatcher);
    const capture = matchers.find(isPageTextMatcherClause);
    if (!capture) continue;
    const pageCanMatch = matchers.every(
      (clause) =>
        !PAGE_ADDRESS_MATCHERS.has(clause.name) ||
        Boolean(evaluateMatcherClause(clause, info).result),
    );
    if (pageCanMatch) selectors.add(capture.value);
  }
  return [...selectors].slice(0, MAX_PAGE_TEXT_SELECTORS);
};

// The pagetext: selector of one rule, which has at most one.
export const pageTextSelectorOf = (rule: RoutingRule): string | undefined =>
  rule.filter(isMatcher).find(isPageTextMatcherClause)?.value;

// A replay has no page to ask. A recorded selector says which pagetext: clause
// the text came from, so only that selector sees it; every other one sees no
// capture, exactly as on a page without its element. Hand-typed text and
// History rows recorded before the selector have none, so their text stands in
// for every pagetext: selector and the rule that used it can still be traced.
export const replayedPageTextCapture = (
  rules: readonly RoutingRule[],
  text: string | undefined,
  recordedSelector?: string | undefined,
): PageTextCapture | undefined => {
  const normalized = normalizePageText(text ?? "");
  if (!normalized) return undefined;
  if (recordedSelector) return [[recordedSelector, normalized]];
  const selectors = new Set(
    rules
      .flatMap((rule) => rule.filter(isMatcher).filter(isPageTextMatcherClause))
      .map((clause) => clause.value),
  );
  return [...selectors]
    .slice(0, MAX_PAGE_TEXT_SELECTORS)
    .map((selector): PageTextCapture[number] => [selector, normalized]);
};

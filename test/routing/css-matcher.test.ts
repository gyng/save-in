import { evaluateRule } from "../../src/routing/rule-matcher.ts";
import { parseRulesCollecting } from "../../src/routing/rule-parser.ts";
import { isCssMatcherClause } from "../../src/routing/rule-types.ts";

test("CSS trace attempts expose individual origins without weakening same-origin AND", () => {
  const parsed = parseRulesCollecting("css: article img\ncss: img:not(.avatar)\ninto: articles/");
  const rule = parsed.rules[0];
  expect(rule).toBeDefined();
  if (!rule) return;

  const evaluation = evaluateRule(rule, {
    matchedCssSelectorsByOrigin: [["article img"], ["img:not(.avatar)"]],
  });

  expect(evaluation.destination).toBe(false);
  expect(evaluation.clauses.map(({ attempts }) => attempts.map(({ status }) => status))).toEqual([
    ["matched", "not-matched"],
    ["not-matched", "matched"],
  ]);
});

test("the parsed CSS matcher consumes only exact content attestations", () => {
  const parsed = parseRulesCollecting("css: article img\ninto: articles/");
  const clause = parsed.rules[0]?.find((candidate) => candidate.name === "css");
  expect(clause).toBeDefined();
  if (!clause || clause.type !== "MATCHER" || !isCssMatcherClause(clause)) return;

  expect(clause.matcher({ matchedCssSelectorsByOrigin: [["article img"]] })).toBeTruthy();
  expect(clause.matcher({ matchedCssSelectorsByOrigin: [["aside img"]] })).toBeNull();
  expect(clause.matcher({})).toBeNull();
});

test("rejects empty, oversized, and captured CSS selectors at the parser boundary", () => {
  const empty = parseRulesCollecting("css: \ninto: empty/");
  const oversized = parseRulesCollecting(`css: ${"x".repeat(513)}\ninto: oversized/`);
  const captured = parseRulesCollecting("css: img\ncapture: css\ninto: captured/:$1:/");

  expect(empty.rules).toEqual([]);
  expect(oversized.rules).toEqual([]);
  expect(captured.rules).toEqual([]);
  for (const result of [empty, oversized]) {
    expect(result.errors).toContainEqual(
      expect.objectContaining({ message: "ruleInvalidCssSelector" }),
    );
  }
  expect(captured.errors).toContainEqual(
    expect.objectContaining({ message: "ruleCaptureMissingMatcher" }),
  );
});

test("rejects CSS matcher counts that cannot fit in a bounded attestation", () => {
  const oneRule = `${Array.from({ length: 65 }, (_value, index) => `css: .item-${index}`).join("\n")}\ninto: dense/`;
  const oneRuleResult = parseRulesCollecting(oneRule);
  expect(oneRuleResult.rules).toEqual([]);
  expect(oneRuleResult.errors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ message: "ruleTooManyCssSelectors", error: ".item-64" }),
    ]),
  );

  const manyRules = Array.from(
    { length: 257 },
    (_value, index) => `css: .item-${index}\ninto: item-${index}/`,
  ).join("\n\n");
  const manyRulesResult = parseRulesCollecting(manyRules);
  expect(manyRulesResult.rules).toEqual([]);
  expect(manyRulesResult.errors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ message: "ruleTooManyCssSelectors", error: ".item-256" }),
    ]),
  );
});

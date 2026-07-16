import { evaluateRule } from "../../src/routing/rule-matcher.ts";
import { parseRulesCollecting } from "../../src/routing/rule-parser.ts";

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

test("rejects CSS matcher counts that cannot fit in a bounded attestation", () => {
  const oneRule = `${Array.from({ length: 65 }, (_value, index) => `css: .item-${index}`).join("\n")}\ninto: dense/`;
  const oneRuleResult = parseRulesCollecting(oneRule);
  expect(oneRuleResult.rules).toEqual([]);
  expect(oneRuleResult.errors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ error: "a rule may contain at most 64 css: matchers" }),
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
      expect.objectContaining({ error: "routing rules may contain at most 256 css: matchers" }),
    ]),
  );
});

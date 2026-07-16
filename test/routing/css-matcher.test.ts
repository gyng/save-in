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

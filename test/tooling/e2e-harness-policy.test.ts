import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { evaluationBudgetError } = require("../../scripts/check-e2e-harness.js") as {
  evaluationBudgetError: (
    budget: { file: string; label: string; maximum: number },
    actual: number,
  ) => string | null;
};

const budget = {
  file: "test/e2e/example.mjs",
  label: "raw example evaluations",
  maximum: 5,
};

test("requires evaluation ceilings to be lowered after a migration", () => {
  expect(evaluationBudgetError(budget, 4)).toContain("lower its recorded ceiling from 5");
});

test("rejects evaluation growth and accepts the exact recorded count", () => {
  expect(evaluationBudgetError(budget, 6)).toContain("increased to 6");
  expect(evaluationBudgetError(budget, 5)).toBeNull();
});

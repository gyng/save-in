import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { evaluationBudgetError, evaluationTypingErrors, runnerPollingErrors } =
  require("../../scripts/check-e2e-harness.js") as {
    evaluationBudgetError: (
      budget: { file: string; label: string; maximum: number },
      actual: number,
    ) => string | null;
    evaluationTypingErrors: (file: string, source: string) => string[];
    runnerPollingErrors: (file: string, source: string) => string[];
  };

const budget = {
  file: "test/e2e/example.mjs",
  label: "raw example evaluations",
  maximum: 5,
};

test("requires evaluation ceilings to be lowered after a migration", () => {
  expect(evaluationBudgetError(budget, 4)).toContain("lower its recorded ceiling from 5");
});

test("rejects runner-side browser-state polling", () => {
  expect(
    runnerPollingErrors(
      "test/e2e/example.mjs",
      `await poll(
        async () => {
          const rows = await control.downloads.search({});
          return rows.length ? rows : null;
        },
        { description: "download" },
      )`,
    ),
  ).toHaveLength(1);
  expect(
    runnerPollingErrors(
      "test/e2e/example.mjs",
      `await poll(
        async () => {
          return (await evalOptions("document.readyState")) === "complete";
        },
        { description: "document" },
      )`,
    ),
  ).toEqual([]);
});

test("rejects evaluation growth and accepts the exact recorded count", () => {
  expect(evaluationBudgetError(budget, 6)).toContain("increased to 6");
  expect(evaluationBudgetError(budget, 5)).toBeNull();
});

test("rejects evaluator any and unvalidated runner JSON", () => {
  expect(
    evaluationTypingErrors(
      "test/e2e/example.mjs",
      "/** @returns {Promise<any>} */\nconst value = JSON.parse(serialized);",
    ),
  ).toEqual([
    "test/e2e/example.mjs: raw evaluator results must use Promise<unknown>, not Promise<any>.",
    "test/e2e/example.mjs: decode runner JSON through evaluateJson or parseJson.",
  ]);
  expect(
    evaluationTypingErrors(
      "test/e2e/example.mjs",
      "const value = await evaluateJson(evaluate, expression, decode);",
    ),
  ).toEqual([]);
});

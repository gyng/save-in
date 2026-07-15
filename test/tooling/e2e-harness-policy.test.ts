import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  evaluationBudgetError,
  evaluationTypingErrors,
  evaluatorReferenceErrors,
  runnerPollingErrors,
} = require("../../scripts/check-e2e-harness.js") as {
  evaluationBudgetError: (
    budget: { file: string; label: string; maximum: number },
    actual: number,
  ) => string | null;
  evaluationTypingErrors: (file: string, source: string) => string[];
  evaluatorReferenceErrors: (file: string, source: string, evaluator: string) => string[];
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
  expect(
    runnerPollingErrors(
      "test/e2e/example.mjs",
      `await poll(async () => control.history.get(), { description: "history" })`,
    ),
  ).toHaveLength(1);
  expect(
    runnerPollingErrors(
      "test/e2e/example.mjs",
      `await poll(async () => {
        return control.downloads.search({});
      }, { description: "downloads" })`,
    ),
  ).toHaveLength(1);
});

test("rejects aliases that would hide runner-side state polling", () => {
  expect(
    runnerPollingErrors(
      "test/e2e/example.mjs",
      `
        const readHistory = control.history.get;
        const wait = poll;
        await wait(() => readHistory());
      `,
    ),
  ).toEqual(
    expect.arrayContaining([
      expect.stringContaining("structured state reads must not be aliased"),
      expect.stringContaining("poll must not be aliased"),
    ]),
  );
  expect(
    runnerPollingErrors(
      "test/e2e/example.mjs",
      `
        const { get } = control.history;
        await poll(() => get());
      `,
    ),
  ).toEqual([expect.stringContaining("must not be destructured")]);
});

test("allows only the documented raw-background evaluator adapter", () => {
  expect(
    evaluatorReferenceErrors(
      "test/e2e/chrome.e2e.mjs",
      `const evalSW = (expression) => expression;
       runScenario({ evaluate: evalSW });`,
      "evalSW",
    ),
  ).toEqual([]);
  expect(
    evaluatorReferenceErrors(
      "test/e2e/chrome.e2e.mjs",
      `const evalSW = (expression) => expression;
       const hidden = evalSW;
       evaluateJson(hidden, "value", decode);`,
      "evalSW",
    ),
  ).toHaveLength(1);
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

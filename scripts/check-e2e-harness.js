// @ts-check

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

/** @param {string} file @param {RegExp} pattern */
const occurrences = (file, pattern) => {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  return [...source.matchAll(pattern)].length;
};

const budgets = [
  {
    file: "test/e2e/chrome.e2e.mjs",
    label: "raw Chrome background evaluations",
    pattern: /(?:\bevalSW\s*\(|\bevaluateJson\s*\(\s*evalSW\s*,)/g,
    maximum: 0,
  },
  {
    file: "test/e2e/firefox.e2e.mjs",
    label: "raw Firefox background evaluations",
    pattern: /(?:\bevalBackground\s*\(|\bevaluateJson\s*\(\s*evalBackground\s*,)/g,
    maximum: 0,
  },
  {
    file: "test/e2e/firefox.e2e.mjs",
    label: "direct Firefox background evaluations",
    pattern: /\bsession\.evaluate\(/g,
    maximum: 3,
  },
  {
    file: "test/e2e/shared-scenarios.mjs",
    label: "raw shared-scenario evaluations",
    pattern: /(?:\bawait evaluate\s*\(|\bevaluateJson\s*\(\s*evaluate\s*,)/g,
    maximum: 6,
  },
  {
    file: "test/e2e/template-library-scenario.mjs",
    label: "raw template-scenario evaluations",
    pattern: /\bawait evaluate\(/g,
    maximum: 0,
  },
  {
    file: "test/e2e/routing-visual-editor-scenario.mjs",
    label: "raw visual-editor evaluations",
    pattern: /\bawait evaluate\(/g,
    maximum: 0,
  },
];

/** @param {(typeof budgets)[number]} budget @param {number} actual */
const evaluationBudgetError = (budget, actual) => {
  if (actual === budget.maximum) return null;
  if (actual < budget.maximum) {
    return (
      `${budget.file}: ${budget.label} fell to ${actual}; lower its recorded ceiling from ` +
      `${budget.maximum} to preserve the improvement.`
    );
  }
  return (
    `${budget.file}: ${budget.label} increased to ${actual}; ceiling is ${budget.maximum}. ` +
    "Use control-client.mjs instead of adding raw evaluation."
  );
};

/** @param {string} file @param {string} source */
const evaluationTypingErrors = (file, source) => {
  /** @type {string[]} */
  const errors = [];
  if (/Promise\s*<\s*any\s*>/.test(source)) {
    errors.push(`${file}: raw evaluator results must use Promise<unknown>, not Promise<any>.`);
  }
  const jsonBoundaryFiles = new Set(["test/e2e/control-client.mjs", "test/e2e/helpers.mjs"]);
  if (!jsonBoundaryFiles.has(file) && /\bJSON\.parse\s*\(/.test(source)) {
    errors.push(`${file}: decode runner JSON through evaluateJson or parseJson.`);
  }
  return errors;
};

/** @param {string} file @param {string} source */
const runnerPollingErrors = (file, source) => {
  const forbidden =
    /\bcontrol\.(?:history\.get|downloads\.search|storage\.(?:local|session)\.get|background\.notificationCalls)\s*\(/;
  const pollBlocks = source.matchAll(
    /\bawait poll\s*\(\s*async\s*\(\)\s*=>\s*\{([\s\S]*?)\n\s*\},\n\s*\{[^}]*\},?\n\s*\)/g,
  );
  return [...pollBlocks].flatMap((match) =>
    forbidden.test(match[1] ?? "")
      ? [
          `${file}: runner-side state polling is forbidden; use an event-driven structured ` +
            "control wait operation.",
        ]
      : [],
  );
};

/**
 * @param {string} directory
 * @returns {string[]}
 */
const moduleFiles = (directory) =>
  fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(directory, entry.name);
    return entry.isDirectory()
      ? moduleFiles(relative)
      : entry.isFile() && entry.name.endsWith(".mjs")
        ? [relative.replaceAll(path.sep, "/")]
        : [];
  });

const main = () => {
  const errors = budgets.flatMap((budget) => {
    const error = evaluationBudgetError(budget, occurrences(budget.file, budget.pattern));
    return error ? [error] : [];
  });

  for (const file of moduleFiles("test/e2e")) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    errors.push(...evaluationTypingErrors(file, source));
    errors.push(...runnerPollingErrors(file, source));
  }

  const harness = fs.readFileSync(path.join(root, "test/e2e/harness-session.mjs"), "utf8");
  if (/\b(?:eval|evaluate)(?:Background|Control)?\b/.test(harness)) {
    errors.push(
      "test/e2e/harness-session.mjs: case isolation must use the structured control client",
    );
  }

  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("E2E harness evaluation, typing, and wait policies hold.");
  }
};

if (require.main === module) {
  main();
}

module.exports = { evaluationBudgetError, evaluationTypingErrors, runnerPollingErrors };

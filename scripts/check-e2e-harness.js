// @ts-check

const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("acorn");

/** @typedef {{type: string, [key: string]: unknown}} AstNode */

const root = path.resolve(__dirname, "..");

/** @param {string} source @returns {AstNode} */
const parseSource = (source) =>
  /** @type {AstNode} */ (
    /** @type {unknown} */ (parse(source, { ecmaVersion: "latest", sourceType: "module" }))
  );

/** @param {unknown} value @returns {value is AstNode} */
const isAstNode = (value) =>
  value !== null && typeof value === "object" && "type" in value && typeof value.type === "string";

/**
 * @param {AstNode} node
 * @param {(node: AstNode, parent: AstNode | undefined, key: string | undefined, ancestors: AstNode[]) => void} visit
 * @param {AstNode} [parent]
 * @param {string} [key]
 * @param {AstNode[]} [ancestors]
 */
const walk = (node, visit, parent, key, ancestors = []) => {
  visit(node, parent, key, ancestors);
  const nextAncestors = [...ancestors, node];
  for (const [childKey, value] of Object.entries(node)) {
    if (isAstNode(value)) walk(value, visit, node, childKey, nextAncestors);
    else if (Array.isArray(value)) {
      for (const child of value) {
        if (isAstNode(child)) walk(child, visit, node, childKey, nextAncestors);
      }
    }
  }
};

/** @param {AstNode} node @returns {string | undefined} */
const calledPath = (node) => {
  if (node.type === "Identifier") return typeof node.name === "string" ? node.name : undefined;
  if (node.type === "ChainExpression" && isAstNode(node.expression)) {
    return calledPath(node.expression);
  }
  if (node.type !== "MemberExpression" || !isAstNode(node.object)) return undefined;
  /** @type {string | undefined} */
  const owner = calledPath(node.object);
  const property = isAstNode(node.property)
    ? node.property.type === "Identifier" && node.computed !== true
      ? node.property.name
      : node.property.type === "Literal"
        ? node.property.value
        : undefined
    : undefined;
  return owner && typeof property === "string" ? `${owner}.${property}` : undefined;
};

/** @param {string} source @param {(call: AstNode) => boolean} matches */
const callCount = (source, matches) => {
  let count = 0;
  walk(parseSource(source), (node) => {
    if (node.type === "CallExpression" && matches(node)) count += 1;
  });
  return count;
};

/** @param {AstNode} node @param {AstNode | undefined} parent @param {string | undefined} key @param {AstNode[]} ancestors */
const isDeclarationIdentifier = (node, parent, key, ancestors) => {
  if (!parent || node.type !== "Identifier") return false;
  return (
    ancestors.some(
      (ancestor) => ancestor.type === "ObjectPattern" || ancestor.type === "ArrayPattern",
    ) ||
    (key === "id" &&
      [
        "VariableDeclarator",
        "FunctionDeclaration",
        "FunctionExpression",
        "ClassDeclaration",
      ].includes(parent.type)) ||
    key === "params" ||
    (parent.type === "CatchClause" && key === "param") ||
    (parent.type === "Property" && key === "key" && parent.computed !== true) ||
    (parent.type === "MemberExpression" && key === "property" && parent.computed !== true) ||
    parent.type.startsWith("Import") ||
    parent.type === "LabeledStatement" ||
    parent.type === "BreakStatement" ||
    parent.type === "ContinueStatement"
  );
};

/** @param {string} _file @param {string} source @param {string} name */
const identifierReferenceCount = (_file, source, name) => {
  let count = 0;
  walk(parseSource(source), (node, parent, key, ancestors) => {
    if (
      node.type === "Identifier" &&
      node.name === name &&
      !isDeclarationIdentifier(node, parent, key, ancestors)
    ) {
      count += 1;
    }
  });
  return count;
};

/** @param {string} evaluator */
const rawEvaluatorCalls = (evaluator) => {
  /** @param {string} _file @param {string} source */
  return (_file, source) =>
    callCount(source, (call) => {
      const callee = isAstNode(call.callee) ? calledPath(call.callee) : undefined;
      const args = Array.isArray(call.arguments) ? call.arguments : [];
      return (
        callee === evaluator ||
        (callee === "evaluateJson" && isAstNode(args[0]) && calledPath(args[0]) === evaluator)
      );
    });
};

const budgets = [
  {
    file: "test/e2e/chrome.e2e.mjs",
    label: "raw Chrome background evaluations",
    count: rawEvaluatorCalls("evalSW"),
    maximum: 0,
  },
  {
    // evalWorker reaches the same service worker as evalSW over CDP, so it must
    // be budgeted too: while only evalSW was named here, an evaluator spelled
    // differently walked straight through a ceiling of zero. The three that
    // remain install and read a fetch patch inside the worker, which no control
    // operation can express. Anything observable through the bundle belongs in
    // background/e2e-command.ts instead.
    file: "test/e2e/chrome.e2e.mjs",
    label: "raw Chrome service-worker evaluations",
    count: rawEvaluatorCalls("evalWorker"),
    maximum: 3,
  },
  {
    file: "test/e2e/firefox.e2e.mjs",
    label: "raw Firefox background evaluations",
    count: rawEvaluatorCalls("evalBackground"),
    maximum: 0,
  },
  {
    file: "test/e2e/firefox.e2e.mjs",
    label: "direct Firefox background evaluations",
    count: (/** @type {string} */ _file, /** @type {string} */ source) =>
      callCount(
        source,
        (call) => isAstNode(call.callee) && calledPath(call.callee) === "session.evaluate",
      ),
    maximum: 3,
  },
  {
    file: "test/e2e/shared-scenarios.mjs",
    label: "raw shared-scenario evaluations",
    count: (/** @type {string} */ file, /** @type {string} */ source) =>
      identifierReferenceCount(file, source, "evaluate"),
    maximum: 6,
  },
  {
    file: "test/e2e/template-library-scenario.mjs",
    label: "raw template-scenario evaluations",
    count: (/** @type {string} */ file, /** @type {string} */ source) =>
      identifierReferenceCount(file, source, "evaluate"),
    maximum: 0,
  },
  {
    file: "test/e2e/routing-visual-editor-scenario.mjs",
    label: "raw visual-editor evaluations",
    count: (/** @type {string} */ file, /** @type {string} */ source) =>
      identifierReferenceCount(file, source, "evaluate"),
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
  const jsonBoundaryFiles = new Set([
    "test/e2e/control-client.mjs",
    "test/e2e/control-page-runtime.mjs",
    "test/e2e/helpers.mjs",
  ]);
  if (!jsonBoundaryFiles.has(file) && /\bJSON\.parse\s*\(/.test(source)) {
    errors.push(`${file}: decode runner JSON through evaluateJson or parseJson.`);
  }
  return errors;
};

/** @param {string} file @param {string} source */
const runnerPollingErrors = (file, source) => {
  const forbidden = new Set([
    "control.history.get",
    "control.downloads.search",
    "control.storage.local.get",
    "control.storage.session.get",
    "control.background.notificationCalls",
  ]);
  /** @type {string[]} */
  const errors = [];
  /** @param {AstNode | undefined} parent @param {string | undefined} key @param {AstNode[]} ancestors */
  const isDirectCallee = (parent, key, ancestors) =>
    (parent?.type === "CallExpression" && key === "callee") ||
    (parent?.type === "ChainExpression" &&
      ancestors.at(-2)?.type === "CallExpression" &&
      ancestors.at(-2)?.callee === parent);
  const containsForbiddenRead = (/** @type {AstNode} */ rootNode) => {
    let found = false;
    walk(rootNode, (node) => {
      if (
        node.type === "CallExpression" &&
        isAstNode(node.callee) &&
        forbidden.has(calledPath(node.callee) ?? "")
      ) {
        found = true;
      }
    });
    return found;
  };
  walk(parseSource(source), (node, parent, key, ancestors) => {
    if (
      node.type === "Identifier" &&
      node.name === "poll" &&
      !isDeclarationIdentifier(node, parent, key, ancestors) &&
      !isDirectCallee(parent, key, ancestors)
    ) {
      errors.push(`${file}: poll must not be aliased; call the audited helper directly.`);
    }
    if (
      node.type === "MemberExpression" &&
      forbidden.has(calledPath(node) ?? "") &&
      !isDirectCallee(parent, key, ancestors)
    ) {
      errors.push(`${file}: structured state reads must not be aliased before a polling callback.`);
    }
    if (
      node.type === "VariableDeclarator" &&
      isAstNode(node.id) &&
      node.id.type === "ObjectPattern" &&
      isAstNode(node.init) &&
      [
        "control.history",
        "control.downloads",
        "control.storage.local",
        "control.storage.session",
        "control.background",
      ].includes(calledPath(node.init) ?? "")
    ) {
      errors.push(
        `${file}: structured state reads must not be destructured before a polling callback.`,
      );
    }
    if (
      node.type === "CallExpression" &&
      isAstNode(node.callee) &&
      calledPath(node.callee) === "poll" &&
      Array.isArray(node.arguments) &&
      isAstNode(node.arguments[0]) &&
      containsForbiddenRead(node.arguments[0])
    ) {
      errors.push(
        `${file}: runner-side state polling is forbidden; use an event-driven structured ` +
          "control wait operation.",
      );
    }
  });
  return errors;
};

/** @param {string} file @param {string} source */
const runnerPollBudgetErrors = (file, source) => {
  const approved = new Map([
    ["test/e2e/chrome.e2e.mjs", 13],
    ["test/e2e/firefox.e2e.mjs", 5],
    ["test/e2e/routing-visual-editor-scenario.mjs", 2],
  ]);
  const expected = approved.get(file) ?? 0;
  const actual = callCount(
    source,
    (call) => isAstNode(call.callee) && calledPath(call.callee) === "poll",
  );
  if (actual === expected) return [];
  if (actual < expected) {
    return [
      `${file}: runner poll count fell to ${actual}; lower its recorded ceiling from ` +
        `${expected} to preserve the improvement.`,
    ];
  }
  return [
    `${file}: runner polls increased to ${actual}; ceiling is ${expected}. ` +
      "Use an in-page signal or structured control wait.",
  ];
};

/** @param {string} file @param {string} source */
const fixedDelayErrors = (file, source) => {
  const approved = new Map([
    ["test/e2e/helpers.mjs", 1],
    ["test/e2e/harness-session.mjs", 1],
  ]);
  const expected = approved.get(file) ?? 0;
  const direct = callCount(
    source,
    (call) =>
      isAstNode(call.callee) &&
      ["setTimeout", "globalThis.setTimeout", "window.setTimeout"].includes(
        calledPath(call.callee) ?? "",
      ),
  );
  let embedded = 0;
  walk(parseSource(source), (node) => {
    const text =
      node.type === "TemplateElement" &&
      node.value !== null &&
      typeof node.value === "object" &&
      "raw" in node.value &&
      typeof node.value.raw === "string"
        ? node.value.raw
        : node.type === "Literal" && typeof node.value === "string"
          ? node.value
          : undefined;
    if (typeof text !== "string") return;
    embedded += text.match(/\b(?:(?:globalThis|window)\.)?setTimeout\s*\(/g)?.length ?? 0;
  });
  const actual = direct + embedded;
  if (actual === expected) return [];
  if (actual < expected) {
    return [
      `${file}: fixed-delay allowance fell to ${actual}; lower its recorded ceiling from ` +
        `${expected} to preserve the improvement.`,
    ];
  }
  return [
    `${file}: fixed delays increased to ${actual}; ceiling is ${expected}. ` +
      "Wait on a browser event, DOM mutation, protocol response, or resource state instead.",
  ];
};

/** @param {string} file @param {string} source @param {string} evaluator */
const evaluatorReferenceErrors = (file, source, evaluator) => {
  /** @type {string[]} */
  const errors = [];
  walk(parseSource(source), (node, parent, key, ancestors) => {
    if (
      node.type === "Identifier" &&
      node.name === evaluator &&
      !isDeclarationIdentifier(node, parent, key, ancestors)
    ) {
      const allowedAdapter =
        parent?.type === "Property" &&
        key === "value" &&
        isAstNode(parent.key) &&
        ((parent.key.type === "Identifier" && parent.key.name === "evaluate") ||
          (parent.key.type === "Literal" && parent.key.value === "evaluate"));
      if (!allowedAdapter) {
        errors.push(
          `${file}: ${evaluator} may only be passed as the documented lifecycle-scenario adapter.`,
        );
      }
    }
  });
  return errors;
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
    const source = fs.readFileSync(path.join(root, budget.file), "utf8");
    const error = evaluationBudgetError(budget, budget.count(budget.file, source));
    return error ? [error] : [];
  });

  for (const file of moduleFiles("test/e2e")) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    errors.push(...evaluationTypingErrors(file, source));
    errors.push(...runnerPollingErrors(file, source));
    errors.push(...runnerPollBudgetErrors(file, source));
    errors.push(...fixedDelayErrors(file, source));
  }
  /** @type {Array<[string, string]>} */
  const evaluators = [
    ["test/e2e/chrome.e2e.mjs", "evalSW"],
    ["test/e2e/firefox.e2e.mjs", "evalBackground"],
  ];
  for (const [file, evaluator] of evaluators) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    errors.push(...evaluatorReferenceErrors(file, source, evaluator));
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

module.exports = {
  evaluationBudgetError,
  evaluationTypingErrors,
  evaluatorReferenceErrors,
  fixedDelayErrors,
  runnerPollBudgetErrors,
  runnerPollingErrors,
};

// @ts-check

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
/** @param {string} file */
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const constantsSource = read("src/shared/constants.ts");
const variableSource = read("src/routing/variable.ts");
const matcherSource = read("src/routing/matchers.ts");
const variableReference = read("src/options/options.html");
const matcherReference = read("src/options/clauselist.html");

const specialDirsBlock = constantsSource.match(
  /export const SPECIAL_DIRS = \{(?<body>[\s\S]*?)\n\} as const;/,
)?.groups?.body;
if (!specialDirsBlock) throw new Error("Could not find SPECIAL_DIRS");

const specialDirs = new Map(
  [...specialDirsBlock.matchAll(/^\s*([A-Z0-9_]+):\s*"([^"]+)",?$/gm)].map((match) => [
    match[1],
    match[2],
  ]),
);
if (!specialDirs.size) throw new Error("Could not read SPECIAL_DIRS members");

const transformerBlock = variableSource.match(
  /export const transformers(?:\s*:\s*TransformerRegistry)?\s*=\s*\{(?<body>[\s\S]*?)\n\s*\};/,
)?.groups?.body;
if (!transformerBlock) throw new Error("Could not find transformers");

const variableTokens = [...transformerBlock.matchAll(/\[SPECIAL_DIRS\.([A-Z0-9_]+)\]\s*:/g)].map(
  (match) => {
    const token = specialDirs.get(match[1]);
    if (!token) throw new Error(`Unknown SPECIAL_DIRS member ${match[1]} used by transformers`);
    return token;
  },
);
if (!variableTokens.length) throw new Error("Could not read transformer variable names");

const matcherBlock = matcherSource.match(
  /export const matcherFunctions = \{(?<body>[\s\S]*?)\n\} satisfies Record<string, MatcherFactory>;/,
)?.groups?.body;
if (!matcherBlock) throw new Error("Could not find matcherFunctions");

const matcherTokens = [...matcherBlock.matchAll(/^\s{2}([a-z][a-z0-9]*):/gm)].map(
  (match) => `${match[1]}:`,
);
if (!matcherTokens.length) throw new Error("Could not read matcher names");

const actionValuesSource = read("src/routing/action-values.ts");
const actionValuesBlock = actionValuesSource.match(
  /export const ROUTING_ACTION_VALUES = \{(?<body>[\s\S]*?)\n\} as const;/,
)?.groups?.body;
if (!actionValuesBlock) throw new Error("Could not find ROUTING_ACTION_VALUES");
const actionCopyValues = [...actionValuesBlock.matchAll(/^\s*([a-z]+):\s*"([^"]+)",?$/gm)].map(
  (match) => `data-copy-value="${match[1]}: ${match[2]}"`,
);
if (!actionCopyValues.length) throw new Error("Could not read ROUTING_ACTION_VALUES members");

const missing = [
  ...variableTokens
    .filter((token) => !variableReference.includes(token))
    .map((token) => `src/options/options.html: missing runtime variable ${token}`),
  // The action rows' copyable values must stay the parser's exact canon: a
  // reconciliation once dropped them and no test could see the shipped markup.
  ...actionCopyValues
    .filter((attr) => !variableReference.includes(attr))
    .map((attr) => `src/options/options.html: action row missing ${attr}`),
  ...actionCopyValues
    .filter((attr) => !matcherReference.includes(attr))
    .map((attr) => `src/options/clauselist.html: action row missing ${attr}`),
  ...(variableReference.includes("capturegroups:")
    ? []
    : ["src/options/options.html: missing capturegroups variable"]),
  ...[...matcherTokens, "capture:", "capturegroups:", "into:", "fetch:"]
    .filter((token) => !matcherReference.includes(token))
    .map((token) => `src/options/clauselist.html: missing routing clause ${token}`),
  ...(variableReference.includes("fetch:")
    ? []
    : ["src/options/options.html: missing routing clause fetch:"]),
];

if (missing.length) {
  for (const violation of missing)
    process.stderr.write(`reference policy violation: ${violation}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Runtime reference vocabulary check passed.\n");
}

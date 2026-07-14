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

const missing = [
  ...variableTokens
    .filter((token) => !variableReference.includes(token))
    .map((token) => `src/options/options.html: missing runtime variable ${token}`),
  ...(variableReference.includes("capturegroups:")
    ? []
    : ["src/options/options.html: missing capturegroups variable"]),
  ...[...matcherTokens, "capture:", "capturegroups:", "into:"]
    .filter((token) => !matcherReference.includes(token))
    .map((token) => `src/options/clauselist.html: missing routing clause ${token}`),
];

if (missing.length) {
  for (const violation of missing)
    process.stderr.write(`reference policy violation: ${violation}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Runtime reference vocabulary check passed.\n");
}

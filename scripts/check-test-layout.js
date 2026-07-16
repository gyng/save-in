// @ts-check

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const testRoot = path.join(root, "test");
const allowedOwners = new Set([
  "automation",
  "background",
  "config",
  "content",
  "contracts",
  "downloads",
  "e2e",
  "fuzz",
  "i18n",
  "integration",
  "live",
  "options",
  "platform",
  "routing",
  "shared",
  "support",
  "tooling",
]);

/** @param {string} directory @returns {string[]} */
const listFiles = (directory) =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(file) : [file];
  });

/** @param {string} file */
const relative = (file) => path.relative(root, file).replaceAll(path.sep, "/");
const errors = [];
const rootEntries = fs.readdirSync(testRoot, { withFileTypes: true });

for (const entry of rootEntries) {
  if (entry.isFile() && entry.name.endsWith(".ts")) {
    errors.push(`test/${entry.name}: test files must live under an owner`);
  } else if (entry.isDirectory() && !allowedOwners.has(entry.name)) {
    errors.push(`test/${entry.name}: unknown test owner directory`);
  }
}

const files = listFiles(testRoot).filter((file) => file.endsWith(".ts"));
const caseFiles = new Set(files.filter((file) => file.endsWith(".cases.ts")));
/** @type {Map<string, string[]>} */
const caseImporters = new Map([...caseFiles].map((file) => [file, []]));

for (const file of files) {
  if (file.endsWith(".suite.ts")) {
    errors.push(`${relative(file)}: use .cases.ts for imported test cases`);
  }
  const source = fs.readFileSync(file, "utf8");
  if (caseFiles.has(file) && source.includes("@vitest-environment")) {
    errors.push(`${relative(file)}: put the environment annotation on its .test.ts importer`);
  }
  for (const match of source.matchAll(/(?:from\s+|import\s*)["'](\.[^"']+)["']/g)) {
    const specifier = match[1];
    if (!specifier) continue;
    const imported = path.resolve(path.dirname(file), specifier);
    if (caseFiles.has(imported)) caseImporters.get(imported)?.push(file);
  }
}

for (const [file, importers] of caseImporters) {
  if (importers.length !== 1 || !importers[0]?.endsWith(".test.ts")) {
    errors.push(
      `${relative(file)}: expected exactly one .test.ts importer, found ${
        importers.length ? importers.map(relative).join(", ") : "none"
      }`,
    );
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Test layout is organized under ${allowedOwners.size} owners (${files.length} TypeScript files).`,
  );
}

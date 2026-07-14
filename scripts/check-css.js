// @ts-check

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const styles = fs
  .readdirSync(path.join(root, "src", "options"), { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".css"))
  .map((entry) => path.join(root, "src", "options", entry.name));

const definitions = new Set();
const uses = new Map();
for (const file of styles) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(/(--[\w-]+)\s*:/g)) definitions.add(match[1]);
  for (const match of source.matchAll(/var\((--[\w-]+)/g)) {
    const locations = uses.get(match[1]) || [];
    locations.push(path.relative(root, file));
    uses.set(match[1], locations);
  }
}

// Visual path rows receive their nesting depth from the editor at runtime.
definitions.add("--row-depth");

const missing = [...uses]
  .filter(([token]) => !definitions.has(token))
  .map(([token, files]) => `${token} used by ${[...new Set(files)].join(", ")}`)
  .toSorted();

if (missing.length) {
  for (const violation of missing) process.stderr.write(`CSS policy violation: ${violation}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("CSS custom-property checks passed.\n");
}

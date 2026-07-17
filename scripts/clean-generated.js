// @ts-check

const fs = require("node:fs");
const path = require("node:path");

const GENERATED_DIRECTORIES = Object.freeze(["coverage", "dist", "web-ext-artifacts"]);

/** @param {string} root */
const cleanGenerated = (root) => {
  const resolvedRoot = path.resolve(root);
  const removed = [];
  for (const directory of GENERATED_DIRECTORIES) {
    const target = path.resolve(resolvedRoot, directory);
    if (path.dirname(target) !== resolvedRoot) {
      throw new Error(`Refusing to clean outside the repository: ${target}`);
    }
    if (!fs.existsSync(target)) continue;
    fs.rmSync(target, { recursive: true, force: true });
    removed.push(directory);
  }
  return removed;
};

const main = () => {
  const root = path.resolve(__dirname, "..");
  const removed = cleanGenerated(root);
  process.stdout.write(
    removed.length
      ? `Removed generated output: ${removed.join(", ")}\n`
      : "Generated output is already clean.\n",
  );
};

if (require.main === module) main();

module.exports = { GENERATED_DIRECTORIES, cleanGenerated };

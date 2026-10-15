// @ts-check

const fs = require("node:fs");
const path = require("node:path");
const { walkFiles } = require("./lib/walk-files.js");

const root = path.resolve(__dirname, "..");
const upstream = path.dirname(require.resolve("@types/chrome/package.json"));
const output = path.join(root, "dist", "types", "save-in-chrome");

/** @param {string} source */
const adaptChromeDeclarations = (source) => {
  // Firefox owns browser in these projects, but content scripts still need
  // Chrome's callback signatures. Preserve every API declaration upstream.
  for (const declaration of [
    "    browser: typeof chrome;",
    "declare var browser: typeof chrome;",
  ]) {
    const matches = source.split("\n").filter((line) => line === declaration);
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one ${declaration.trim()} in @types/chrome; review the adapter.`,
      );
    }
    const pattern = new RegExp(
      String.raw`(?:^[ \t]*/\*\*\n(?:^[ \t]*\*[^\n]*\n)*^[ \t]*\*/\n)?^` +
        declaration.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
        "\\n",
      "m",
    );
    source = source.replace(pattern, "");
  }
  return source;
};

const generateChromeTypes = (check = false) => {
  const files = walkFiles(upstream);
  const expected = new Map(
    files.map((file) => {
      const relative = path.relative(upstream, file);
      const contents = fs.readFileSync(file);
      return [
        relative,
        relative === "index.d.ts"
          ? Buffer.from(adaptChromeDeclarations(contents.toString("utf8")))
          : contents,
      ];
    }),
  );
  if (!expected.has("index.d.ts"))
    throw new Error("@types/chrome no longer has index.d.ts; review the adapter.");
  const actual = fs.existsSync(output) ? walkFiles(output) : [];
  const current =
    actual.length === expected.size &&
    actual.every((file) =>
      expected.get(path.relative(output, file))?.equals(fs.readFileSync(file)),
    );
  if (current) return;
  if (check)
    throw new Error("Firefox Chrome typings are stale; run npm run generate:chrome-types.");
  fs.rmSync(output, { recursive: true, force: true });
  for (const [relative, contents] of expected) {
    const target = path.join(output, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
};

if (require.main === module) {
  generateChromeTypes(process.argv.includes("--check"));
  console.log(
    "Firefox Chrome typings match the installed package, with only browser aliases omitted.",
  );
}

module.exports = { adaptChromeDeclarations, generateChromeTypes };

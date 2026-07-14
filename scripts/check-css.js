// @ts-check

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const styles = fs
  .readdirSync(path.join(root, "src", "options"), { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".css"))
  .map((entry) => path.join(root, "src", "options", entry.name));

const violations = [];

const definitions = new Set();
const uses = new Map();
for (const file of styles) {
  const source = fs.readFileSync(file, "utf8");
  const relative = path.relative(root, file);
  for (const match of source.matchAll(/(--[\w-]+)\s*:/g)) definitions.add(match[1]);
  for (const match of source.matchAll(/var\((--[\w-]+)/g)) {
    const locations = uses.get(match[1]) || [];
    locations.push(relative);
    uses.set(match[1], locations);
  }

  const typographyPolicies = [
    {
      property: "font-size",
      allowed: /^(?:var\(--text-(?:xs|sm|base|lg|xl)\)|inherit)$/,
    },
    {
      property: "font-family",
      allowed: /^(?:var\(--font-(?:stack|mono)\)|inherit)$/,
    },
    {
      property: "font-weight",
      allowed: /^(?:400|500|600|700|inherit)$/,
    },
    {
      property: "font",
      allowed: /^inherit$/,
    },
  ];
  for (const { property, allowed } of typographyPolicies) {
    const declaration = new RegExp(`(^|[;{]\\s*)${property}\\s*:\\s*([^;}{]+)`, "gm");
    for (const match of source.matchAll(declaration)) {
      const value = match[2]?.trim();
      if (value && !allowed.test(value)) {
        const propertyIndex = match.index + (match[1]?.length || 0);
        const line = source.slice(0, propertyIndex).split("\n").length;
        violations.push(`${relative}:${line} uses ${property}: ${value}`);
      }
    }
  }
}

const optionEntries = fs.readdirSync(path.join(root, "src", "options"), { withFileTypes: true });
for (const entry of optionEntries) {
  if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
  const file = path.join(root, "src", "options", entry.name);
  const relative = path.relative(root, file);
  const source = fs.readFileSync(file, "utf8");
  const runtimeTypography =
    /\.style\.(?:font|fontFamily|fontSize|fontWeight|lineHeight)\s*=|\.style\.setProperty\(\s*["']font(?:-|["'])/g;
  for (const match of source.matchAll(runtimeTypography)) {
    const line = source.slice(0, match.index).split("\n").length;
    violations.push(`${relative}:${line} assigns typography inline; use a CSS class and token`);
  }
}

for (const entry of optionEntries) {
  if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
  const file = path.join(root, "src", "options", entry.name);
  const relative = path.relative(root, file);
  const source = fs.readFileSync(file, "utf8");
  const inlineTypography = /style\s*=\s*["'][^"']*\bfont(?:-|\s*:)/gi;
  for (const match of source.matchAll(inlineTypography)) {
    const line = source.slice(0, match.index).split("\n").length;
    violations.push(`${relative}:${line} assigns typography inline; use a CSS class and token`);
  }
}

// Visual path rows receive their nesting depth from the editor at runtime.
definitions.add("--row-depth");

const missing = [...uses]
  .filter(([token]) => !definitions.has(token))
  .map(([token, files]) => `${token} used by ${[...new Set(files)].join(", ")}`)
  .toSorted();

violations.push(...missing);

if (violations.length) {
  for (const violation of violations.toSorted()) {
    process.stderr.write(`CSS policy violation: ${violation}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write("CSS custom-property and typography checks passed.\n");
}

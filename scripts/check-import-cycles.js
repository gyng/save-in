const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const srcRoot = path.join(root, "src");

const listFiles = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(file) : entry.name.endsWith(".ts") ? [file] : [];
  });

const files = listFiles(srcRoot);
const known = new Set(files);
const graph = new Map(files.map((file) => [file, []]));
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const statements = [];
  let statement = "";
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trimStart();
    if (!statement) {
      const startsImport = trimmed.startsWith("import ");
      const startsReExport = /^export\s+(?:type\s+)?(?:\{|\*)/.test(trimmed);
      if (!startsImport && !startsReExport) continue;
    }
    statement += `${line}\n`;
    if (line.includes(";")) {
      statements.push(statement);
      statement = "";
    }
  }

  for (const declaration of statements) {
    // Type-only edges are erased and cannot participate in the runtime SCC.
    if (/^\s*(?:import|export)\s+type\b/.test(declaration)) continue;
    const match =
      declaration.match(/\bfrom\s+["'](\.[^"']+)["']/) ||
      declaration.match(/^\s*import\s+["'](\.[^"']+)["']/);
    if (!match) continue;
    const resolved = path.resolve(path.dirname(file), match[1]);
    const target = path.extname(resolved) ? resolved : `${resolved}.ts`;
    if (known.has(target)) graph.get(file).push(target);
  }
}

let nextIndex = 0;
const indexes = new Map();
const lowLinks = new Map();
const stack = [];
const onStack = new Set();
const cycles = [];

const visit = (file) => {
  indexes.set(file, nextIndex);
  lowLinks.set(file, nextIndex);
  nextIndex += 1;
  stack.push(file);
  onStack.add(file);

  for (const dependency of graph.get(file)) {
    if (!indexes.has(dependency)) {
      visit(dependency);
      lowLinks.set(file, Math.min(lowLinks.get(file), lowLinks.get(dependency)));
    } else if (onStack.has(dependency)) {
      lowLinks.set(file, Math.min(lowLinks.get(file), indexes.get(dependency)));
    }
  }

  if (lowLinks.get(file) !== indexes.get(file)) return;

  const component = [];
  let member;
  do {
    member = stack.pop();
    onStack.delete(member);
    component.push(member);
  } while (member !== file);

  const selfCycle = component.length === 1 && graph.get(file).includes(file);
  if (component.length > 1 || selfCycle) cycles.push(component);
};

for (const file of files) {
  if (!indexes.has(file)) visit(file);
}

if (cycles.length) {
  for (const component of cycles) {
    const names = component.map((file) => path.relative(root, file)).sort();
    process.stderr.write(`Import cycle: ${names.join(" -> ")}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(`Import graph is acyclic (${files.length} modules).\n`);
}

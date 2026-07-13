const fs = require("fs");
const path = require("path");
const {
  callsIdentifier,
  hasBrowserListenerRegistration,
  hasDynamicImport,
  hasGlobalNamespaceMutation,
} = require("./lib/architecture-checks.js");

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
const imports = new Map(files.map((file) => [file, []]));
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
    const match =
      declaration.match(/\bfrom\s+["'](\.[^"']+)["']/) ||
      declaration.match(/^\s*import\s+["'](\.[^"']+)["']/);
    if (!match) continue;
    const resolved = path.resolve(path.dirname(file), match[1]);
    const target = path.extname(resolved) ? resolved : `${resolved}.ts`;
    if (known.has(target)) {
      imports.get(file).push(target);
      // Type-only edges are erased and cannot participate in the runtime SCC.
      if (!/^\s*(?:import|export)\s+type\b/.test(declaration)) graph.get(file).push(target);
    }
  }
}

const relative = (file) => path.relative(root, file).replaceAll(path.sep, "/");
const architectureViolations = [];
const report = (file, rule, dependency) =>
  architectureViolations.push(
    `${relative(file)}: ${rule}${dependency ? ` (${relative(dependency)})` : ""}`,
  );

// Execution contexts communicate through shared contracts, never by importing
// the background implementation that happens to serve them today.
for (const [file, dependencies] of imports) {
  if (!relative(file).startsWith("src/options/")) continue;
  for (const dependency of dependencies) {
    if (relative(dependency).startsWith("src/background/")) {
      report(file, "options must not import background implementations", dependency);
    }
  }
}

// Config owns schemas, normalization and stored values. Application services
// may consume config, but config must not reach upward into execution-context
// or download/background implementations.
for (const [file, dependencies] of imports) {
  if (!relative(file).startsWith("src/config/")) continue;
  for (const dependency of dependencies) {
    if (
      ["src/background/", "src/content/", "src/downloads/", "src/entries/", "src/options/"].some(
        (boundary) => relative(dependency).startsWith(boundary),
      )
    ) {
      report(
        file,
        "config must not import application or execution-context implementations",
        dependency,
      );
    }
  }
}

// Low-level runtime layers cannot point back into feature or composition
// layers. Type-only contract references remain erased from this graph.
const runtimeLayerRules = [
  ["src/shared/", ["src/shared/", "src/vendor/"]],
  ["src/platform/", ["src/platform/", "src/shared/", "src/vendor/"]],
];
for (const [file, dependencies] of graph) {
  const sourceLayer = runtimeLayerRules.find(([prefix]) => relative(file).startsWith(prefix));
  if (!sourceLayer) continue;
  for (const dependency of dependencies) {
    if (!sourceLayer[1].some((prefix) => relative(dependency).startsWith(prefix))) {
      report(file, `${sourceLayer[0]} runtime imports must point downward`, dependency);
    }
  }
}

for (const [file, dependencies] of imports) {
  if (!relative(file).startsWith("src/routing/")) continue;
  for (const dependency of dependencies) {
    if (
      ["src/background/", "src/downloads/", "src/platform/"].some((boundary) =>
        relative(dependency).startsWith(boundary),
      )
    ) {
      report(file, "routing must depend only on shared contracts and injected ports", dependency);
    }
  }
}

for (const [file, dependencies] of imports) {
  if (!relative(file).startsWith("src/downloads/")) continue;
  for (const dependency of dependencies) {
    if (relative(dependency).startsWith("src/background/")) {
      report(file, "downloads must not import background implementations", dependency);
    }
  }
}

// Browser listener ownership is intentionally small and reviewable. Feature
// registration modules are composition boundaries even when called by an entry.
const listenerOwners = new Set([
  "src/background/main.ts",
  "src/background/menu-click.ts",
  "src/background/menu-tabs.ts",
  "src/background/messaging.ts",
  "src/content/content.ts",
  "src/downloads/filename-listener.ts",
  "src/downloads/notification.ts",
  "src/entries/offscreen.ts",
  "src/offscreen.ts",
  "src/options/options.ts",
  "src/options/permissions-banner.ts",
]);
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  if (hasBrowserListenerRegistration(source) && !listenerOwners.has(relative(file))) {
    report(file, "browser listeners may only be registered by composition modules");
  }

  if (hasDynamicImport(source)) {
    report(file, "dynamic imports are forbidden because they bypass the static module graph");
  }
  if (hasGlobalNamespaceMutation(source)) {
    report(file, "source modules must not mutate the global namespace directly");
  }
}

const compositionCallOwners = new Map([
  ["configureDownloadPorts", new Set(["src/background/main.ts"])],
  ["configureRoutingPorts", new Set(["src/background/main.ts", "src/options/options-runtime.ts"])],
  ["installBackgroundE2EBridge", new Set(["src/entries/background.e2e.ts"])],
]);
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  for (const [call, owners] of compositionCallOwners) {
    if (callsIdentifier(source, call) && !owners.has(relative(file))) {
      report(file, `${call} may only be called by its composition owner`);
    }
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

if (cycles.length || architectureViolations.length) {
  for (const component of cycles) {
    const names = component.map((file) => path.relative(root, file)).toSorted();
    process.stderr.write(`Import cycle: ${names.join(" -> ")}\n`);
  }
  for (const violation of architectureViolations.toSorted()) {
    process.stderr.write(`Architecture violation: ${violation}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Import graph is acyclic and architecture boundaries hold (${files.length} modules).\n`,
  );
}

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

/** @param {string} dir @returns {string[]} */
const listFiles = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(file) : entry.name.endsWith(".ts") ? [file] : [];
  });

const files = listFiles(srcRoot);
const known = new Set(files);
/** @type {Map<string, string[]>} */
const graph = new Map(files.map((file) => [file, []]));
/** @type {Map<string, string[]>} */
const imports = new Map(files.map((file) => [file, []]));
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  /** @type {string[]} */
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
      imports.get(file)?.push(target);
      // Type-only edges are erased and cannot participate in the runtime SCC.
      if (!/^\s*(?:import|export)\s+type\b/.test(declaration)) graph.get(file)?.push(target);
    }
  }
}

/** @param {string} file */
const relative = (file) => path.relative(root, file).replaceAll(path.sep, "/");
/** @type {string[]} */
const architectureViolations = [];
/** @param {string} file @param {string} rule @param {string} [dependency] */
const report = (file, rule, dependency) =>
  architectureViolations.push(
    `${relative(file)}: ${rule}${dependency ? ` (${relative(dependency)})` : ""}`,
  );

/** @param {string} name */
const readRepoFile = (name) => fs.readFileSync(path.join(root, name), "utf8");
/** @param {string} name @param {string | RegExp} forbidden @param {string} rule */
const forbidText = (name, forbidden, rule) => {
  const source = readRepoFile(name);
  const found = typeof forbidden === "string" ? source.includes(forbidden) : forbidden.test(source);
  if (found) report(path.join(root, name), rule);
};
/** @param {string} name @param {string | RegExp} required @param {string} rule */
const requireText = (name, required, rule) => {
  const source = readRepoFile(name);
  const found = typeof required === "string" ? source.includes(required) : required.test(source);
  if (!found) report(path.join(root, name), rule);
};

forbidText("rolldown.config.mjs", "self.window = self", "must not emulate Window in workers");
forbidText(
  "src/background/runtime.ts",
  'Symbol.for("save-in.backgroundRuntime")',
  "background runtime state must remain module-owned",
);
for (const name of ["src/options/options.ts", "src/options/tabs.ts", "types/platform.d.ts"]) {
  forbidText(name, "window.confirmPendingChanges", "must not use Window as an options message bus");
}
forbidText(
  "src/entries/background.ts",
  "registerBackgroundE2ECommand",
  "production entry must not register E2E controls",
);
requireText(
  "src/entries/background.e2e.ts",
  "registerBackgroundE2ECommand()",
  "E2E entry must register the command bridge",
);
forbidText(
  "src/entries/background.e2e.ts",
  "globalThis",
  "E2E controls must not be exposed on the browser global",
);
forbidText("rolldown.config.mjs", "SAVE_IN_E2E", "must use the explicit build mode contract");
requireText(
  "rolldown.config.mjs",
  "SAVE_IN_CONTENT_E2E",
  "must retain explicit content-panel E2E gating",
);
requireText(
  "scripts/build-bundled.js",
  "Unexpected content panel shadow mode",
  "staging must verify content-panel shadow mode",
);
for (const name of ["e2e/chrome.e2e.mjs", "e2e/firefox.e2e.mjs"]) {
  forbidText(name, "__SAVE_IN_E2E__", "harness must use the command bridge");
  forbidText(name, "runtime: window", "harness must not expose Window as runtime");
  forbidText(
    name,
    /\b(Log|SaveHistory|Download|Notifier|Messaging|options),/,
    "harness must not depend on background globals",
  );
}
requireText(
  "src/entries/options.ts",
  /addEventListener\(\s*["']DOMContentLoaded["']/,
  "options entry must own DOM-ready registration",
);
for (const name of [
  "src/options/l10n.ts",
  "src/options/history-panel.ts",
  "src/options/option-search.ts",
  "src/options/options-reference.ts",
  "src/options/path-editor.ts",
  "src/options/permissions-banner.ts",
  "src/options/rule-builder.ts",
  "src/options/source-shortcut.ts",
  "src/options/options-bootstrap.ts",
]) {
  forbidText(name, /addEventListener\(\s*["']DOMContentLoaded["']/, "DOM-ready is entry-owned");
}

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
/** @type {Array<[string, string[]]>} */
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
  "src/background/e2e-command.ts",
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
  ["registerBackgroundE2ECommand", new Set(["src/entries/background.e2e.ts"])],
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
/** @type {Map<string, number>} */
const indexes = new Map();
/** @type {Map<string, number>} */
const lowLinks = new Map();
/** @type {string[]} */
const stack = [];
/** @type {Set<string>} */
const onStack = new Set();
/** @type {string[][]} */
const cycles = [];

/** @param {string} file */
const visit = (file) => {
  indexes.set(file, nextIndex);
  lowLinks.set(file, nextIndex);
  nextIndex += 1;
  stack.push(file);
  onStack.add(file);

  for (const dependency of graph.get(file) || []) {
    if (!indexes.has(dependency)) {
      visit(dependency);
      lowLinks.set(file, Math.min(lowLinks.get(file) ?? 0, lowLinks.get(dependency) ?? 0));
    } else if (onStack.has(dependency)) {
      lowLinks.set(file, Math.min(lowLinks.get(file) ?? 0, indexes.get(dependency) ?? 0));
    }
  }

  if (lowLinks.get(file) !== indexes.get(file)) return;

  /** @type {string[]} */
  const component = [];
  /** @type {string | undefined} */
  let member;
  do {
    member = stack.pop();
    if (member === undefined) throw new Error(`Invalid component stack while visiting ${file}`);
    onStack.delete(member);
    component.push(member);
  } while (member !== file);

  const selfCycle = component.length === 1 && Boolean(graph.get(file)?.includes(file));
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

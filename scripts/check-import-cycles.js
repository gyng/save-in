// @ts-check

const fs = require("fs");
const path = require("path");
const {
  callsIdentifier,
  hasBrowserListenerRegistration,
  hasDynamicImport,
  hasGlobalNamespaceMutation,
} = require("./lib/architecture-checks.js");
const { walkFiles } = require("./lib/walk-files.js");

const root = path.resolve(__dirname, "..");
const srcRoot = path.join(root, "src");

const files = walkFiles(srcRoot, (name) => name.endsWith(".ts"));
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
    const specifier = match?.[1];
    if (!specifier) continue;
    const resolved = path.resolve(path.dirname(file), specifier);
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

forbidText(
  "config/rolldown.config.mjs",
  "self.window = self",
  "must not emulate Window in workers",
);
forbidText(
  "src/background/runtime.ts",
  'Symbol.for("save-in.backgroundRuntime")',
  "background runtime state must remain module-owned",
);
for (const name of [
  "src/options/core/options.ts",
  "src/options/core/tabs.ts",
  "types/platform.d.ts",
]) {
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
forbidText(
  "config/rolldown.config.mjs",
  "SAVE_IN_E2E",
  "must use the explicit build mode contract",
);
requireText(
  "config/rolldown.config.mjs",
  "SAVE_IN_CONTENT_E2E",
  "must retain explicit content-panel E2E gating",
);
requireText(
  "scripts/build-bundled.js",
  "Unexpected content panel shadow mode",
  "staging must verify content-panel shadow mode",
);
for (const name of ["test/e2e/chrome.e2e.mjs", "test/e2e/firefox.e2e.mjs"]) {
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
  "src/options/core/l10n.ts",
  "src/options/history/history-panel.ts",
  "src/options/core/option-search.ts",
  "src/options/core/options-reference.ts",
  "src/options/path-editor/path-editor.ts",
  "src/options/ui/permissions-banner.ts",
  "src/options/rule-editor/rule-builder.ts",
  "src/options/core/source-shortcut.ts",
  "src/options/core/options-bootstrap.ts",
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

// Options feature subdirectories are siblings, not a flat namespace: each may
// depend on core/, ui/, styles/ (CSS), and any cross-layer directory, but not
// reach into another feature directory's internals. A short, exact allowlist
// covers real infrastructure reuse that predates this rule — one editor
// feature building on another's engine or pure model, not a data-sharing
// shortcut (genuinely shared data/vocabulary was moved to core/ instead, see
// docs/CODE-ORGANIZATION.md Phase 3.1/3.3). Extend the allowlist only for the
// same kind of documented, load-bearing reuse; do not widen it to a whole
// directory pair.
const optionsFeatureDirs = [
  "dialogs",
  "history",
  "integrations",
  "path-editor",
  "reference",
  "route-debugger",
  "rule-editor",
  "syntax-editor",
];
const allowedCrossFeatureImports = new Map([
  // path-editor's text-mode textarea reuses the syntax editor's autocomplete
  // popover, validation, and pure model rather than duplicating them.
  [
    "src/options/path-editor/path-editor.ts",
    new Set([
      "src/options/syntax-editor/autocomplete.ts",
      "src/options/syntax-editor/editor-validation.ts",
      "src/options/syntax-editor/syntax-editor-model.ts",
    ]),
  ],
  // rule-editor's text-mode textarea reuses the same syntax-editor engine.
  [
    "src/options/rule-editor/rule-visual-editor.ts",
    new Set([
      "src/options/syntax-editor/autocomplete.ts",
      "src/options/syntax-editor/editor-validation.ts",
      "src/options/syntax-editor/syntax-editor-model.ts",
    ]),
  ],
  // The template-library rule builder inserts generated rule text through
  // PathEditor.insertText and highlights it via the syntax editor's renderer.
  [
    "src/options/rule-editor/rule-builder.ts",
    new Set([
      "src/options/path-editor/path-editor.ts",
      "src/options/syntax-editor/syntax-editor.ts",
    ]),
  ],
  // The variables-preview panel inserts a clicked variable into whichever
  // path-editor field currently has focus.
  [
    "src/options/reference/variables-preview.ts",
    new Set(["src/options/path-editor/path-editor.ts"]),
  ],
  // The route debugger reuses the rule visual editor's pure rule parser to
  // resolve which rule a simulated request would match.
  [
    "src/options/route-debugger/route-debugger-model.ts",
    new Set(["src/options/rule-editor/rule-visual-editor-model.ts"]),
  ],
  // The shared manual (text) editor dirty-state tracker diffs visual rows for
  // both grammar editors, so it reads each editor's pure model.
  [
    "src/options/syntax-editor/manual-editor-controller.ts",
    new Set([
      "src/options/path-editor/path-editor-model.ts",
      "src/options/rule-editor/rule-visual-editor-model.ts",
    ]),
  ],
]);
for (const [file, dependencies] of imports) {
  const fileRelative = relative(file);
  if (!fileRelative.startsWith("src/options/")) continue;
  const sourceFeature = optionsFeatureDirs.find((dir) =>
    fileRelative.startsWith(`src/options/${dir}/`),
  );
  if (!sourceFeature) continue;
  const allowed = allowedCrossFeatureImports.get(fileRelative);
  for (const dependency of dependencies) {
    const dependencyRelative = relative(dependency);
    const dependencyFeature = optionsFeatureDirs.find((dir) =>
      dependencyRelative.startsWith(`src/options/${dir}/`),
    );
    if (!dependencyFeature || dependencyFeature === sourceFeature) continue;
    if (allowed?.has(dependencyRelative)) continue;
    report(file, "options feature directories must not import each other's internals", dependency);
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
      ["src/background/", "src/downloads/", "src/platform/", "src/automation/"].some((boundary) =>
        relative(dependency).startsWith(boundary),
      )
    ) {
      report(file, "routing must depend only on shared contracts and injected ports", dependency);
    }
  }
}

// automation/ is the feature layer built on the generic routing engine, not
// the other way around: background/messaging/{handlers,auto-download}.ts and
// content/auto-download.ts consume it. It must not depend upward into
// background/ or downloads/ implementations (see docs/CODE-ORGANIZATION.md
// Phase 3.4 for why routing/automatic-rule.ts and
// background/messaging/auto-download.ts stayed put rather than moving here).
for (const [file, dependencies] of imports) {
  if (!relative(file).startsWith("src/automation/")) continue;
  for (const dependency of dependencies) {
    if (
      ["src/background/", "src/downloads/"].some((boundary) =>
        relative(dependency).startsWith(boundary),
      )
    ) {
      report(
        file,
        "automation must not import background or downloads implementations",
        dependency,
      );
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
  "src/background/messaging/index.ts",
  "src/background/e2e-command.ts",
  "src/content/content.ts",
  "src/downloads/filename-listener.ts",
  "src/downloads/notification.ts",
  "src/entries/offscreen.ts",
  "src/offscreen/offscreen.ts",
  "src/options/core/options.ts",
  "src/options/ui/permissions-banner.ts",
  "src/options/rule-editor/source-rule-draft.ts",
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
  ["configureDownloadPorts", new Set(["src/background/ports.ts"])],
  [
    "configureRoutingPorts",
    new Set([
      "src/background/ports.ts",
      "src/content/ports.ts",
      "src/options/core/options-runtime.ts",
    ]),
  ],
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

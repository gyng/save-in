// @ts-check

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const styles = fs
  .readdirSync(path.join(root, "src", "options"), { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".css"))
  .map((entry) => path.join(root, "src", "options", entry.name));

const violations = [];
const styleEntryPath = path.join(root, "src", "options", "style.css");
const tokenStylePath = path.join(root, "src", "options", "style-tokens.css");
const optionsDocumentPath = path.join(root, "src", "options", "options.html");
const clauseListDocumentPath = path.join(root, "src", "options", "clauselist.html");
const sourcePanelPath = path.join(root, "src", "content", "source-panel.ts");
const sourcePanelStylePath = path.join(root, "src", "content", "source-panel.css");

/**
 * @param {string} value
 * @returns {string[]}
 */
const splitTopLevelWhitespace = (value) => {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === undefined) continue;
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (/\s/.test(character) && depth === 0) {
      if (start < index) parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  if (start < value.length) parts.push(value.slice(start));
  return parts.filter(Boolean);
};

/** @type {Array<[string, string[]]>} */
const styleLayers = [
  ["tokens", ["style-tokens.css"]],
  ["base", ["style-base.css"]],
  [
    "shell",
    ["style-shell.css", "style-about.css", "style-shell-responsive.css", "style-dialogs.css"],
  ],
  [
    "components",
    [
      "style-components.css",
      "style-option-rows.css",
      "style-workflows.css",
      "style-status.css",
      "style-syntax-editor.css",
      "style-typeahead.css",
      "style-source-settings.css",
      "style-automation.css",
    ],
  ],
  ["layout", ["style-layout.css", "style-layout-responsive.css"]],
  [
    "editors",
    [
      "style-rule-editor.css",
      "style-rule-editor-create.css",
      "style-route-debugger.css",
      "style-route-debugger-tools.css",
      "style-route-debugger-responsive.css",
      "style-template-library.css",
      "style-option-tools.css",
      "style-editor-actions.css",
      "style-path-editor.css",
      "style-menu-preview.css",
      "style-editor-reference.css",
      "style-editor-responsive.css",
    ],
  ],
  [
    "advanced",
    ["style-advanced.css", "style-advanced-integrations.css", "style-advanced-responsive.css"],
  ],
  ["history", ["style-history.css", "style-history-responsive.css"]],
  ["welcome", []],
  ["reference", []],
  ["utilities", ["style-accessibility.css", "style-utilities.css"]],
];
const styleEntry = fs.readFileSync(styleEntryPath, "utf8");
const layerNames = styleLayers.map(([layer]) => layer);
const expectedStyleEntry = `${[
  `@layer ${layerNames.join(", ")};`,
  ...styleLayers.flatMap(([layer, files]) =>
    files.map((file) => `@import url("${file}") layer(${layer});`),
  ),
].join("\n")}\n`;
if (styleEntry !== expectedStyleEntry) {
  violations.push("src/options/style.css must preserve the declared ownership layer order");
}

/** @type {Array<[string, string, string]>} */
const pageStyleLayers = [
  ["style-welcome.css", "welcome-dialog.css", "welcome"],
  ["style-reference.css", "reference.css", "reference"],
];
for (const [entry, file, layer] of pageStyleLayers) {
  const source = fs.readFileSync(path.join(root, "src", "options", entry), "utf8");
  if (source !== `@import url("${file}") layer(${layer});\n`) {
    violations.push(`src/options/${entry} must import ${file} into the ${layer} layer`);
  }
}

/** @type {Array<[string, string[]]>} */
const expectedDocumentStyles = [
  [optionsDocumentPath, ["style.css", "style-welcome.css", "style-reference.css"]],
  [clauseListDocumentPath, ["style.css", "style-reference.css"]],
];
for (const [documentPath, expected] of expectedDocumentStyles) {
  const source = fs.readFileSync(documentPath, "utf8");
  const actual = [...source.matchAll(/<link href="([^"]+\.css)" rel="stylesheet" \/>/g)].map(
    (match) => match[1],
  );
  if (actual.join("\n") !== expected.join("\n")) {
    violations.push(
      `${path.relative(root, documentPath)} must load the declared layered stylesheet entries`,
    );
  }
}

const definitions = new Set();
const uses = new Map();
for (const file of styles) {
  const source = fs.readFileSync(file, "utf8");
  const relative = path.relative(root, file);
  if (path.basename(file).includes("-overrides")) {
    violations.push(`${relative} uses catch-all override ownership; import it with its feature`);
  }
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

const tokenStyle = fs.readFileSync(tokenStylePath, "utf8");
const rootTokenBoundary = tokenStyle.indexOf("\n}");
for (const file of styles) {
  const source = fs.readFileSync(file, "utf8");
  const relative = path.relative(root, file);
  for (const match of source.matchAll(/#[0-9a-f]{3,8}\b|rgba?\(/gi)) {
    if (file === tokenStylePath && match.index < rootTokenBoundary) continue;
    const line = source.slice(0, match.index).split("\n").length;
    violations.push(`${relative}:${line} uses a raw color outside the root token palette`);
  }
  const componentStart = file === tokenStylePath ? rootTokenBoundary + 2 : 0;
  const componentStyles = source.slice(componentStart);
  for (const match of componentStyles.matchAll(
    /var\(--(?:blue|grey|red|green|yellow|purple)[\w-]*/g,
  )) {
    const index = componentStart + match.index;
    const line = source.slice(0, index).split("\n").length;
    violations.push(`${relative}:${line} consumes a palette token directly`);
  }

  if (/biome-ignore-all\s+lint\/style\/noDescendingSpecificity/.test(source)) {
    violations.push(`${relative} suppresses the stylesheet-wide specificity contract`);
  }
  if (/(?:^|[}\s,])\.(?:hide|show)(?:[\s,{:.#]|$)/m.test(source)) {
    violations.push(`${relative} uses presentation-only hide/show classes; use hidden state`);
  }
  if (/@scope\b/.test(source)) {
    violations.push(`${relative} uses @scope before the declared Firefox minimum supports it`);
  }

  for (const match of source.matchAll(/-(?:moz|webkit)-user-select\s*:/g)) {
    const line = source.slice(0, match.index).split("\n").length;
    violations.push(`${relative}:${line} uses an obsolete prefixed user-select declaration`);
  }

  for (const match of source.matchAll(/\bclip\s*:\s*rect\(/g)) {
    const line = source.slice(0, match.index).split("\n").length;
    violations.push(`${relative}:${line} uses deprecated clip; use the visually-hidden utility`);
  }

  for (const match of source.matchAll(/word-break\s*:\s*break-all/g)) {
    const line = source.slice(0, match.index).split("\n").length;
    violations.push(`${relative}:${line} breaks words eagerly; use overflow-wrap: anywhere`);
  }

  const lineCount = source.split("\n").length - 1;
  if (lineCount > 550) {
    violations.push(
      `${relative} has ${lineCount} lines; split ownership files before they exceed 550`,
    );
  }

  const physicalDirection =
    /^\s*(?:(?:margin|padding|border)-(?:left|right)(?:-width)?|left|right)\s*:|^\s*text-align\s*:\s*(?:left|right)\b/gm;
  for (const match of source.matchAll(physicalDirection)) {
    const line = source.slice(0, match.index).split("\n").length;
    violations.push(`${relative}:${line} uses a physical direction; use a flow-relative property`);
  }

  for (const match of source.matchAll(/^\s*(margin|padding|border-radius)\s*:\s*([^;]+);/gm)) {
    const property = match[1] || "";
    const values = splitTopLevelWhitespace((match[2] || "").trim());
    if (values.length !== 4) continue;
    const hasPhysicalInlineDirection =
      property === "border-radius"
        ? values[0] !== values[1] || values[2] !== values[3]
        : values[1] !== values[3];
    if (!hasPhysicalInlineDirection) continue;
    const line = source.slice(0, match.index).split("\n").length;
    violations.push(
      `${relative}:${line} uses an inline-asymmetric ${property} shorthand; use logical longhands`,
    );
  }

  for (const match of source.matchAll(/\b\d+(?:\.\d+)?vh\b/g)) {
    const line = source.slice(0, match.index).split("\n").length;
    violations.push(`${relative}:${line} uses static viewport height; use a dynamic viewport unit`);
  }

  for (const match of source.matchAll(/\b\d+(?:\.\d+)?vw\b/g)) {
    const line = source.slice(0, match.index).split("\n").length;
    violations.push(
      `${relative}:${line} uses a physical static viewport width; use a dynamic logical viewport unit`,
    );
  }

  for (const match of source.matchAll(
    /box-shadow\s*:\s*inset\s+-?\d+(?:\.\d+)?(?:px|rem|em)\s+0(?:\s|;)/g,
  )) {
    const line = source.slice(0, match.index).split("\n").length;
    violations.push(
      `${relative}:${line} paints a physical inline-start inset shadow; use a logical border or marker`,
    );
  }

  for (const match of source.matchAll(/z-index\s*:\s*-?\d+/g)) {
    const line = source.slice(0, match.index).split("\n").length;
    violations.push(`${relative}:${line} uses a numeric z-index; use a semantic stacking token`);
  }

  if (
    file !== path.join(root, "src", "options", "style-base.css") &&
    /box-sizing\s*:/.test(source)
  ) {
    violations.push(`${relative} overrides the shared border-box sizing contract`);
  }

  for (const match of source.matchAll(/[^{}]+\{[^{}]*overflow(?:-y)?\s*:\s*auto;[^{}]*\}/g)) {
    if (file === path.join(root, "src", "options", "style-base.css") && match[0].includes("html")) {
      continue;
    }
    if (match[0].includes("overscroll-behavior:")) continue;
    const line = source.slice(0, match.index).split("\n").length;
    violations.push(`${relative}:${line} allows a nested scroll surface to chain to its parent`);
  }

  for (const match of source.matchAll(/[^{}]+\{[^{}]*overflow-x\s*:\s*auto;[^{}]*\}/g)) {
    if (match[0].includes("overscroll-behavior-inline:")) continue;
    const line = source.slice(0, match.index).split("\n").length;
    violations.push(
      `${relative}:${line} allows a horizontal scroll surface to chain to its parent`,
    );
  }
}

const baseStyle = fs.readFileSync(path.join(root, "src", "options", "style-base.css"), "utf8");
if (!/html\s*\{[^}]*box-sizing:\s*border-box;/.test(baseStyle)) {
  violations.push("src/options/style-base.css must establish the shared border-box model");
}

const shellStyle = fs.readFileSync(path.join(root, "src", "options", "style-shell.css"), "utf8");
if (!/body\s*\{[^}]*isolation:\s*isolate;/.test(shellStyle)) {
  violations.push("src/options/style-shell.css must isolate the application stacking context");
}
if (!baseStyle.includes("accent-color: var(--color-accent);")) {
  violations.push("src/options/style-base.css must apply the semantic accent to native controls");
}
if (/html\s*\{[^}]*min-height:\s*1%/.test(baseStyle)) {
  violations.push("src/options/style-base.css retains an obsolete embedded-options height hack");
}
if (!/html\s*\{[^}]*overflow-y:\s*auto;/.test(baseStyle)) {
  violations.push("src/options/style-base.css must pair its stable gutter with automatic overflow");
}

const accessibilityStyle = fs.readFileSync(
  path.join(root, "src", "options", "style-accessibility.css"),
  "utf8",
);
if (!accessibilityStyle.includes("@media (forced-colors: active)")) {
  violations.push("options focus and selected states need forced-colors fallbacks");
}
if (!accessibilityStyle.includes("@media (prefers-contrast: more)")) {
  violations.push("options controls need an increased-contrast preference fallback");
}
if (!accessibilityStyle.includes("@media (prefers-reduced-motion: reduce)")) {
  violations.push("options transitions need a shared reduced-motion preference fallback");
}

const componentStyle = fs.readFileSync(
  path.join(root, "src", "options", "style-components.css"),
  "utf8",
);
if (
  !componentStyle.includes(
    "@supports (interpolate-size: allow-keywords) and selector(details::details-content)",
  )
) {
  violations.push("intrinsic disclosure animation must test every progressive CSS feature it uses");
}

const routeDebuggerStyle = fs.readFileSync(
  path.join(root, "src", "options", "style-route-debugger.css"),
  "utf8",
);
if (/@media\s*\(max-width:/.test(routeDebuggerStyle)) {
  violations.push("route debugger responsiveness must follow its routing-workspace container");
}
if (routeDebuggerStyle.includes(".routing-tool")) {
  violations.push("route debugger tool-shell styles must stay in style-route-debugger-tools.css");
}
const routeDebuggerResponsiveStyle = fs.readFileSync(
  path.join(root, "src", "options", "style-route-debugger-responsive.css"),
  "utf8",
);
if (!routeDebuggerResponsiveStyle.includes("@container routing-workspace")) {
  violations.push("route debugger responsive rules must follow the routing-workspace container");
}

const layoutStyle = fs.readFileSync(path.join(root, "src", "options", "style-layout.css"), "utf8");
if (!/\.preview-column\s*\{[^}]*top:\s*var\(--sticky-header-offset\)/.test(layoutStyle)) {
  violations.push("sticky preview columns must use the shared sticky-header offset");
}

const utilityStyle = fs.readFileSync(
  path.join(root, "src", "options", "style-utilities.css"),
  "utf8",
);
if (!utilityStyle.includes(".visually-hidden") || !utilityStyle.includes("clip-path: inset(50%)")) {
  violations.push("visually hidden content must use the shared modern clipping utility");
}

const templateLibraryStyle = fs.readFileSync(
  path.join(root, "src", "options", "style-template-library.css"),
  "utf8",
);
if (
  !templateLibraryStyle.includes(".reference-dialog[open]") ||
  !templateLibraryStyle.includes("minmax(0, 1fr)")
) {
  violations.push("the reference dialog must size its scrolling body through an intrinsic grid");
}
if (/height:\s*calc\(100%\s*-\s*\d+px\)/.test(templateLibraryStyle)) {
  violations.push("the reference dialog must not subtract a fixed header height");
}

const ruleEditorStyle = fs.readFileSync(
  path.join(root, "src", "options", "style-rule-editor.css"),
  "utf8",
);
if (!ruleEditorStyle.includes("grid-template-columns: subgrid;")) {
  violations.push("routing clause rows must share the card column contract through subgrid");
}

const syntaxEditorStyle = fs.readFileSync(
  path.join(root, "src", "options", "style-syntax-editor.css"),
  "utf8",
);
if (syntaxEditorStyle.includes(".typeahead-")) {
  violations.push("shared typeahead styles must stay in style-typeahead.css");
}

const pathEditorStyle = fs.readFileSync(
  path.join(root, "src", "options", "style-path-editor.css"),
  "utf8",
);
if (/@container\s+path-editor/.test(pathEditorStyle)) {
  violations.push("path editor responsive rules must stay in style-editor-responsive.css");
}
if (!pathEditorStyle.includes(".path-editor-row:dir(rtl)")) {
  violations.push("path indentation guides must follow right-to-left direction");
}

const allowedBreakpoints = new Set([520, 640, 760]);
for (const file of styles) {
  const source = fs.readFileSync(file, "utf8");
  const relative = path.relative(root, file);
  for (const match of source.matchAll(/@(?:media|container)[^{]*\(max-width:\s*(\d+)px\)/g)) {
    const width = Number(match[1]);
    if (!allowedBreakpoints.has(width)) {
      const line = source.slice(0, match.index).split("\n").length;
      violations.push(`${relative}:${line} uses nonstandard ${width}px breakpoint`);
    }
  }
}

const obsoleteSelectors = [
  ".reference-launcher-tabs",
  ".reference-tabs",
  ".reference-nav",
  ".syntax-editor-inline-",
];
for (const selector of obsoleteSelectors) {
  for (const file of styles) {
    const source = fs.readFileSync(file, "utf8");
    if (source.includes(selector)) {
      violations.push(`${path.relative(root, file)} retains obsolete selector ${selector}`);
    }
  }
}

const sourcePanelStyle = fs.readFileSync(sourcePanelStylePath, "utf8");
for (const match of sourcePanelStyle.matchAll(
  /^\s*(margin|padding|border-radius)\s*:\s*([^;]+);/gm,
)) {
  const property = match[1] || "";
  const values = splitTopLevelWhitespace((match[2] || "").trim());
  if (values.length !== 4) continue;
  const hasPhysicalInlineDirection =
    property === "border-radius"
      ? values[0] !== values[1] || values[2] !== values[3]
      : values[1] !== values[3];
  if (!hasPhysicalInlineDirection) continue;
  const line = sourcePanelStyle.slice(0, match.index).split("\n").length;
  violations.push(
    `src/content/source-panel.css:${line} uses an inline-asymmetric ${property} shorthand; use logical longhands`,
  );
}
for (const match of sourcePanelStyle.matchAll(/word-break\s*:\s*break-all/g)) {
  const line = sourcePanelStyle.slice(0, match.index).split("\n").length;
  violations.push(
    `src/content/source-panel.css:${line} breaks words eagerly; use overflow-wrap: anywhere`,
  );
}
for (const match of sourcePanelStyle.matchAll(/\b\d+(?:\.\d+)?vh\b/g)) {
  const line = sourcePanelStyle.slice(0, match.index).split("\n").length;
  violations.push(`src/content/source-panel.css:${line} uses static viewport height`);
}
for (const match of sourcePanelStyle.matchAll(/\b\d+(?:\.\d+)?vw\b/g)) {
  const line = sourcePanelStyle.slice(0, match.index).split("\n").length;
  violations.push(`src/content/source-panel.css:${line} uses a physical static viewport width`);
}
for (const match of sourcePanelStyle.matchAll(/z-index\s*:\s*(\d+)/g)) {
  if (match[1] === "2147483647") continue;
  const line = sourcePanelStyle.slice(0, match.index).split("\n").length;
  violations.push(`src/content/source-panel.css:${line} uses a numeric local z-index`);
}
for (const contract of [
  "box-sizing: border-box;",
  "accent-color: var(--color-accent);",
  "overscroll-behavior: contain;",
  "scrollbar-gutter: stable;",
  "--source-panel-motion-transform: translateX(-8px);",
  "--source-panel-motion-transform: translateY(8px);",
  "--source-panel-motion-transform: translateY(-8px);",
  "--source-panel-floating-left: clamp(",
  "--source-panel-floating-top: clamp(",
  "100dvw",
  "@media (prefers-contrast: more)",
  "@media (forced-colors: active)",
]) {
  if (!sourcePanelStyle.includes(contract)) {
    violations.push(`src/content/source-panel.css is missing ${contract}`);
  }
}
for (const match of sourcePanelStyle.matchAll(/#[0-9a-f]{3,8}\b|rgba?\(/gi)) {
  const lineStart = sourcePanelStyle.lastIndexOf("\n", match.index) + 1;
  const lineEnd = sourcePanelStyle.indexOf("\n", match.index);
  const lineSource = sourcePanelStyle.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
  if (/--[\w-]+\s*:/.test(lineSource)) continue;
  const line = sourcePanelStyle.slice(0, match.index).split("\n").length;
  violations.push(`src/content/source-panel.css:${line} uses a raw component color`);
}
const sharedSemanticRoles = [
  "--compact-control-size",
  "--text-xs",
  "--text-base",
  "--text-lg",
  "--radius",
  "--control-height",
  "--color-text",
  "--color-text-muted",
  "--color-surface-page",
  "--color-surface-raised",
  "--color-border",
  "--color-control-border",
  "--color-accent",
  "--color-focus",
  "--color-on-accent",
  "--color-kind-other",
  "--color-kind-image",
  "--color-kind-video",
  "--color-kind-audio",
  "--color-kind-stream",
  "--color-kind-document",
];
for (const role of sharedSemanticRoles) {
  if (!tokenStyle.includes(`${role}:`)) {
    violations.push(`src/options/style-tokens.css is missing ${role}`);
  }
  if (!sourcePanelStyle.includes(`${role}:`)) {
    violations.push(`src/content/source-panel.css is missing shared role ${role}`);
  }
}

const sourcePanel = fs.readFileSync(sourcePanelPath, "utf8");
if (!sourcePanel.includes('import SOURCE_PANEL_CSS from "./source-panel.css";')) {
  violations.push("src/content/source-panel.ts must import the owned Page Sources stylesheet");
}
if (/style\.textContent\s*=\s*`/.test(sourcePanel)) {
  violations.push("src/content/source-panel.ts contains inline component CSS");
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
  for (const match of source.matchAll(/<dialog\b[\s\S]*?>/g)) {
    if (/class=["'][^"']*\bapp-dialog\b/.test(match[0])) continue;
    const line = source.slice(0, match.index).split("\n").length;
    violations.push(`${relative}:${line} uses a dialog outside the shared app-dialog shell`);
  }
}

for (const entry of optionEntries) {
  if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
  const file = path.join(root, "src", "options", entry.name);
  const relative = path.relative(root, file);
  const source = fs.readFileSync(file, "utf8");
  if (source.includes('createElement("dialog")') && !source.includes('"app-dialog ')) {
    violations.push(`${relative} creates a dialog outside the shared app-dialog shell`);
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
  process.stdout.write("CSS token, ownership, responsive, and typography checks passed.\n");
}

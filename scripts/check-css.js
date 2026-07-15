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
const themeStylePath = path.join(root, "src", "options", "style-themes.css");
const themePalettesStylePath = path.join(root, "src", "options", "style-theme-palettes.css");
const optionsDocumentPath = path.join(root, "src", "options", "options.html");
const clauseListDocumentPath = path.join(root, "src", "options", "clauselist.html");
const sourcePanelPath = path.join(root, "src", "content", "source-panel.ts");
const sourcePanelStylePaths = [
  "source-panel-tokens.css",
  "source-panel-themes.css",
  "source-panel.css",
  "source-panel-controls.css",
  "source-panel-results.css",
  "source-panel-responsive.css",
  "source-panel-preview.css",
].map((file) => path.join(root, "src", "content", file));

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

/**
 * @param {string} value
 * @returns {string[]}
 */
const splitTopLevelComma = (value) => {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
};

/**
 * @param {string} source
 * @returns {Map<string, string>}
 */
const customProperties = (source) =>
  new Map(
    [...source.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [
      match[1] || "",
      (match[2] || "").trim(),
    ]),
  );

/**
 * @param {string} source
 * @param {RegExp} selector
 * @returns {Map<string, Map<string, string>>}
 */
const themeBlocks = (source, selector) =>
  new Map(
    [...source.matchAll(selector)].map((match) => [
      match[1] || "",
      customProperties(match[2] || ""),
    ]),
  );

/** @param {string} value @returns {[number, number, number] | undefined} */
const rgbFromHex = (value) => {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (!match?.[1]) return undefined;
  const hex =
    match[1].length === 3 ? [...match[1]].map((part) => `${part}${part}`).join("") : match[1];
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
};

/** @param {string} value @returns {number | undefined} */
const relativeLuminance = (value) => {
  const rgb = rgbFromHex(value);
  if (!rgb) return undefined;
  /** @param {number} channel */
  const linearChannel = (channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  const red = linearChannel(rgb[0]);
  const green = linearChannel(rgb[1]);
  const blue = linearChannel(rgb[2]);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

/** @param {string} foreground @param {string} background @returns {number | undefined} */
const contrastRatio = (foreground, background) => {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  if (foregroundLuminance === undefined || backgroundLuminance === undefined) return undefined;
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
};

/**
 * Resolve a base token to its concrete light or dark color. Base theme
 * contrast contracts intentionally accept only direct variables, hex colors,
 * and light-dark() so unsupported expressions cannot silently skip checks.
 * @param {string} value
 * @param {Map<string, string>} properties
 * @param {"light" | "dark"} scheme
 * @param {Set<string>} [resolving]
 * @returns {string | undefined}
 */
const colorForScheme = (value, properties, scheme, resolving = new Set()) => {
  const normalized = value.trim();
  const variable = /^var\((--[\w-]+)\)$/.exec(normalized)?.[1];
  if (variable) {
    if (resolving.has(variable)) return undefined;
    const replacement = properties.get(variable);
    if (replacement === undefined) return undefined;
    return colorForScheme(replacement, properties, scheme, new Set([...resolving, variable]));
  }

  const lightDark = /^light-dark\(([\s\S]*)\)$/.exec(normalized)?.[1];
  if (lightDark !== undefined) {
    const choices = splitTopLevelComma(lightDark);
    if (choices.length !== 2) return undefined;
    return colorForScheme(choices[scheme === "light" ? 0 : 1] || "", properties, scheme, resolving);
  }

  return rgbFromHex(normalized) ? normalized : undefined;
};

/**
 * @param {string} value
 * @param {Map<string, string>} properties
 * @param {Set<string>} [resolving]
 * @returns {string}
 */
const resolvedCustomPropertyValue = (value, properties, resolving = new Set()) =>
  value
    .replace(/var\((--[\w-]+)\)/g, (_match, token) => {
      if (resolving.has(token)) return `var(${token})`;
      const replacement = properties.get(token);
      if (replacement === undefined) return `var(${token})`;
      return resolvedCustomPropertyValue(replacement, properties, new Set([...resolving, token]));
    })
    .replace(/\s+/g, " ")
    .replace(/\s*([(),])\s*/g, "$1")
    .trim();

/** @type {Array<[string, string[]]>} */
const styleLayers = [
  ["tokens", ["style-tokens.css", "style-themes.css", "style-theme-palettes.css"]],
  ["base", ["style-base.css"]],
  [
    "shell",
    ["style-shell.css", "style-about.css", "style-shell-responsive.css", "style-dialogs.css"],
  ],
  [
    "components",
    [
      "style-components.css",
      "style-feedback.css",
      "style-option-rows.css",
      "style-workflows.css",
      "style-status.css",
      "style-syntax-editor.css",
      "style-syntax-popovers.css",
      "style-typeahead.css",
      "style-source-settings.css",
      "style-automation.css",
    ],
  ],
  ["layout", ["style-layout.css", "style-variables-preview.css", "style-layout-responsive.css"]],
  [
    "editors",
    [
      "style-rule-editor.css",
      "style-rule-editor-clauses.css",
      "style-rule-editor-create.css",
      "style-route-debugger.css",
      "style-route-debugger-trace.css",
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
  ["history", ["style-history.css", "style-history-metadata.css", "style-history-responsive.css"]],
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

const bundledBuildSource = fs.readFileSync(path.join(root, "scripts", "build-bundled.js"), "utf8");
for (const file of styleLayers.flatMap(([, files]) => files)) {
  if (!bundledBuildSource.includes(`"${file}"`)) {
    violations.push(`scripts/build-bundled.js must stage imported stylesheet ${file}`);
  }
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
      allowed: /^(?:var\(--text-(?:xs|sm|base|lg|xl|2xl)\)|inherit)$/,
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

  for (const match of source.matchAll(/\banimation\s*:\s*([^;]+);/g)) {
    const value = (match[1] || "").trim();
    if (value === "none" || !/(?:^|\s)(?:\d+(?:\.\d+)?|\.\d+)(?:ms|s)(?:\s|$)/.test(value))
      continue;
    const line = source.slice(0, match.index).split("\n").length;
    violations.push(
      `${relative}:${line} uses a literal animation duration; use a reduced-motion duration token`,
    );
  }
}

const tokenStyle = fs.readFileSync(tokenStylePath, "utf8");
const themeStyle = fs.readFileSync(themeStylePath, "utf8");
const themePaletteStyle = fs.readFileSync(themePalettesStylePath, "utf8");
const optionTokenDeclarationPaths = new Set([
  tokenStylePath,
  themeStylePath,
  themePalettesStylePath,
]);
const rootTokenBoundary = tokenStyle.indexOf("\n}");
for (const file of styles) {
  const source = fs.readFileSync(file, "utf8");
  const relative = path.relative(root, file);
  for (const match of source.matchAll(/#[0-9a-f]{3,8}\b|rgba?\(/gi)) {
    if (optionTokenDeclarationPaths.has(file)) {
      const declarationStart = Math.max(
        source.lastIndexOf(";", match.index),
        source.lastIndexOf("{", match.index),
        source.lastIndexOf("}", match.index),
      );
      const declarationSource = source
        .slice(declarationStart + 1, match.index)
        .replace(/\/\*[\s\S]*?\*\//g, "");
      if (/^\s*--[\w-]+\s*:/.test(declarationSource)) continue;
    }
    const line = source.slice(0, match.index).split("\n").length;
    violations.push(`${relative}:${line} uses a raw color outside a token declaration`);
  }
  const componentStart =
    file === tokenStylePath
      ? rootTokenBoundary + 2
      : file === themeStylePath || file === themePalettesStylePath
        ? source.length
        : 0;
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
  const lineLimit = 400;
  if (lineCount > lineLimit) {
    violations.push(
      `${relative} has ${lineCount} lines; split ownership files before they exceed ${lineLimit}`,
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
if (!/\.app-dialog\s*\{[^}]*container:\s*app-dialog\s*\/\s*inline-size;/.test(shellStyle)) {
  violations.push("shared dialogs must expose their inline size as the app-dialog container");
}
const optionToolStyle = fs.readFileSync(
  path.join(root, "src", "options", "style-option-tools.css"),
  "utf8",
);
if (/button:disabled/.test(optionToolStyle)) {
  violations.push("global disabled-button styling must stay in the base control primitive");
}
if (!/button:disabled\s*\{[^}]*cursor:\s*default;[^}]*opacity:\s*0\.55;/.test(baseStyle)) {
  violations.push("the base control primitive must own the disabled-button appearance");
}
if (!/a\.external::after\s*\{[^}]*background-color:\s*currentColor;[^}]*mask:/.test(baseStyle)) {
  violations.push(
    "external-link icons must inherit the link or forced-system color through a mask",
  );
}

const accessibilityStyle = fs.readFileSync(
  path.join(root, "src", "options", "style-accessibility.css"),
  "utf8",
);
const sharedComponentStyle = fs.readFileSync(
  path.join(root, "src", "options", "style-components.css"),
  "utf8",
);
const feedbackStyle = fs.readFileSync(
  path.join(root, "src", "options", "style-feedback.css"),
  "utf8",
);
for (const selector of [".error-notification", ".error-row", ".feedback", ".click-to-copy"]) {
  if (!feedbackStyle.includes(selector)) {
    violations.push(`src/options/style-feedback.css must own ${selector}`);
  }
  if (sharedComponentStyle.includes(selector)) {
    violations.push(`src/options/style-components.css must not retain feedback owner ${selector}`);
  }
}
if (!feedbackStyle.includes(".error-row:dir(rtl)::after")) {
  violations.push("validation jump affordances must reverse in RTL documents");
}
if (
  !baseStyle.includes(":where(p, .help-text, .section-lead, .privacy-content) a") ||
  !baseStyle.includes("text-underline-offset: 0.12em")
) {
  violations.push("links in prose and help content must remain visibly identifiable");
}
const optionsLayoutStyle = fs.readFileSync(
  path.join(root, "src", "options", "style-layout.css"),
  "utf8",
);
if (
  !optionsLayoutStyle.includes(":where(#options) {") ||
  sharedComponentStyle.includes("#options {")
) {
  violations.push("src/options/style-layout.css must own the options form layout");
}
for (const filePath of styles) {
  const file = path.basename(filePath);
  const source = fs.readFileSync(filePath, "utf8");
  if (/^\s*(?:min-|max-)?(?:width|height)\s*:/m.test(source)) {
    violations.push(`src/options/${file} must use logical sizing properties`);
  }
}
if (!accessibilityStyle.includes('[aria-pressed="true"]')) {
  violations.push("pressed controls need a forced-colors selected state");
}
if (
  !accessibilityStyle.includes("@media (pointer: coarse)") ||
  !accessibilityStyle.includes("--compact-control-size: 44px")
) {
  violations.push("coarse pointers need enlarged shared control targets");
}
if (
  !shellStyle.includes("@media (hover: hover)") ||
  !shellStyle.includes(".save-status:focus-within .saved-change-popover")
) {
  violations.push("hover-opened saved feedback must retain touch-safe keyboard access");
}

const motionPreferenceSource = fs.readFileSync(
  path.join(root, "src", "shared", "motion-preference.ts"),
  "utf8",
);
if (
  !motionPreferenceSource.includes("(prefers-reduced-motion: reduce)") ||
  !motionPreferenceSource.includes('"auto" : "smooth"')
) {
  violations.push("scripted scrolling must share the reduced-motion preference");
}
for (const file of ["welcome-dialog.ts", "rule-visual-editor.ts", "tabs.ts"]) {
  const source = fs.readFileSync(path.join(root, "src", "options", file), "utf8");
  if (
    !source.includes('from "../shared/motion-preference.ts"') ||
    !source.includes("preferredScrollBehavior()") ||
    /behavior:\s*["']smooth["']/.test(source)
  ) {
    violations.push(`src/options/${file} must honor reduced motion for scripted scrolling`);
  }
}
const sourcePanelSource = fs.readFileSync(
  path.join(root, "src", "content", "source-panel.ts"),
  "utf8",
);
if (
  !sourcePanelSource.includes('from "../shared/motion-preference.ts"') ||
  /behavior:\s*["']smooth["']/.test(sourcePanelSource)
) {
  violations.push("the Page Sources panel must honor reduced motion for scripted scrolling");
}

if (!accessibilityStyle.includes("@media (forced-colors: active)")) {
  violations.push("options focus and selected states need forced-colors fallbacks");
}
if (!accessibilityStyle.includes("@media (prefers-contrast: more)")) {
  violations.push("options controls need an increased-contrast preference fallback");
}
if (!accessibilityStyle.includes("@media (prefers-reduced-motion: reduce)")) {
  violations.push("options transitions need a shared reduced-motion preference fallback");
}
const optionTokenProperties = customProperties(tokenStyle);
for (const token of optionTokenProperties.keys()) {
  if (!token.startsWith("--motion-duration-")) continue;
  if (!accessibilityStyle.includes(`${token}: 0ms;`)) {
    violations.push(`${token} must become 0ms for the reduced-motion preference`);
  }
}
for (const selectedState of [
  ".menu-preview-row.is-preview-selected",
  ".path-editor-row.is-preview-selected",
  ".rule-editor-card.is-debug-selected",
  ".route-debugger-rule.is-selected",
]) {
  if (!accessibilityStyle.includes(selectedState)) {
    violations.push(`forced-colors selection coverage is missing ${selectedState}`);
  }
}

for (const contract of [
  ".menu-popover",
  "max-inline-size: calc(100dvi",
  "max-block-size: min(20rem, calc(100dvb",
  "overscroll-behavior: contain",
]) {
  if (!sharedComponentStyle.includes(contract)) {
    violations.push(`shared menu popovers are missing ${contract}`);
  }
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
if (routeDebuggerStyle.includes(".route-debugger-rule-list")) {
  violations.push("route debugger trace styles must stay in style-route-debugger-trace.css");
}
const routeDebuggerTraceStyle = fs.readFileSync(
  path.join(root, "src", "options", "style-route-debugger-trace.css"),
  "utf8",
);
if (!routeDebuggerTraceStyle.includes(".route-debugger-rule-list")) {
  violations.push("route debugger trace styles must own the evaluated rule list");
}
const routeDebuggerResponsiveStyle = fs.readFileSync(
  path.join(root, "src", "options", "style-route-debugger-responsive.css"),
  "utf8",
);
if (!routeDebuggerResponsiveStyle.includes("@container routing-workspace")) {
  violations.push("route debugger responsive rules must follow the routing-workspace container");
}

const layoutStyle = fs.readFileSync(path.join(root, "src", "options", "style-layout.css"), "utf8");
const mainTablistStyle = /\.tablist\s*\{([^}]*)\}/.exec(layoutStyle)?.[1] ?? "";
const tablistStyles = styles.flatMap((file) => [
  ...fs.readFileSync(file, "utf8").matchAll(/^\s*\.tablist\s*\{([^}]*)\}/gm),
]);
if (!/flex-wrap:\s*wrap;/.test(mainTablistStyle)) {
  violations.push("the main tab strip must wrap without becoming a scroll container");
}
if (
  tablistStyles.some((match) => /overflow(?:-[xy])?\s*:\s*(?:auto|scroll)/.test(match[1] ?? ""))
) {
  violations.push("the main tab strip must never enable scrollbar overflow");
}
if (tablistStyles.some((match) => /flex-wrap:\s*nowrap/.test(match[1] ?? ""))) {
  violations.push("the main tab strip must never disable wrapping");
}
if (
  tablistStyles.some((match) => /(?:overscroll-behavior|scrollbar-width)\s*:/.test(match[1] ?? ""))
) {
  violations.push("the main tab strip must not carry scroll-container styling");
}
if (!/\.preview-column\s*\{[^}]*top:\s*var\(--sticky-header-offset\)/.test(layoutStyle)) {
  violations.push("sticky preview columns must use the shared sticky-header offset");
}
if (layoutStyle.includes(".variables-preview-list")) {
  violations.push("variables preview styles must stay in style-variables-preview.css");
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
if (ruleEditorStyle.includes(".rule-clause-row")) {
  violations.push("routing clause styles must stay in style-rule-editor-clauses.css");
}
const ruleEditorClauseStyle = fs.readFileSync(
  path.join(root, "src", "options", "style-rule-editor-clauses.css"),
  "utf8",
);
if (!ruleEditorClauseStyle.includes("grid-template-columns: subgrid;")) {
  violations.push("routing clause rows must share the card column contract through subgrid");
}

const advancedStyle = fs.readFileSync(
  path.join(root, "src", "options", "style-advanced.css"),
  "utf8",
);
if (advancedStyle.includes(".webhook-section")) {
  violations.push("external integration styles must stay in style-advanced-integrations.css");
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
  ".rule-builder-row",
  ".rule-editor-help",
  ".language-switching",
];
for (const selector of obsoleteSelectors) {
  for (const file of styles) {
    const source = fs.readFileSync(file, "utf8");
    if (source.includes(selector)) {
      violations.push(`${path.relative(root, file)} retains obsolete selector ${selector}`);
    }
  }
}

/** @type {Array<[string, string]>} */
const responsiveContainerContracts = [
  ["welcome-dialog.css", "@container app-dialog (max-width: 640px)"],
  ["style-about.css", "@container app-dialog (max-width: 640px)"],
  ["reference.css", "@container reference-content (max-width: 640px)"],
  ["style-template-library.css", "container: reference-content / inline-size"],
];
for (const [file, contract] of responsiveContainerContracts) {
  const source = fs.readFileSync(path.join(root, "src", "options", file), "utf8");
  if (!source.includes(contract)) {
    violations.push(`src/options/${file} is missing responsive container contract ${contract}`);
  }
}

const sourcePanelStyles = sourcePanelStylePaths.map((file) => fs.readFileSync(file, "utf8"));
const sourcePanelStyle = sourcePanelStyles.join("\n");
const sourcePanelTokenProperties = customProperties(sourcePanelStyles[0] || "");
for (const role of [
  "--compact-control-size",
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
]) {
  const optionValue = optionTokenProperties.get(role);
  const sourceValue = sourcePanelTokenProperties.get(role);
  if (optionValue === undefined || sourceValue === undefined) continue;
  const resolvedOptionValue = resolvedCustomPropertyValue(optionValue, optionTokenProperties);
  const resolvedSourceValue = resolvedCustomPropertyValue(sourceValue, sourcePanelTokenProperties);
  if (resolvedOptionValue !== resolvedSourceValue) {
    violations.push(
      `source-panel theme role ${role} drifted (${resolvedSourceValue}) from options (${resolvedOptionValue})`,
    );
  }
}
sourcePanelStyles.forEach((source, index) => {
  const relative = path.relative(root, sourcePanelStylePaths[index] || "");
  const lineCount = source.split("\n").length - 1;
  if (lineCount > 400) {
    violations.push(
      `${relative}: has ${lineCount} lines; split ownership files before they exceed 400`,
    );
  }
  if (/^\s*(?:min-|max-)?(?:width|height)\s*:/m.test(source)) {
    violations.push(`${relative} must use logical sizing properties`);
  }
});
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
  "touch-action: none;",
  "overscroll-behavior: contain;",
  "scrollbar-gutter: stable;",
  ".source-link:focus-visible",
  "--source-panel-motion-transform: translateX(-8px);",
  "--source-panel-motion-transform: translateY(8px);",
  "--source-panel-motion-transform: translateY(-8px);",
  "--source-panel-floating-left: clamp(",
  "--source-panel-floating-top: clamp(",
  "container: source-panel / inline-size",
  "@container source-panel (max-width: 320px)",
  "100dvw",
  "@media (prefers-contrast: more)",
  "@media (forced-colors: active)",
]) {
  if (!sourcePanelStyle.includes(contract)) {
    violations.push(`src/content/source-panel.css is missing ${contract}`);
  }
}
sourcePanelStyles.forEach((source, index) => {
  for (const match of source.matchAll(/#[0-9a-f]{3,8}\b|rgba?\(/gi)) {
    const lineStart = source.lastIndexOf("\n", match.index) + 1;
    const lineEnd = source.indexOf("\n", match.index);
    const lineSource = source.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
    if (index <= 1 && /--[\w-]+\s*:/.test(lineSource)) continue;
    const line = source.slice(0, match.index).split("\n").length;
    violations.push(
      `${path.relative(root, sourcePanelStylePaths[index] || "")}:${line} uses a raw component color`,
    );
  }
  for (const match of source.matchAll(/\banimation\s*:\s*([^;]+);/g)) {
    const value = (match[1] || "").trim();
    if (value === "none" || !/(?:^|\s)(?:\d+(?:\.\d+)?|\.\d+)(?:ms|s)(?:\s|$)/.test(value))
      continue;
    const line = source.slice(0, match.index).split("\n").length;
    violations.push(
      `${path.relative(root, sourcePanelStylePaths[index] || "")}:${line} uses a literal animation duration`,
    );
  }
});
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

const sourcePanelThemeStyle = fs.readFileSync(
  path.join(root, "src", "content", "source-panel-themes.css"),
  "utf8",
);
const optionThemes = themeBlocks(
  `${themeStyle}\n${themePaletteStyle}`,
  /:root\[data-theme="([^"]+)"\]\s*\{([^}]*)\}/g,
);
const sourcePanelThemes = themeBlocks(
  sourcePanelThemeStyle,
  /:host\(\[data-theme="([^"]+)"\]\)\s*\{([^}]*)\}/g,
);
const customOptionThemeNames = [...optionThemes]
  .filter(([name]) => name !== "light" && name !== "dark")
  .map(([name]) => name)
  .toSorted();
const sourcePanelThemeNames = [...sourcePanelThemes.keys()].toSorted();
if (customOptionThemeNames.join("\n") !== sourcePanelThemeNames.join("\n")) {
  violations.push("Options and Page Sources must expose the same custom theme names");
}

const sharedThemeRoles = [
  "--theme-color-scheme",
  "--theme-page",
  "--theme-raised",
  "--theme-text",
  "--theme-muted",
  "--theme-border",
  "--theme-control-border",
  "--theme-accent",
  "--theme-focus",
  "--theme-link",
  "--theme-on-accent",
];
const optionThemeRoles = [
  ...sharedThemeRoles,
  "--theme-input",
  "--theme-accent-active",
  "--theme-icon-filter",
];
/** @type {Array<[string, Map<string, Map<string, string>>, string[], string[]]>} */
const themeSchemas = [
  ["Options", optionThemes, customOptionThemeNames, optionThemeRoles],
  ["Page Sources", sourcePanelThemes, sourcePanelThemeNames, sharedThemeRoles],
];
for (const [surface, themes, names, requiredRoles] of themeSchemas) {
  const allowedRoles = new Set(requiredRoles);
  for (const theme of names) {
    const properties = themes.get(theme);
    if (!properties) continue;
    for (const role of requiredRoles) {
      if (!properties.has(role)) {
        violations.push(`${surface} theme ${theme} is missing required role ${role}`);
      }
    }
    for (const role of properties.keys()) {
      if (!allowedRoles.has(role)) {
        violations.push(`${surface} theme ${theme} declares unknown role ${role}`);
      }
    }
  }
}

const optionThemeSelector = /:root:is\(([\s\S]*?)\)\s*\{/.exec(themeStyle)?.[1] || "";
const sourcePanelThemeSelector =
  /:host\(\s*:is\(([\s\S]*?)\)\s*\)\s*\{/.exec(sourcePanelThemeStyle)?.[1] || "";
/** @param {string} selector @returns {string[]} */
const mappedThemeNames = (selector) =>
  [...selector.matchAll(/\[data-theme="([^"]+)"\]/g)]
    .map((match) => match[1] || "")
    .filter(Boolean)
    .toSorted();
/** @type {Array<[string, string[], string[]]>} */
const themeSelectorMappings = [
  ["Options", customOptionThemeNames, mappedThemeNames(optionThemeSelector)],
  ["Page Sources", sourcePanelThemeNames, mappedThemeNames(sourcePanelThemeSelector)],
];
for (const [surface, expected, actual] of themeSelectorMappings) {
  if (expected.join("\n") !== actual.join("\n")) {
    violations.push(`${surface} theme selector mapping must exactly cover its declared themes`);
  }
}

for (const theme of customOptionThemeNames) {
  const optionProperties = optionThemes.get(theme);
  const sourcePanelProperties = sourcePanelThemes.get(theme);
  if (!optionProperties || !sourcePanelProperties) continue;
  for (const role of sharedThemeRoles) {
    if (optionProperties.get(role) !== sourcePanelProperties.get(role)) {
      violations.push(`${theme} must use the same ${role} in Options and Page Sources`);
    }
  }
}

const themeContrastContracts = [
  ["--theme-text", "--theme-page", 4.5],
  ["--theme-muted", "--theme-page", 4.5],
  ["--theme-link", "--theme-page", 4.5],
  ["--theme-focus", "--theme-page", 3],
  ["--theme-control-border", "--theme-page", 3],
  ["--theme-on-accent", "--theme-accent", 4.5],
];
for (const theme of customOptionThemeNames) {
  const properties = optionThemes.get(theme);
  if (!properties) continue;
  for (const [foregroundRole, backgroundRole, minimum] of themeContrastContracts) {
    const foreground = properties.get(String(foregroundRole));
    const background = properties.get(String(backgroundRole));
    const ratio = foreground && background ? contrastRatio(foreground, background) : undefined;
    if (ratio === undefined || ratio + Number.EPSILON < Number(minimum)) {
      violations.push(
        `${theme} ${foregroundRole} on ${backgroundRole} must have at least ${minimum}:1 contrast`,
      );
    }
  }
}

const defaultThemeContrastContracts = [
  ["--color-text", "--color-surface-page", 4.5],
  ["--color-text-muted", "--color-surface-page", 4.5],
  ["--color-focus", "--color-surface-page", 3],
  ["--color-control-border", "--color-surface-page", 3],
  ["--color-on-accent", "--color-accent", 4.5],
];
/** @type {Array<[string, Map<string, string>, string]>} */
const defaultThemeSurfaces = [
  ["Options", optionTokenProperties, "--link-color"],
  ["Page Sources", sourcePanelTokenProperties, "--color-link"],
];
/** @type {Array<"light" | "dark">} */
const defaultColorSchemes = ["light", "dark"];
for (const [surface, properties, linkRole] of defaultThemeSurfaces) {
  for (const scheme of defaultColorSchemes) {
    for (const [foregroundRole, backgroundRole, minimum] of [
      ...defaultThemeContrastContracts,
      [linkRole, "--color-surface-page", 4.5],
    ]) {
      const foregroundValue = properties.get(String(foregroundRole));
      const backgroundValue = properties.get(String(backgroundRole));
      const foreground = foregroundValue
        ? colorForScheme(foregroundValue, properties, scheme)
        : undefined;
      const background = backgroundValue
        ? colorForScheme(backgroundValue, properties, scheme)
        : undefined;
      const ratio = foreground && background ? contrastRatio(foreground, background) : undefined;
      if (ratio === undefined || ratio + Number.EPSILON < Number(minimum)) {
        violations.push(
          `${surface} default ${scheme} ${foregroundRole} on ${backgroundRole} must have at least ${minimum}:1 contrast`,
        );
      }
    }
  }
}

const sourcePanel = fs.readFileSync(sourcePanelPath, "utf8");
for (const file of [
  "source-panel-tokens.css",
  "source-panel-themes.css",
  "source-panel.css",
  "source-panel-controls.css",
  "source-panel-results.css",
  "source-panel-responsive.css",
  "source-panel-preview.css",
]) {
  if (!sourcePanel.includes(`from "./${file}";`)) {
    violations.push(`src/content/source-panel.ts must import owned stylesheet ${file}`);
  }
}
const sourcePanelResponsiveStyle = fs.readFileSync(
  path.join(root, "src", "content", "source-panel-responsive.css"),
  "utf8",
);
/** @type {Array<[string, string]>} */
const sourcePanelLogicalMenuAnchors = [
  ["source-panel-controls.css", ".dock-menu"],
  ["source-panel-results.css", ".action-menu"],
];
for (const [file, selector] of sourcePanelLogicalMenuAnchors) {
  const source = fs.readFileSync(path.join(root, "src", "content", file), "utf8");
  const block = new RegExp(
    `${selector.replace(".", "\\.")}\\s*\\{[^}]*inset-block-start:\\s*calc\\(100% \\+ 4px\\);[^}]*inset-inline-end:\\s*0;`,
  );
  if (!block.test(source)) {
    violations.push(`${file} must anchor ${selector} to logical block-start and inline-end edges`);
  }
}
if (
  !sourcePanelResponsiveStyle.includes("@media (pointer: coarse)") ||
  !sourcePanelResponsiveStyle.includes("--compact-control-size: 44px") ||
  !sourcePanelResponsiveStyle.includes(":host(.floating) .resize")
) {
  violations.push("Page Sources coarse pointers need enlarged controls and resize targets");
}
if (/style\.textContent\s*=\s*`/.test(sourcePanel)) {
  violations.push("src/content/source-panel.ts contains inline component CSS");
}
if (
  !sourcePanel.includes(
    "SOURCE_PANEL_CONTROLS_CSS,\n    SOURCE_PANEL_RESULTS_CSS,\n    SOURCE_PANEL_RESPONSIVE_CSS,\n    SOURCE_PANEL_PREVIEW_CSS",
  )
) {
  violations.push("Page Sources responsive CSS must follow the result styles it adapts");
}
if (
  !sourcePanel.includes('from "../shared/floating-position.ts"') ||
  !sourcePanel.includes("positionPanelMenus") ||
  !sourcePanel.includes("positionFloatingElement(")
) {
  violations.push("source-panel menus must use shared collision-aware floating positioning");
}

for (const file of ["autocomplete.ts", "typeahead.ts", "syntax-editor.ts"]) {
  const source = fs.readFileSync(path.join(root, "src", "options", file), "utf8");
  if (
    !source.includes('from "./floating-position.ts"') ||
    !source.includes("positionFloatingElement(")
  ) {
    violations.push(`src/options/${file} must use the shared collision-aware floating positioner`);
  }
}

const floatingPositionSource = fs.readFileSync(
  path.join(root, "src", "shared", "floating-position.ts"),
  "utf8",
);
if (!floatingPositionSource.includes('element.style.position = "fixed"')) {
  violations.push("shared floating surfaces must escape clipping ancestors with fixed positioning");
}
const floatingSurfacesSource = fs.readFileSync(
  path.join(root, "src", "options", "details-menu-positioning.ts"),
  "utf8",
);
for (const contract of [
  "details.details-popup[open]",
  ":scope > .menu-popover",
  ".variables-preview-list",
  "positionFloatingElement(",
]) {
  if (!floatingSurfacesSource.includes(contract)) {
    violations.push(`shared floating-surface positioning is missing ${contract}`);
  }
}
const optionsPageSource = fs.readFileSync(path.join(root, "src", "options", "options.ts"), "utf8");
if (
  !optionsPageSource.includes('from "./details-menu-positioning.ts"') ||
  !optionsPageSource.includes("setupDetailsMenuPositioning,")
) {
  violations.push("the options page must initialize shared details-menu positioning");
}
if (!/:not\(:has\(> \.menu-popover\)\)::details-content/.test(sharedComponentStyle)) {
  violations.push("menu disclosures must stay outside intrinsic-size clipping animations");
}
const anchoredSurfaceSource = fs.readFileSync(
  path.join(root, "src", "options", "anchored-floating-surface.ts"),
  "utf8",
);
if (
  !anchoredSurfaceSource.includes("positionFloatingElement(") ||
  !anchoredSurfaceSource.includes("window.visualViewport")
) {
  violations.push("non-menu floating surfaces must use shared viewport-aware positioning");
}
for (const file of ["option-search.ts", "saved-indicator.ts"]) {
  const source = fs.readFileSync(path.join(root, "src", "options", file), "utf8");
  if (!source.includes('from "./anchored-floating-surface.ts"')) {
    violations.push(`src/options/${file} must use shared anchored floating positioning`);
  }
}

/** @type {Array<[string, string]>} */
const floatingMenuOwners = [
  ["options.html", "nav-resources-menu menu-popover"],
  ["options.html", "rule-add-menu-options menu-popover"],
  ["options.html", "history-columns-menu menu-popover"],
  ["options.html", "history-export-options menu-popover"],
  ["path-editor.ts", "path-editor-action-menu menu-popover"],
  ["rule-visual-editor.ts", "rule-editor-card-action-menu menu-popover"],
];
for (const [file, className] of floatingMenuOwners) {
  const source = fs.readFileSync(path.join(root, "src", "options", file), "utf8");
  if (!source.includes(className)) {
    violations.push(
      `src/options/${file} must apply the shared menu-popover surface to ${className}`,
    );
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

const sourcePanelDefinitions = new Set(
  [...sourcePanelStyle.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1] || ""),
);
const sourcePanelCssDefinitions = new Set(sourcePanelDefinitions);
/** @type {Map<string, string[]>} */
const sourcePanelUses = new Map();
sourcePanelStyles.forEach((source, index) => {
  const relative = path.relative(root, sourcePanelStylePaths[index] || "");
  for (const match of source.matchAll(/var\((--[\w-]+)/g)) {
    const token = match[1] || "";
    const locations = sourcePanelUses.get(token) || [];
    locations.push(relative);
    sourcePanelUses.set(token, locations);
  }
});
for (const match of sourcePanel.matchAll(/host\.style\.setProperty\("(--[\w-]+)"/g)) {
  sourcePanelDefinitions.add(match[1] || "");
}
for (const token of [...sourcePanelCssDefinitions].toSorted()) {
  if (!sourcePanelUses.has(token)) {
    violations.push(`Page Sources token ${token} is defined but never consumed`);
  }
}
for (const [token, files] of [...sourcePanelUses].toSorted(([left], [right]) =>
  left.localeCompare(right),
)) {
  if (!sourcePanelDefinitions.has(token)) {
    violations.push(
      `Page Sources token ${token} used by ${[...new Set(files)].join(", ")} is not defined`,
    );
  }
}

// Visual path rows receive their nesting depth from the editor at runtime.
definitions.add("--row-depth");

const unused = [...definitions]
  .filter((token) => !uses.has(token) && !sourcePanelStyle.includes(`var(${token})`))
  .toSorted()
  .map((token) => `${token} is defined but never consumed`);
violations.push(...unused);

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

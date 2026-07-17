// @ts-check

// Finds declarations that lose for no reason a reader can see: same layer, same
// specificity, different files, so the only thing deciding them is which file
// style.css imported first.
//
// That is not automatically wrong. Within a layer the imports run generic to
// specific on purpose — style-shell.css before dialogs/style-about.css,
// core/style-advanced.css before integrations/* — so a specific rule beating
// the generic one it composes is the order working, and those are listed below.
// The bug is the inversion: a base that loads after something extending it wins
// against its own consumer, and the stylesheet still reads as though it lost.
// .visual-editor-control did exactly that from inside the path editor's folder,
// between the two editors, and Routing rules' More button spent that whole time
// rendering padded, small, dimmed, and with a hover border that could not paint.
//
// Nothing here spots a misplaced base on its own; a person still has to read a
// new entry and say which way round it is. What this buys is that the reading
// happens at all, once, instead of never.

const fs = require("node:fs");
const path = require("node:path");
const { walkFiles } = require("./lib/walk-files.js");

const root = path.resolve(__dirname, "..");
const optionsRoot = path.join(root, "src", "options");

/**
 * Reviewed: each is a specific rule overriding the generic one it composes, in
 * that order in the markup and in style.css. Adding an entry means deciding
 * which rule is the base — if the base is the winner, move the base, do not
 * record it here.
 *
 * @type {ReadonlyArray<{key: string, why: string}>}
 */
const REVIEWED_ORDER_OVERRIDES = [
  {
    key: "about-close dialog-close|font-size|styles/style-shell.css .about-close|dialogs/style-about.css .about-close",
    why: "the close-button base sizes three dialogs; About asks for a larger one in its own file",
  },
  {
    key: "about-close dialog-close|font-size|styles/style-shell.css .dialog-close|dialogs/style-about.css .about-close",
    why: "same base rule reached through its other selector",
  },
  {
    key: "about-close dialog-close privacy-close|font-size|styles/style-shell.css .about-close|dialogs/style-about.css .about-close",
    why: "the Privacy dialog carries the same close button as About",
  },
  {
    key: "about-close dialog-close privacy-close|font-size|styles/style-shell.css .dialog-close|dialogs/style-about.css .about-close",
    why: "same base rule reached through its other selector",
  },
  {
    key: "advanced-integration-section external-integrations-content|gap|core/style-advanced.css .advanced-integration-section|integrations/style-advanced-integrations.css .external-integrations-content",
    why: "the external-integrations content opens up the shared section's gap",
  },
  {
    key: "counter-control dev-api|max-inline-size|core/style-advanced.css .counter-control|integrations/style-advanced-integrations.css .dev-api",
    why: "the dev-api box is wider than the counter control it is built from",
  },
  {
    key: "dev-api-row prompt-assistant-status-row|padding|integrations/style-advanced-integrations.css .dev-api-row|integrations/style-prompt-assistant.css .prompt-assistant-status-row",
    why: "the prompt assistant's status row drops the dev-api row's vertical padding",
  },
];

/** @param {string} source */
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Conditional rules are dropped rather than compared: an override that applies
 * at one viewport is a deliberate act, and reading it as a conflict with the
 * unconditional rule invents a disagreement that never renders.
 *
 * @param {string} source
 */
const stripAtRuleBlocks = (source) => {
  let out = "";
  let index = 0;
  while (index < source.length) {
    const brace = source.indexOf("{", index);
    if (
      source[index] === "@" &&
      brace !== -1 &&
      /^@(media|container|supports)\b/.test(source.slice(index, brace))
    ) {
      let depth = 0;
      let end = brace;
      for (; end < source.length; end += 1) {
        if (source[end] === "{") depth += 1;
        else if (source[end] === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      index = end + 1;
      continue;
    }
    out += source[index];
    index += 1;
  }
  return out;
};

/**
 * @param {string} source
 * @returns {Array<{selector: string, declarations: Map<string, string>}>}
 */
const parseRules = (source) => {
  /** @type {Array<{selector: string, declarations: Map<string, string>}>} */
  const rules = [];
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (match[1] || "").trim();
    if (!selector || selector.startsWith("@")) continue;
    /** @type {Map<string, string>} */
    const declarations = new Map();
    for (const declaration of (match[2] || "").split(";")) {
      const colon = declaration.indexOf(":");
      if (colon < 0) continue;
      const property = declaration.slice(0, colon).trim();
      const value = declaration.slice(colon + 1).trim();
      if (property && value && !property.startsWith("--")) declarations.set(property, value);
    }
    if (declarations.size) rules.push({ selector, declarations });
  }
  return rules;
};

/**
 * Only class/pseudo-class compounds. Anything with a combinator, attribute, id,
 * or element already carries specificity the cascade settles on its own merits.
 *
 * @param {string} selector
 * @returns {{classes: string[], pseudos: string[]} | null}
 */
const parseCompound = (selector) => {
  if (/[ >+~[\]#]|::/.test(selector) || !selector.startsWith(".")) return null;
  const classes = [...selector.matchAll(/\.([\w-]+)/g)].map((match) => match[1] || "");
  const pseudos = [...selector.matchAll(/:(?!:)([a-z-]+(?:\([^)]*\))?)/g)].map(
    (match) => match[1] || "",
  );
  const rebuilt =
    classes.map((name) => `.${name}`).join("") + pseudos.map((name) => `:${name}`).join("");
  return rebuilt === selector ? { classes, pseudos } : null;
};

/**
 * @param {string} markupRoot
 * @returns {Set<string>}
 */
const elementClassSets = (markupRoot) => {
  /** @type {Set<string>} */
  const sets = new Set();
  const files = walkFiles(markupRoot, (name) => name.endsWith(".ts") || name.endsWith(".html"));
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/(?:className\s*=\s*|class=)"([a-z0-9 _-]+)"/g)) {
      const classes = (match[1] || "").trim().split(/\s+/).filter(Boolean);
      if (classes.length > 1) sets.add(classes.toSorted().join(" "));
    }
    for (const match of source.matchAll(/classList\.add\(([^)]*)\)/g)) {
      const classes = [...(match[1] || "").matchAll(/"([\w-]+)"/g)].map((entry) => entry[1] || "");
      if (classes.length > 1) sets.add(classes.toSorted().join(" "));
    }
  }
  return sets;
};

/** The options page: layers declared in style.css, filled in import order. */
const optionsSheets = () => {
  const entry = fs.readFileSync(path.join(optionsRoot, "style.css"), "utf8");
  const layerNames = (entry.match(/@layer ([^;]+);/)?.[1] || "")
    .split(",")
    .map((name) => name.trim());
  /** @type {Array<{file: string, layer: string}>} */
  const imports = [...entry.matchAll(/@import url\("([^"]+)"\) layer\((\w+)\);/g)].map((match) => ({
    file: match[1] || "",
    layer: match[2] || "",
  }));
  // options.html links these two separately; they fill the layers style.css declares.
  imports.push({ file: "dialogs/welcome-dialog.css", layer: "welcome" });
  imports.push({ file: "reference/reference.css", layer: "reference" });
  return { layerNames, imports, styleRoot: optionsRoot, markupRoot: optionsRoot };
};

/**
 * The drawer: no layers at all. source-panel.ts imports these as strings and
 * joins them into one shadow-root stylesheet, so concatenation order is the
 * only thing settling a tie — the options page at least has layers above it.
 * The order below is that join, and check-css.js pins the same list.
 */
const panelSheets = () => ({
  layerNames: ["panel"],
  imports: [
    "source-panel-tokens.css",
    "source-panel-themes.css",
    "source-panel.css",
    "source-panel-controls.css",
    "source-panel-results.css",
    "source-panel-responsive.css",
    "source-panel-preview.css",
  ].map((file) => ({ file, layer: "panel" })),
  styleRoot: path.join(root, "src", "content"),
  markupRoot: path.join(root, "src", "content"),
});

/**
 * @param {{layerNames: string[], imports: Array<{file: string, layer: string}>, styleRoot: string, markupRoot: string}} sheets
 * @returns {Map<string, string>}
 */
const silentOrderOverrides = ({ layerNames, imports, styleRoot, markupRoot }) => {
  /** @type {Array<{file: string, layerIndex: number, importIndex: number, ruleIndex: number, selector: string, classes: string[], pseudos: string[], specificity: number, declarations: Map<string, string>}>} */
  const rules = [];
  imports.forEach(({ file, layer }, importIndex) => {
    const stylePath = path.join(styleRoot, file);
    if (!fs.existsSync(stylePath)) return;
    const source = stripAtRuleBlocks(stripComments(fs.readFileSync(stylePath, "utf8")));
    parseRules(source).forEach(({ selector, declarations }, ruleIndex) => {
      for (const part of selector.split(",").map((piece) => piece.trim())) {
        const compound = parseCompound(part);
        if (!compound) continue;
        rules.push({
          file,
          layerIndex: layerNames.indexOf(layer),
          importIndex,
          ruleIndex,
          selector: part,
          classes: compound.classes,
          pseudos: compound.pseudos,
          specificity: compound.classes.length + compound.pseudos.length,
          declarations,
        });
      }
    });
  });

  /** @type {Map<string, string>} */
  const found = new Map();
  for (const key of elementClassSets(markupRoot)) {
    const element = new Set(key.split(" "));
    const applicable = rules.filter((rule) => rule.classes.every((name) => element.has(name)));
    /** @type {Map<string, typeof applicable>} */
    const states = new Map();
    for (const rule of applicable) {
      const state = rule.pseudos.toSorted().join("&");
      const bucket = states.get(state);
      if (bucket) bucket.push(rule);
      else states.set(state, [rule]);
    }
    for (const group of states.values()) {
      const properties = new Set(group.flatMap((rule) => [...rule.declarations.keys()]));
      for (const property of properties) {
        const declaring = group.filter((rule) => rule.declarations.has(property));
        if (declaring.length < 2) continue;
        const strongest = Math.max(...declaring.map((rule) => rule.specificity));
        const contenders = declaring
          .filter((rule) => rule.specificity === strongest)
          .toSorted(
            (a, b) =>
              a.layerIndex - b.layerIndex ||
              a.importIndex - b.importIndex ||
              a.ruleIndex - b.ruleIndex,
          );
        const winner = contenders[contenders.length - 1];
        if (!winner) continue;
        for (const loser of contenders.slice(0, -1)) {
          if (loser.file === winner.file) continue;
          if (loser.layerIndex !== winner.layerIndex) continue;
          if (loser.declarations.get(property) === winner.declarations.get(property)) continue;
          found.set(
            `${key}|${property}|${loser.file} ${loser.selector}|${winner.file} ${winner.selector}`,
            `${loser.file} ${loser.selector} { ${property}: ${loser.declarations.get(property)} } ` +
              `never applies; ${winner.file} ${winner.selector} { ${property}: ${winner.declarations.get(property)} } ` +
              "wins on import order alone",
          );
        }
      }
    }
  }

  return found;
};

const main = () => {
  /** @type {Map<string, string>} */
  const found = new Map();
  for (const sheets of [optionsSheets(), panelSheets()]) {
    for (const [key, message] of silentOrderOverrides(sheets)) found.set(key, message);
  }

  const reviewed = new Set(REVIEWED_ORDER_OVERRIDES.map((override) => override.key));
  /** @type {string[]} */
  const violations = [];
  for (const [key, message] of found) {
    if (!reviewed.has(key)) violations.push(`CSS cascade: ${message}`);
  }
  for (const { key, why } of REVIEWED_ORDER_OVERRIDES) {
    if (!found.has(key)) {
      violations.push(
        `CSS cascade: a reviewed order-dependent override no longer exists (${why}); ` +
          `remove it from REVIEWED_ORDER_OVERRIDES in scripts/check-css-cascade.js: ${key}`,
      );
    }
  }

  if (violations.length) {
    console.error(violations.join("\n"));
    console.error(
      "\nSame layer, same specificity, different files: only the import order decides these. " +
        "If the winner is the base the loser extends, move the base so it imports first. " +
        "If the winner is genuinely the more specific rule, record it with a rationale.",
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `CSS cascade holds: ${found.size} reviewed order-dependent overrides, no unreviewed ones.`,
  );
};

if (require.main === module) {
  main();
}

module.exports = { parseCompound, stripAtRuleBlocks };

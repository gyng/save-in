// @ts-check

// Lightweight lexical fitness checks. This is deliberately independent of the
// TypeScript compiler so repository scripts continue to use Node built-ins only.

/** @param {string} source */
const listenerAliases = (source) => {
  const aliases = new Set();
  for (const match of source.matchAll(
    /\b(?:const|let|var)\s*\{[^}]*\baddListener\s*(?::\s*([A-Za-z_$][\w$]*))?[^}]*\}/g,
  )) {
    aliases.add(match[1] || "addListener");
  }
  for (const match of source.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*\.addListener\b/g,
  )) {
    aliases.add(match[1]);
  }
  return aliases;
};

/** @param {string} source */
const hasBrowserListenerRegistration = (source) => {
  if (/\.(?:\s*\?\.)?\s*addListener\s*\(/.test(source)) return true;
  return [...listenerAliases(source)].some((alias) =>
    new RegExp(`\\b${alias.replace(/[$]/g, "\\$")}\\s*\\(`).test(source),
  );
};

/** @param {string} source */
const hasDynamicImport = (source) => /\bimport\s*\(/.test(source);

/** @param {string} source */
const hasGlobalNamespaceMutation = (source) =>
  /\bObject\.(?:assign|defineProperty)\s*\(\s*(?:globalThis|window|self)\b/.test(source) ||
  /\bReflect\.set\s*\(\s*(?:globalThis|window|self)\b/.test(source) ||
  /\b(?:globalThis|window|self)\s*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])\s*=(?!=)/.test(source);

/** @param {string} source @param {string} identifier */
const callsIdentifier = (source, identifier) =>
  new RegExp(`\\b${identifier.replace(/[$]/g, "\\$")}\\s*\\(`).test(source);

// A "/" starts a regex literal only where a value cannot already have ended.
// Without this, a quote inside a regex (/["']/) would open a phantom string and
// swallow the rest of the file.
const REGEX_ALLOWED_AFTER =
  /(?:^|[(,=:[!&|?{};+\-*%~^<>\n]|\b(?:return|case|in|of|typeof|instanceof|new|delete|void|do|else|yield|await))\s*$/;

/** @param {string} source @param {number} start index of the opening quote */
const endOfQuoted = (source, start) => {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === "\\") i += 2;
    else if (source[i] === quote) return i + 1;
    else i++;
  }
  return i;
};

/** @param {string} source @param {number} start index of the opening slash */
const endOfRegex = (source, start) => {
  let i = start + 1;
  let inClass = false;
  while (i < source.length) {
    const c = source[i];
    if (c === "\\") i += 2;
    else if (c === "[") ((inClass = true), i++);
    else if (c === "]") ((inClass = false), i++);
    else if (c === "/" && !inClass) return i + 1;
    else if (c === "\n") return i;
    else i++;
  }
  return i;
};

/**
 * Blanks out comments and literal string text so a lexical scan sees only code.
 * Template substitutions are kept — `${document.title}` is real DOM usage — so
 * this walks the source rather than running a regex over it.
 * @param {string} source
 */
const stripCommentsAndStrings = (source) => {
  let out = "";
  let i = 0;
  let braceDepth = 0;
  let inTemplateText = false;
  /** @type {number[]} brace depth outside each open ${...} substitution */
  const templates = [];

  while (i < source.length) {
    if (inTemplateText) {
      const c = source[i];
      if (c === "\\") i += 2;
      else if (c === "`") ((inTemplateText = false), i++);
      else if (c === "$" && source[i + 1] === "{") {
        templates.push(braceDepth);
        braceDepth++;
        inTemplateText = false;
        out += " ";
        i += 2;
      } else i++;
      continue;
    }

    const pair = source.slice(i, i + 2);
    if (pair === "//") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (pair === "/*") {
      i += 2;
      while (i < source.length && source.slice(i, i + 2) !== "*/") i++;
      i += 2;
      out += " ";
      continue;
    }

    const c = source[i];
    if (c === '"' || c === "'") {
      i = endOfQuoted(source, i);
      out += ' "" ';
    } else if (c === "`") {
      inTemplateText = true;
      i++;
      out += ' "" ';
    } else if (c === "/" && REGEX_ALLOWED_AFTER.test(out)) {
      i = endOfRegex(source, i);
      out += " 0 ";
    } else if (c === "{") {
      braceDepth++;
      out += c;
      i++;
    } else if (c === "}") {
      braceDepth--;
      if (templates.length > 0 && braceDepth === templates[templates.length - 1]) {
        templates.pop();
        inTemplateText = true;
        out += " ";
      } else out += c;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
};

// Reaching the page from a module that claims to be pure. Bare `Node`, `Event`,
// and `Element` are deliberately absent: a pure model may legitimately name its
// own AST node or domain event type.
const DOM_GLOBALS = String.raw`document|window|navigator|localStorage|sessionStorage`;
const DOM_REFERENCE = new RegExp(
  String.raw`(?<![.\w$])(?:${DOM_GLOBALS}|HTML[A-Za-z]*Element|SVG[A-Za-z]*Element|ShadowRoot|NodeList|HTMLCollection|DOMParser|DOMRect)(?![\w$])` +
    String.raw`|\bglobalThis\s*\.\s*(?:${DOM_GLOBALS})\b`,
  "g",
);

/**
 * The DOM references a module makes, ignoring comments and string literals.
 * @param {string} source
 * @returns {string[]} each distinct reference found, in source order
 */
const domReferences = (source) => [
  ...new Set(stripCommentsAndStrings(source).match(DOM_REFERENCE) ?? []),
];

module.exports = {
  callsIdentifier,
  domReferences,
  hasBrowserListenerRegistration,
  hasDynamicImport,
  hasGlobalNamespaceMutation,
  stripCommentsAndStrings,
};

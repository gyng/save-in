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

module.exports = {
  callsIdentifier,
  hasBrowserListenerRegistration,
  hasDynamicImport,
  hasGlobalNamespaceMutation,
};

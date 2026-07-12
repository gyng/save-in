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

module.exports = { hasBrowserListenerRegistration };

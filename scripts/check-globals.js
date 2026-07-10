// Every cross-file global that is TYPED in types/globals.d.ts must also be in
// .oxlintrc.json "globals", or oxlint's no-undef flags its uses. (The reverse
// is fine: a global declared with `const`/`function` in a non-module source
// file — e.g. renderMenuPreview in options.js — is ambient to tsc already, so
// it's oxlint-only by design.) AGENTS.md lists editing both as a manual step;
// this catches the "typed but not lint-known" drift. Part of `npm run lint`.

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

const oxlint = new Set(
  Object.keys(JSON.parse(fs.readFileSync(path.join(root, ".oxlintrc.json"), "utf8")).globals || {}),
);

// Environment/platform globals typed for tsc only — not app cross-file globals,
// so they intentionally live in globals.d.ts but not in the oxlint list.
const ENV_ONLY = new Set(["importScripts"]);

const dts = fs.readFileSync(path.join(root, "types", "globals.d.ts"), "utf8");
const declared = new Set(
  [...dts.matchAll(/^declare (?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm)]
    .map((m) => m[1])
    .filter((n) => !ENV_ONLY.has(n)),
);

const typedButNotLintKnown = [...declared].filter((n) => !oxlint.has(n)).sort();

if (typedButNotLintKnown.length === 0) {
  console.log(`check-globals: OK (${declared.size} typed globals all lint-known)`);
  process.exit(0);
}

console.error("check-globals: globals typed in types/globals.d.ts are missing from");
console.error(".oxlintrc.json \"globals\" (oxlint no-undef will flag their uses):\n");
console.error(`    ${typedButNotLintKnown.join(", ")}`);
process.exit(1);

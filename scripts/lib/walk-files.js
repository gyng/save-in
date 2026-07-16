// @ts-check

// Shared recursive directory walker for the check-*.js scripts. Keeping one
// implementation means a future filter or traversal change (e.g. skipping a
// new generated directory) lands once instead of being copied across scripts.

const fs = require("node:fs");
const path = require("node:path");

/**
 * Recursively collect file paths under `dir`, depth-first in the order
 * `fs.readdirSync` returns entries (directories are descended into in place,
 * not sorted or deferred).
 *
 * @param {string} dir
 * @param {(name: string, fullPath: string) => boolean} [filter] Called once
 *   per file (not directory) entry with its basename and full path; return
 *   true to include it. Defaults to including every file.
 * @returns {string[]}
 */
const walkFiles = (dir, filter = () => true) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkFiles(full, filter);
    return entry.isFile() && filter(entry.name, full) ? [full] : [];
  });

module.exports = { walkFiles };

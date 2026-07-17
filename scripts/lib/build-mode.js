// @ts-check

const BUILD_MODES = new Set(["production", "e2e"]);

/** @param {string[]} args */
const parseBuildMode = (args) => {
  if (args.length > 1 || (args[0] !== undefined && !args[0].startsWith("--mode="))) {
    throw new Error("Expected at most one --mode=production|e2e argument");
  }
  const mode = args[0]?.slice("--mode=".length) ?? "production";
  if (!BUILD_MODES.has(mode)) throw new Error(`Unsupported build mode: ${mode}`);
  return mode;
};

module.exports = { parseBuildMode };

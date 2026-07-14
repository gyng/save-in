// @ts-check

const path = require("path");
const { pathToFileURL } = require("url");

const { parseBuildMode } = require("./lib/build-mode");

const root = path.join(__dirname, "..");
const buildMode = parseBuildMode(process.argv.slice(2));

async function main() {
  process.env.SAVE_IN_BUILD_MODE = buildMode;
  const [{ build }, configModule] = await Promise.all([
    import("rolldown"),
    import(pathToFileURL(path.join(root, "config", "rolldown.config.mjs")).href),
  ]);
  const configs = Array.isArray(configModule.default)
    ? configModule.default
    : [configModule.default];

  // Rolldown's array build API currently starts every target concurrently.
  // These targets share an output directory, so write them one at a time.
  for (const config of configs) await build(config);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

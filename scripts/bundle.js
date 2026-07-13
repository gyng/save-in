const { execFileSync } = require("child_process");
const path = require("path");

const { parseBuildMode } = require("./lib/build-mode");

const root = path.join(__dirname, "..");
const buildMode = parseBuildMode(process.argv.slice(2));
execFileSync(
  process.execPath,
  [path.join(root, "node_modules", "rolldown", "bin", "cli.mjs"), "-c", "rolldown.config.mjs"],
  {
    cwd: root,
    env: { ...process.env, SAVE_IN_BUILD_MODE: buildMode },
    stdio: "inherit",
  },
);

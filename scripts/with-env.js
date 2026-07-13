const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

/**
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} [parentEnv]
 */
function prepareCommand(argv, parentEnv = process.env) {
  const env = { ...parentEnv };
  let index = 0;

  while (index < argv.length && argv[index] !== "--") {
    if (argv[index] === "-u") {
      const name = argv[index + 1];
      if (!name) throw new Error("-u requires an environment variable name");
      delete env[name];
      index += 2;
      continue;
    }

    const separator = argv[index].indexOf("=");
    if (separator < 1) break;
    env[argv[index].slice(0, separator)] = argv[index].slice(separator + 1);
    index += 1;
  }

  if (argv[index] === "--") index += 1;
  const command = argv[index];
  if (!command) throw new Error("Missing command");

  return { command, args: argv.slice(index + 1), env };
}

/** @param {string} command @param {string} [cwd] */
function resolveLocalBin(command, cwd = process.cwd()) {
  const packageJson = path.join(cwd, "node_modules", command, "package.json");
  if (!fs.existsSync(packageJson)) return null;

  const manifest = JSON.parse(fs.readFileSync(packageJson, "utf8"));
  const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[command];
  return bin ? path.resolve(path.dirname(packageJson), bin) : null;
}

function main() {
  const { command, args, env } = prepareCommand(process.argv.slice(2));
  const localBin = resolveLocalBin(command);
  const result = spawnSync(
    localBin ? process.execPath : command,
    localBin ? [localBin, ...args] : args,
    {
      env,
      stdio: "inherit",
    },
  );

  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (require.main === module) main();

module.exports = { prepareCommand, resolveLocalBin };

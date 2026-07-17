// @ts-check

// Builds the bundled package, lets web-ext run/watch that package, and
// rebuilds it when its source inputs change.

const { execFileSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const { resolveLocalBin } = require("./with-env");

const root = path.join(__dirname, "..");
const build = () =>
  execFileSync(process.execPath, [path.join(__dirname, "build-bundled.js")], {
    cwd: root,
    stdio: "inherit",
  });

build();

const env = { ...process.env };
delete env.WEB_EXT_API_KEY;
delete env.WEB_EXT_API_SECRET;
const webExt = resolveLocalBin("web-ext", root);
if (!webExt) throw new Error("web-ext is not installed; run npm install");
const child = spawn(
  process.execPath,
  [
    webExt,
    "run",
    "--source-dir",
    "dist/bundled-pkg",
    "--verbose",
    "--start-url",
    "about:debugging",
    "--start-url",
    "about:addons",
  ],
  { cwd: root, env, stdio: "inherit" },
);

/** @type {ReturnType<typeof setTimeout> | undefined} */
let timer;
const rebuild = () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      build();
    } catch (error) {
      console.error(
        `Bundle rebuild failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, 300);
};

for (const dir of ["src", "icons", "_locales"]) {
  fs.watch(path.join(root, dir), { recursive: true }, rebuild);
}
for (const file of ["manifest.json", "config/rolldown.config.mjs"]) {
  fs.watch(path.join(root, file), rebuild);
}

const stop = () => child.kill();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exit(code ?? 1);
});

const { execFileSync, spawn } = require("child_process");
const path = require("path");

const root = path.join(__dirname, "..");
const vitest = path.join(root, "node_modules", "vitest", "vitest.mjs");
const config = "vitest.e2e.config.mjs";

execFileSync(process.execPath, [path.join(__dirname, "build-bundled.js")], {
  cwd: root,
  stdio: "inherit",
});

const suites = ["e2e/chrome.e2e.mjs", "e2e/firefox.e2e.mjs"];
const children = suites.map((suite) =>
  spawn(process.execPath, [vitest, "run", "--config", config, suite], {
    cwd: root,
    env: { ...process.env, EXT_DIR: "dist/bundled-pkg" },
    stdio: "inherit",
  }),
);

const stop = () => children.forEach((child) => child.kill());
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

Promise.all(
  children.map(
    (child) =>
      new Promise((resolve) => {
        child.once("error", () => resolve(1));
        child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
      }),
  ),
).then((codes) => {
  process.exitCode = codes.some((code) => code !== 0) ? 1 : 0;
});

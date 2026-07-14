// @ts-check

const { execFileSync } = require("node:child_process");
const { once } = require("node:events");

/** @param {import("node:child_process").ChildProcess | null | undefined} child */
const isRunning = (child) =>
  Boolean(child?.pid && child.exitCode === null && child.signalCode === null);

/**
 * @param {import("node:child_process").ChildProcess} child
 * @param {NodeJS.Signals} signal
 * @param {boolean} detached
 */
const signalTree = (child, signal, detached) => {
  if (!child.pid || !isRunning(child)) return;
  if (process.platform === "win32") {
    const args = ["/pid", String(child.pid), "/T"];
    if (signal === "SIGKILL") args.push("/F");
    try {
      execFileSync("taskkill", args, { stdio: "ignore" });
    } catch {
      if (signal === "SIGKILL") child.kill();
    }
    return;
  }
  try {
    process.kill(detached ? -child.pid : child.pid, signal);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") return;
    throw error;
  }
};

/**
 * Terminates the complete browser/suite process group and escalates when a
 * child ignores the graceful signal.
 *
 * @param {import("node:child_process").ChildProcess | null | undefined} child
 * @param {{detached?: boolean, graceMs?: number}} [options]
 */
const terminateProcessTree = async (child, { detached = false, graceMs = 5000 } = {}) => {
  if (!child || !isRunning(child)) return;
  const exited = once(child, "exit");
  signalTree(child, "SIGTERM", detached);
  const graceful = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), graceMs);
      timer.unref();
    }),
  ]);
  if (graceful || !isRunning(child)) return;
  signalTree(child, "SIGKILL", detached);
  await Promise.race([
    exited,
    new Promise((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Process tree ${child.pid} did not exit after SIGKILL`)),
        graceMs,
      );
      timer.unref();
    }),
  ]);
};

module.exports = { isRunning, terminateProcessTree };

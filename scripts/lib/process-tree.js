// @ts-check

const { execFileSync } = require("node:child_process");
const { once } = require("node:events");

/** @typedef {{pid: number, parentPid: number, rssKb: number}} ProcessMemoryRow */

/**
 * @param {string} output
 * @returns {ProcessMemoryRow[]}
 */
const parseProcessMemoryRows = (output) =>
  output.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line);
    if (!match) return [];
    const [, pidText, parentPidText, rssKbText] = match;
    if (pidText === undefined || parentPidText === undefined || rssKbText === undefined) return [];
    return [
      {
        pid: Number(pidText),
        parentPid: Number(parentPidText),
        rssKb: Number(rssKbText),
      },
    ];
  });

/** @returns {ProcessMemoryRow[]} */
const readProcessMemoryRows = () => {
  if (process.platform === "win32") {
    const script =
      "Get-CimInstance Win32_Process | ForEach-Object { " +
      "'{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, " +
      "[math]::Ceiling($_.WorkingSetSize / 1KB) }";
    return parseProcessMemoryRows(
      execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
        encoding: "utf8",
      }),
    );
  }
  return parseProcessMemoryRows(
    execFileSync("ps", ["-e", "-o", "pid=,ppid=,rss="], { encoding: "utf8" }),
  );
};

/**
 * @param {ProcessMemoryRow[]} rows
 * @param {number} rootPid
 */
const sumProcessTreeRssKb = (rows, rootPid) => {
  if (!rows.some(({ pid }) => pid === rootPid)) {
    throw new Error(`Process ${rootPid} is absent from the RSS snapshot`);
  }
  const tree = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const { pid, parentPid } of rows) {
      if (!tree.has(pid) && tree.has(parentPid)) {
        tree.add(pid);
        changed = true;
      }
    }
  }
  return rows.reduce((total, row) => total + (tree.has(row.pid) ? row.rssKb : 0), 0);
};

/** @param {number} rootPid */
const processTreeRssKb = (rootPid) => sumProcessTreeRssKb(readProcessMemoryRows(), rootPid);

/** @param {number[]} samplesKb */
const summarizeRssKb = (samplesKb) => {
  if (
    samplesKb.length === 0 ||
    samplesKb.some((sample) => !Number.isSafeInteger(sample) || sample < 0)
  ) {
    throw new Error("RSS samples must be non-empty, non-negative integer KiB values");
  }
  const baselineRssKb = samplesKb[0];
  const finalRssKb = samplesKb.at(-1);
  if (baselineRssKb === undefined || finalRssKb === undefined) {
    throw new Error("RSS samples are empty");
  }
  const peakRssKb = Math.max(...samplesKb);
  return {
    baselineRssKb,
    peakRssKb,
    finalRssKb,
    peakGrowthKb: peakRssKb - baselineRssKb,
    retainedGrowthKb: finalRssKb - baselineRssKb,
    samplesKb,
  };
};

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

/** @param {Promise<unknown>} exited @param {number} timeoutMs */
const waitForExit = (exited, timeoutMs) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    timer.unref();
    exited.then(
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

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
  const graceful = await waitForExit(exited, graceMs);
  if (graceful || !isRunning(child)) return;
  signalTree(child, "SIGKILL", detached);
  if (!(await waitForExit(exited, graceMs))) {
    throw new Error(`Process tree ${child.pid} did not exit after SIGKILL`);
  }
};

module.exports = {
  isRunning,
  parseProcessMemoryRows,
  processTreeRssKb,
  sumProcessTreeRssKb,
  summarizeRssKb,
  terminateProcessTree,
  waitForExit,
};
